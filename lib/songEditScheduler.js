/**
 * Shared utilities for advanced song edit scheduling.
 * These functions are intentionally framework agnostic so they can be used
 * by both client components and server routes.
 */

const toNumberOrZero = (value) => (Number.isFinite(value) ? value : 0);

export const clampVolume = (value, fallback = 1) => {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

const normalizeResumeMode = (resumeMode, pauseMusic) => {
  if (pauseMusic) return "clip_end";
  if (resumeMode === "beat") return "segment"; // legacy alias
  if (resumeMode === "segment") return "segment";
  return resumeMode || "segment";
};

export const getSegmentKey = (time) => {
  if (!Number.isFinite(time)) return null;
  return Number(time.toFixed(3));
};

// Legacy alias
export const getBeatKey = getSegmentKey;

export const createDefaultSegmentMetadata = (time) => ({
  segmentTime: getSegmentKey(time),
  intent: "visual",
  guidelineTags: [],
  customGuideline: "",
  narrativeNote: "",
  layerEnabled: true,
  clipSlot: {
    pauseMusic: false,
    // Default: clip full volume, music full volume
    clipVolume: 1,
    musicVolume: 1,
    resumeMode: "segment",
    allowOverlap: false,
    maxHoldSeconds: null,
    maxClipSeconds: null,
  },
});

// Legacy alias
export const createDefaultBeatMetadata = createDefaultSegmentMetadata;

export const normalizeSegmentMetadata = (segmentGrid = [], segmentMetadata = []) => {
  const indexed = new Map(
    segmentMetadata
      .map((entry) => {
        if (!entry) return null;
        const key =
          typeof entry.segmentTime === "number"
            ? getSegmentKey(entry.segmentTime)
            : typeof entry.beatTime === "number" // legacy
            ? getSegmentKey(entry.beatTime)
            : getSegmentKey(entry.time ?? null);
        if (key === null) return null;
        return [key, entry];
      })
      .filter(Boolean)
  );

  return segmentGrid.map((time) => {
    const defaults = createDefaultSegmentMetadata(time);
    const key = getSegmentKey(time);
    const existing = indexed.get(key);
    if (!existing) {
      return defaults;
    }
    const maxClipSeconds = Number.isFinite(existing.clipSlot?.maxClipSeconds)
      ? Math.max(0, existing.clipSlot.maxClipSeconds)
      : defaults.clipSlot.maxClipSeconds;
    return {
      ...defaults,
      ...existing,
      segmentTime: key,
      layerEnabled:
        typeof existing.layerEnabled === "boolean"
          ? existing.layerEnabled
          : defaults.layerEnabled,
      clipSlot: {
        ...defaults.clipSlot,
        ...existing.clipSlot,
        pauseMusic: Boolean(existing.clipSlot?.pauseMusic),
        clipVolume: clampVolume(
          existing.clipSlot?.clipVolume,
          defaults.clipSlot.clipVolume
        ),
        musicVolume: clampVolume(
          existing.clipSlot?.musicVolume,
          defaults.clipSlot.musicVolume
        ),
        resumeMode: normalizeResumeMode(existing.clipSlot?.resumeMode, existing.clipSlot?.pauseMusic),
        maxClipSeconds,
      },
      guidelineTags: Array.isArray(existing.guidelineTags)
        ? existing.guidelineTags
        : [],
    };
  });
};

// Legacy alias
export const normalizeBeatMetadata = normalizeSegmentMetadata;

const INTRO_SEGMENT_TIME = 0;
const INTRO_SEGMENT_LABEL = "Opening Segment";

export const normalizeIntroSegment = (introSegment) => {
  const defaults = {
    ...createDefaultSegmentMetadata(INTRO_SEGMENT_TIME),
    label: INTRO_SEGMENT_LABEL,
  };
  const source = typeof introSegment === "object" && introSegment ? introSegment : {};
  const clipSlot = {
    ...defaults.clipSlot,
    ...(source.clipSlot || {}),
  };
  clipSlot.maxClipSeconds = Number.isFinite(clipSlot.maxClipSeconds)
    ? Math.max(0, clipSlot.maxClipSeconds)
    : defaults.clipSlot.maxClipSeconds;
  clipSlot.clipVolume = clampVolume(
    typeof clipSlot.clipVolume === "number" ? clipSlot.clipVolume : defaults.clipSlot.clipVolume
  );
  clipSlot.musicVolume = clampVolume(
    typeof clipSlot.musicVolume === "number" ? clipSlot.musicVolume : defaults.clipSlot.musicVolume
  );
  clipSlot.pauseMusic = Boolean(clipSlot.pauseMusic);
  clipSlot.resumeMode = normalizeResumeMode(clipSlot.resumeMode, clipSlot.pauseMusic);

  return {
    ...defaults,
    ...source,
    segmentTime: INTRO_SEGMENT_TIME,
    label:
      typeof source.label === "string" && source.label.trim().length
        ? source.label
        : defaults.label,
    guidelineTags: Array.isArray(source.guidelineTags)
      ? source.guidelineTags
      : [],
    clipSlot,
  };
};

// Legacy alias
export const normalizeIntroBeat = normalizeIntroSegment;

export const normalizeMixSegments = (
  segments = [],
  durationSeconds = null
) => {
  if (!Array.isArray(segments) || !segments.length) return [];
  const duration = typeof durationSeconds === "number" ? durationSeconds : null;
  return segments
    .map((segment, index) => {
      const start = Math.max(0, toNumberOrZero(segment.start));
      let end = Number.isFinite(segment.end) ? segment.end : start;
      if (duration !== null) {
        end = Math.min(end, duration);
      }
      if (end <= start) {
        return null;
      }
      return {
        id: segment.id || `mix-${index}`,
        label: segment.label || `Segment ${index + 1}`,
        start,
        end,
        musicVolume: clampVolume(segment.musicVolume ?? 1),
        clipVolume: clampVolume(segment.clipVolume ?? 1),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
};

/**
 * Determine how a clip should be scheduled relative to the segment grid.
 * When pauseMusic is true we let the clip overrun while holding the segment clock.
 * Otherwise we trim to the segment duration so the grid remains authoritative.
 */
export const resolveClipPlaybackWindow = ({
  beatDuration,
  clipDuration,
  pauseMusic = false,
}) => {
  const beatLen = Math.max(0, toNumberOrZero(beatDuration));
  const clipLen = Math.max(0, toNumberOrZero(clipDuration));
  if (pauseMusic) {
    return {
      clipSeconds: clipLen,
      musicHoldSeconds: Math.max(0, clipLen - beatLen),
      trimmedSeconds: 0,
    };
  }
  if (beatLen === 0) {
    return {
      clipSeconds: clipLen,
      musicHoldSeconds: 0,
      trimmedSeconds: 0,
    };
  }
  if (clipLen <= beatLen) {
    return {
      clipSeconds: clipLen,
      musicHoldSeconds: 0,
      trimmedSeconds: 0,
    };
  }
  return {
    clipSeconds: beatLen,
    musicHoldSeconds: 0,
    trimmedSeconds: clipLen - beatLen,
  };
};

export const detectOverlappingRanges = (
  ranges = [],
  toleranceSeconds = 0.05
) => {
  if (!Array.isArray(ranges) || ranges.length <= 1) return [];
  const tolerance = Math.max(0, toleranceSeconds);
  const normalized = ranges
    .map((range) => {
      const start = Number(range.start);
      const end = Number(range.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      return {
        ...range,
        start,
        end,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));

  const overlaps = [];
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const current = normalized[i];
    for (let j = i + 1; j < normalized.length; j += 1) {
      const next = normalized[j];
      if (next.start - current.end > tolerance) {
        break;
      }
      if (next.start < current.end - tolerance) {
        overlaps.push([current, next]);
      }
    }
  }
  return overlaps;
};

export default {
  clampVolume,
  createDefaultBeatMetadata,
  detectOverlappingRanges,
  getBeatKey,
  normalizeIntroBeat,
  normalizeBeatMetadata,
  normalizeMixSegments,
  resolveClipPlaybackWindow,
};

