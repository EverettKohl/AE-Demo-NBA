/**
 * Twelve Labs visual oracle helper.
 * Converts free-form user prompts into descriptive scene hints without relying on TL timestamps.
 */

import { searchClips, getSceneContext } from "./tools.js";
import { loadDataSources, normalizeCharacterName } from "./dataLoader.js";
import { convertVideoTimeToGlobal, formatTimestampPrecise } from "./utils.js";

const DEFAULT_VISUAL_LIMIT = 3;
const CONTEXT_WINDOW_LIMIT = 5;
const DESCRIPTIVE_STOPWORDS = new Set(["when", "timestamp", "time", "happen", "happens", "happening"]);

const stripWhenPhrasing = (query = "") => {
  if (!query) return "";
  return query.replace(/when\s+(does|did|is|was)\s+/gi, "").replace(/\?+$/g, "").trim();
};

const sanitizeVisualQuery = (query = "") => {
  const stripped = stripWhenPhrasing(query);
  if (!stripped) return "Describe the requested Kill Bill moment in detail.";

  const tokens = stripped.split(/\s+/).filter(Boolean);
  const filtered = tokens.filter((token) => !DESCRIPTIVE_STOPWORDS.has(token.toLowerCase()));
  return filtered.join(" ").trim() || stripped;
};

const uniq = (items = []) => [...new Set(items.filter(Boolean))];

const isWithinScope = (value, scope) => {
  if (!scope) return true;
  if (Number.isFinite(scope.startGlobalSeconds) && value < scope.startGlobalSeconds) {
    return false;
  }
  if (Number.isFinite(scope.endGlobalSeconds) && value > scope.endGlobalSeconds) {
    return false;
  }
  return true;
};

const buildContextDetails = ({ transcriptContext = [] }, segmentsById, sceneIndexById) => {
  if (!Array.isArray(transcriptContext) || !segmentsById) {
    return [];
  }

  return transcriptContext.slice(0, CONTEXT_WINDOW_LIMIT).map((entry) => {
    const segment = segmentsById.get(entry.dialogueId) || null;
    const sceneMeta = segment?.sceneId ? sceneIndexById?.get?.(segment.sceneId) : null;
    return {
      dialogueId: entry.dialogueId,
      character: entry.character,
      text: entry.text,
      sceneId: segment?.sceneId || null,
      chapter: segment?.chapter || null,
      startGlobalSeconds: segment?.startGlobalSeconds ?? null,
      endGlobalSeconds: segment?.endGlobalSeconds ?? null,
      location: sceneMeta?.location || null,
    };
  });
};

const derivePrecedingFollowing = (contextDetails, approxGlobalSeconds) => {
  if (!contextDetails?.length) {
    return { precedingDialogueId: null, followingDialogueId: null };
  }

  const sorted = [...contextDetails].sort((a, b) => {
    const aStart = a.startGlobalSeconds ?? Number.POSITIVE_INFINITY;
    const bStart = b.startGlobalSeconds ?? Number.POSITIVE_INFINITY;
    return aStart - bStart;
  });

  if (typeof approxGlobalSeconds !== "number") {
    return {
      precedingDialogueId: sorted[0]?.dialogueId || null,
      followingDialogueId: sorted[sorted.length - 1]?.dialogueId || null,
    };
  }

  let preceding = null;
  let following = null;

  for (const segment of sorted) {
    const segmentEnd = segment.endGlobalSeconds ?? Number.NEGATIVE_INFINITY;
    const segmentStart = segment.startGlobalSeconds ?? Number.POSITIVE_INFINITY;
    if (segmentEnd <= approxGlobalSeconds) {
      preceding = segment;
    }
    if (segmentStart >= approxGlobalSeconds && !following) {
      following = segment;
    }
  }

  if (!preceding) {
    preceding = sorted[0];
  }
  if (!following) {
    following = sorted[sorted.length - 1];
  }

  return {
    precedingDialogueId: preceding?.dialogueId || null,
    followingDialogueId: following?.dialogueId || null,
  };
};

const summarizeClipHint = (clipHint) => {
  const { locationHints = [], characters = [], approxGlobalSeconds } = clipHint;
  const location = locationHints[0] || "the scene";
  const people = characters.length ? characters.join(" & ") : "key characters";
  const time = typeof approxGlobalSeconds === "number" ? formatTimestampPrecise(approxGlobalSeconds) : "unknown time";
  return `Twelve Labs surfaced ${location} featuring ${people} near ${time}.`;
};

export const runVisualOracle = async ({ query, limit = DEFAULT_VISUAL_LIMIT, scope = null } = {}) => {
  const sanitizedQuery = sanitizeVisualQuery(query);
  const dataSources = await loadDataSources();
  const { manifest, mergedTranscript, transcript } = dataSources;
  const segmentsById = mergedTranscript?.segmentsById || new Map();
  const sceneIndexById = transcript?.sceneIndexById || new Map();

  const searchResult = await searchClips({
    query: sanitizedQuery,
    limit,
    searchOptions: ["visual", "audio"],
  });

  let clipHints = [];
  if (searchResult.success && Array.isArray(searchResult.clips)) {
    for (const clip of searchResult.clips) {
      const timestamp = typeof clip.start === "number" ? clip.start : 0;
      const approxGlobalSeconds = convertVideoTimeToGlobal(clip.videoId, timestamp, manifest);
      let sceneContext = null;
      try {
        sceneContext = await getSceneContext({ videoId: clip.videoId, timestamp });
      } catch (error) {
        console.warn("[visualOracle] Failed to fetch scene context:", error.message);
      }

      const contextDetails = buildContextDetails(sceneContext || {}, segmentsById, sceneIndexById);
      const characters = uniq(contextDetails.map((detail) => normalizeCharacterName(detail.character)));
      const locations = uniq(contextDetails.map((detail) => detail.location).filter(Boolean));
      const { precedingDialogueId, followingDialogueId } = derivePrecedingFollowing(contextDetails, approxGlobalSeconds);

      clipHints.push({
        videoId: clip.videoId,
        approxGlobalSeconds,
        contextDetails,
        characters: characters.filter(Boolean),
        locationHints: locations,
        precedingDialogueId,
        followingDialogueId,
        rawClip: clip,
      });
    }
  }

  const hasScope =
    Number.isFinite(scope?.startGlobalSeconds) || Number.isFinite(scope?.endGlobalSeconds);
  if (hasScope) {
    const scopedHints = clipHints.filter((hint) => {
      if (typeof hint.approxGlobalSeconds !== "number") {
        return true;
      }
      return isWithinScope(hint.approxGlobalSeconds, scope);
    });
    if (scopedHints.length > 0) {
      clipHints = scopedHints;
    }
  }

  const aggregatedCharacters = uniq(clipHints.flatMap((hint) => hint.characters)).filter(Boolean);
  const aggregatedLocations = uniq(clipHints.flatMap((hint) => hint.locationHints)).filter(Boolean);

  const visualSummary =
    clipHints.length > 0
      ? summarizeClipHint(clipHints[0])
      : `Unable to fetch Twelve Labs context. Treat "${sanitizedQuery}" descriptively.`;

  return {
    rawQuery: query,
    sanitizedQuery,
    clipHints,
    aggregatedCharacters,
    aggregatedLocations,
    visualSummary,
    preferSilence: /\bsilent|\bceremonial|\bquiet/i.test(query || ""),
  };
};

export default {
  runVisualOracle,
  sanitizeVisualQuery,
};

