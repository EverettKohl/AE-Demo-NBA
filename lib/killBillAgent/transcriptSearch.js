import { normalizeCharacterName } from "./dataLoader.js";
import {
  formatTimestampPrecise,
  formatTimestampRangePrecise,
  convertGlobalRangeToVideoTiming,
} from "./utils.js";

const MIN_FALLBACK_GAP = 0.25;
const isWindowWithinSearchWindow = (window, searchWindow) => {
  if (!searchWindow) return true;
  const startBound = Number.isFinite(searchWindow.start) ? searchWindow.start : Number.NEGATIVE_INFINITY;
  const endBound = Number.isFinite(searchWindow.end) ? searchWindow.end : Number.POSITIVE_INFINITY;
  return window.endGlobalSeconds >= startBound && window.startGlobalSeconds <= endBound;
};

const SEARCH_PHASES = [
  { enforceLocation: true, enforceActions: true },
  { enforceLocation: false, enforceActions: true },
  { enforceLocation: false, enforceActions: false },
];

const normalizeSceneLocation = (scene, transcript) => {
  if (!scene) return null;
  return scene.location?.toLowerCase() || null;
};

const matchesLocation = (segment, constraints, transcript) => {
  if (!constraints.locationKeywords?.length) return true;
  const sceneIds = [
    segment?.screenplaySceneId,
    segment?.sceneId,
  ].filter(Boolean);
  for (const sceneId of sceneIds) {
    const scene = transcript?.sceneIndexById?.get?.(sceneId);
    const location = normalizeSceneLocation(scene, transcript);
    if (location && constraints.locationKeywords.some((keyword) => location.includes(keyword))) {
      return true;
    }
  }
  return false;
};

const matchesActionKeywords = (segment, constraints) => {
  if (!constraints.actionKeywords?.length) return true;
  const textLower = segment?.textLower || segment?.text?.toLowerCase() || "";
  return constraints.actionKeywords.some((keyword) => textLower.includes(keyword));
};

const matchesCharacters = (beforeSegment, afterSegment, constraints) => {
  if (!constraints.requiredCharacters?.length) return true;
  const beforeChar = normalizeCharacterName(beforeSegment?.character);
  const afterChar = normalizeCharacterName(afterSegment?.character);
  return constraints.requiredCharacters.every((char) => char === beforeChar || char === afterChar);
};

const matchesDialogueAnchors = (beforeSegment, afterSegment, constraints) => {
  if (constraints.precedingDialogueId && beforeSegment?.dialogueId !== constraints.precedingDialogueId) {
    return false;
  }
  if (constraints.followingDialogueId && afterSegment?.dialogueId !== constraints.followingDialogueId) {
    return false;
  }
  return true;
};

const computeCandidateScore = ({
  window,
  beforeSegment,
  afterSegment,
  constraints,
  approxGlobalSeconds,
  preferSilence,
}) => {
  let score = 0;

  const duration = window.durationSeconds || 0;
  if (preferSilence) {
    score += duration * 3;
  } else {
    score += duration * 1.5;
  }

  const beforeChar = normalizeCharacterName(beforeSegment?.character);
  const afterChar = normalizeCharacterName(afterSegment?.character);
  constraints.requiredCharacters?.forEach?.((char) => {
    if (char === beforeChar || char === afterChar) {
      score += 4;
    }
  });

  if (constraints.precedingDialogueId && beforeSegment?.dialogueId === constraints.precedingDialogueId) {
    score += 6;
  }
  if (constraints.followingDialogueId && afterSegment?.dialogueId === constraints.followingDialogueId) {
    score += 6;
  }

  if (constraints.locationKeywords?.length) {
    score += 3;
  }
  if (constraints.actionKeywords?.length) {
    score += 2;
  }

  if (typeof approxGlobalSeconds === "number") {
    const windowMid = (window.startGlobalSeconds + window.endGlobalSeconds) / 2;
    const delta = Math.abs(windowMid - approxGlobalSeconds);
    score += Math.max(0, 30 - delta);
  }

  return score;
};

const mapCandidate = ({ window, beforeSegment, afterSegment, manifest, score }) => {
  const timing = convertGlobalRangeToVideoTiming(window.startGlobalSeconds, window.endGlobalSeconds, manifest);
  return {
    window,
    beforeSegment,
    afterSegment,
    timing,
    score,
    rangeFormatted: formatTimestampRangePrecise(window.startGlobalSeconds, window.endGlobalSeconds),
    beforeTimestamp: formatTimestampPrecise(beforeSegment?.endGlobalSeconds || window.startGlobalSeconds),
    afterTimestamp: formatTimestampPrecise(afterSegment?.startGlobalSeconds || window.endGlobalSeconds),
  };
};

export const findMomentCandidates = ({ constraints, dataSources, limit = 2 }) => {
  const mergedTranscript = dataSources?.mergedTranscript;
  const transcript = dataSources?.transcript;
  const manifest = dataSources?.manifest;

  if (!mergedTranscript?.silenceWindows?.length || !mergedTranscript?.segmentsById) {
    return [];
  }

  const segmentsById = mergedTranscript.segmentsById;
  const silenceWindows = mergedTranscript.silenceWindows;

  for (const phase of SEARCH_PHASES) {
    const candidates = [];
    for (const window of silenceWindows) {
      if (!isWindowWithinSearchWindow(window, constraints.searchWindow)) {
        continue;
      }
      const beforeSegment = segmentsById.get(window.precedingDialogueId);
      const afterSegment = segmentsById.get(window.followingDialogueId);

      if (!beforeSegment || !afterSegment) continue;
      if (!matchesCharacters(beforeSegment, afterSegment, constraints)) continue;
      if (!matchesDialogueAnchors(beforeSegment, afterSegment, constraints)) continue;

      if (phase.enforceLocation && constraints.locationKeywords?.length) {
        const beforeLocationMatch = matchesLocation(beforeSegment, constraints, transcript);
        const afterLocationMatch = matchesLocation(afterSegment, constraints, transcript);
        if (!beforeLocationMatch && !afterLocationMatch) continue;
      }

      if (phase.enforceActions && constraints.actionKeywords?.length) {
        if (!matchesActionKeywords(beforeSegment, constraints) && !matchesActionKeywords(afterSegment, constraints)) {
          continue;
        }
      }

      const score = computeCandidateScore({
        window,
        beforeSegment,
        afterSegment,
        constraints,
        approxGlobalSeconds: constraints.approxGlobalSeconds,
        preferSilence: constraints.preferSilence,
      });

      candidates.push({
        score,
        window,
        beforeSegment,
        afterSegment,
      });
    }

    if (candidates.length) {
      return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((candidate) => mapCandidate({ ...candidate, manifest }));
    }
  }

  // Fallback: pick best adjacency even if silence below threshold
  const fallbackCandidates = [];
  const segments = mergedTranscript.segments;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const current = segments[i];
    const next = segments[i + 1];
    const start = current.endGlobalSeconds;
    const end = next.startGlobalSeconds;
    if (typeof start !== "number" || typeof end !== "number") continue;
    const gap = Math.max(end - start, MIN_FALLBACK_GAP);
    const window = {
      startGlobalSeconds: start,
      endGlobalSeconds: start + gap,
      durationSeconds: gap,
      precedingDialogueId: current.dialogueId,
      followingDialogueId: next.dialogueId,
    };

    if (!isWindowWithinSearchWindow(window, constraints.searchWindow)) {
      continue;
    }

    if (!matchesCharacters(current, next, constraints)) continue;
    if (!matchesDialogueAnchors(current, next, constraints)) continue;

    const score = computeCandidateScore({
      window,
      beforeSegment: current,
      afterSegment: next,
      constraints,
      approxGlobalSeconds: constraints.approxGlobalSeconds,
      preferSilence: constraints.preferSilence,
    });
    fallbackCandidates.push({
      score,
      window,
      beforeSegment: current,
      afterSegment: next,
    });
  }

  return fallbackCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate) => mapCandidate({ ...candidate, manifest }));
};

export default {
  findMomentCandidates,
};

