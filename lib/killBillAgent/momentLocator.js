import { loadDataSources } from "./dataLoader.js";
import { buildMomentConstraints } from "./constraintBuilder.js";
import { findMomentCandidates } from "./transcriptSearch.js";
import { resolveNarrativeScope } from "./narrativeIndex.js";
import {
  formatTimestampPrecise,
  formatTimestampRangePrecise,
  convertGlobalRangeToVideoTiming,
} from "./utils.js";

const buildEvidenceLine = (label, segment, timestamp) => {
  if (!segment) return `${label}: unavailable`;
  const speaker = segment.character || "Unknown speaker";
  const text = segment.text || "[no dialogue]";
  return `${label} (${speaker}, ${timestamp}) — "${text}"`;
};

const extractSceneMetadata = (...segments) => {
  for (const segment of segments) {
    if (segment?.sceneId) {
      return {
        id: segment.sceneId,
        screenplaySceneId: segment.screenplaySceneId || null,
        title: segment.sceneTitle || null,
        startGlobalMs: segment.sceneStartGlobalMs ?? null,
        endGlobalMs: segment.sceneEndGlobalMs ?? null,
      };
    }
  }
  return null;
};

const formatCandidateResponse = ({ constraintLabel, candidate, oracleSummary }) => {
  const beforeTimestamp = formatTimestampPrecise(candidate.window.startGlobalSeconds);
  const afterTimestamp = formatTimestampPrecise(candidate.window.endGlobalSeconds);
  const sceneRangeFormatted =
    candidate.scene &&
    typeof candidate.scene.startGlobalMs === "number" &&
    typeof candidate.scene.endGlobalMs === "number"
      ? formatTimestampRangePrecise(
          candidate.scene.startGlobalMs / 1000,
          candidate.scene.endGlobalMs / 1000
        )
      : null;
  const sceneLine = candidate.scene
    ? `${candidate.scene.title || candidate.scene.id}${
        sceneRangeFormatted ? ` (${sceneRangeFormatted})` : ""
      }`
    : null;
  const evidenceLines = [
    buildEvidenceLine(
      "Last spoken line before event",
      candidate.beforeSegment,
      candidate.beforeTimestamp || beforeTimestamp
    ),
    buildEvidenceLine(
      "First spoken line after event",
      candidate.afterSegment,
      candidate.afterTimestamp || afterTimestamp
    ),
    `Context hint — ${oracleSummary}`,
  ];

  const reasoning =
    "The requested moment occurs in the silent gap bracketed by these dialogue anchors, which match the descriptive constraints.";

  return `Moment: ${constraintLabel}
Timestamp range: ${candidate.rangeFormatted}
${sceneLine ? `Scene: ${sceneLine}\n` : ""}

Evidence:
- ${evidenceLines.join("\n- ")}

Reasoning:
${reasoning}`;
};

const formatCandidates = ({ candidates, constraints, oracle, manifest }) => {
  return candidates.map((candidate, idx) => {
    const scene = extractSceneMetadata(candidate.beforeSegment, candidate.afterSegment);
    const responseText = formatCandidateResponse({
      constraintLabel: constraints.label,
      candidate: { ...candidate, scene },
      oracleSummary: oracle?.visualSummary || "Local transcript context",
    });

    const timing =
      candidate.timing ||
      convertGlobalRangeToVideoTiming(candidate.window.startGlobalSeconds, candidate.window.endGlobalSeconds, manifest);

    return {
      id: idx + 1,
      momentLabel: constraints.label,
      scene,
      timestampRange: {
        start: candidate.window.startGlobalSeconds,
        end: candidate.window.endGlobalSeconds,
        formatted: formatTimestampRangePrecise(candidate.window.startGlobalSeconds, candidate.window.endGlobalSeconds),
      },
      evidence: {
        before: {
          speaker: candidate.beforeSegment?.character || null,
          text: candidate.beforeSegment?.text || null,
          timestamp: candidate.beforeTimestamp,
        },
        after: {
          speaker: candidate.afterSegment?.character || null,
          text: candidate.afterSegment?.text || null,
          timestamp: candidate.afterTimestamp,
        },
        visual: oracle?.visualSummary || null,
      },
      reasoning:
        "Silence between the cited dialogue lines matches the descriptive constraints supplied by the user query.",
      responseText,
      clipTiming: timing,
      debug: {
        window: candidate.window,
        score: candidate.score,
      },
    };
  });
};

const buildQueryOracleHints = ({ query, dataSources }) => {
  const text = query?.toLowerCase?.() || "";
  const characters = (dataSources?.characters || [])
    .map((char) => char?.name)
    .filter(Boolean)
    .filter((name) => text.includes(name.toLowerCase()));
  const preferSilence = /\b(silence|quiet|pause|still)\b/.test(text);

  return {
    clipHints: [],
    aggregatedCharacters: characters,
    aggregatedLocations: [],
    visualSummary: query || "Local transcript search",
    preferSilence,
  };
};

export const locateMoments = async ({ query, limit = 2, scope = null, oracle: prefetchedOracle = null } = {}) => {
  const dataSources = await loadDataSources();
  const resolvedScope = scope
    ? resolveNarrativeScope({
        narrativeIndex: dataSources.narrativeIndex,
        ...scope,
      })
    : null;
  const oracle = prefetchedOracle || buildQueryOracleHints({ query, dataSources });
  const constraints = buildMomentConstraints({ query, oracle, dataSources, scope: resolvedScope });
  const candidates = findMomentCandidates({ constraints, dataSources, limit });

  const formattedCandidates = formatCandidates({
    candidates,
    constraints,
    oracle,
    manifest: dataSources.manifest,
  });

  const agentMessage = formattedCandidates.map((candidate) => candidate.responseText).join("\n\n");

  return {
    success: formattedCandidates.length > 0,
    query,
    oracle,
    constraints,
    scope: resolvedScope,
    candidates: formattedCandidates,
    agentMessage,
  };
};

export default {
  locateMoments,
};

