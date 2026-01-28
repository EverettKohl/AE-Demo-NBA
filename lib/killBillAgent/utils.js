/**
 * Utility functions for Kill Bill Agent
 */
import {
  getKillBillVideoParts,
  getKillBillVideoIdForPart as getConfiguredVideoIdForPart,
} from "../twelveLabs/videoCatalog.js";

const VIDEO_PARTS = getKillBillVideoParts();

/**
 * Format seconds into MM:SS string
 */
export const formatTime = (seconds) => {
  if (typeof seconds !== "number" || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/**
 * Format seconds into HH:MM:SS string for longer durations
 */
export const formatTimeLong = (seconds) => {
  if (typeof seconds !== "number" || isNaN(seconds)) return "0:00:00";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/**
 * Format with millisecond precision (HH:MM:SS.sss)
 */
export const formatTimestampPrecise = (seconds, fractionDigits = 3) => {
  if (typeof seconds !== "number" || !isFinite(seconds)) {
    return "00:00:00.000";
  }
  const sign = seconds < 0 ? "-" : "";
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const secs = (absolute % 60).toFixed(fractionDigits);
  const [whole, fractional] = secs.split(".");
  const secondsComponent = fractional
    ? `${whole.padStart(2, "0")}.${fractional}`
    : whole.padStart(2, "0");
  return `${sign}${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secondsComponent}`;
};

export const formatTimestampRangePrecise = (startSeconds, endSeconds) => {
  return `${formatTimestampPrecise(startSeconds)} – ${formatTimestampPrecise(endSeconds)}`;
};

/**
 * Video ID to Cloudinary mapping
 */
export const VIDEO_ID_MAP = VIDEO_PARTS.reduce((map, part) => {
  if (!part?.videoId) return map;
  map[part.videoId] = {
    cloudinaryId: part.cloudinaryPublicId,
    filename: part.filename,
    volume: part.volume,
    part: part.partNumber,
    label: part.label,
  };
  return map;
}, {});

const LEGACY_PART5_ID = getConfiguredVideoIdForPart(5);
export const VIDEO_ID_ALIASES = LEGACY_PART5_ID
  ? {
      "692560069fbc66589d49dbaf": LEGACY_PART5_ID,
    }
  : {};

// Map legacy Cloudinary public_ids to 30fps variants
const CLOUDINARY_30FPS_MAP = {
  Kill_Bill_Vol1_Part1: "Kill_Bill_Vol1_Part1_30FPS",
  Kill_Bill_Vol1_Part2: "Kill_Bill_Vol1_Part2_30FPS",
  Kill_Bill_Vol2_Part1: "Kill_Bill_Vol2_Part1_30FPS",
  Kill_Bill_Vol2_Part2: "Kill_Bill_Vol2_Part2_30FPS",
  Kill_Bill_Vol2_Part3: "Kill_Bill_Vol2_Part3_30FPS",
};

const normalizeCloudinaryId = (id) => {
  if (!id || typeof id !== "string") return id;
  const stripped = id.replace(/\.mp4$/i, "");
  return CLOUDINARY_30FPS_MAP[stripped] || stripped;
};

Object.entries(VIDEO_ID_ALIASES).forEach(([alias, canonical]) => {
  if (VIDEO_ID_MAP[canonical]) {
    VIDEO_ID_MAP[alias] = VIDEO_ID_MAP[canonical];
  }
});

export const getCanonicalVideoId = (videoId) => VIDEO_ID_ALIASES[videoId] || videoId;

export const getVideoIdForPart = (partNumber) => {
  if (partNumber === null || partNumber === undefined) return null;
  return getConfiguredVideoIdForPart(Number(partNumber));
};

const getPartNumberForVideoId = (videoId) => {
  const canonical = getCanonicalVideoId(videoId);
  return VIDEO_ID_MAP[canonical]?.part || null;
};

const findManifestPartByNumber = (manifest, partNumber) => {
  if (!manifest?.parts?.length || typeof partNumber !== "number") return null;
  return manifest.parts.find((part) => Number(part.partNumber) === Number(partNumber)) || null;
};

const findManifestPartByGlobalTime = (manifest, globalSeconds) => {
  if (!manifest?.parts?.length || typeof globalSeconds !== "number") return null;
  return (
    manifest.parts.find(
      (part) =>
        typeof part.globalStartSeconds === "number" &&
        typeof part.globalEndSeconds === "number" &&
        globalSeconds >= part.globalStartSeconds &&
        globalSeconds <= part.globalEndSeconds
    ) || null
  );
};

export const convertGlobalSecondsToVideoTiming = (globalSeconds, manifest) => {
  if (typeof globalSeconds !== "number" || !manifest?.parts?.length) {
    return null;
  }
  const part = findManifestPartByGlobalTime(manifest, globalSeconds);
  if (!part) return null;
  const localSeconds = globalSeconds - part.globalStartSeconds;
  const videoId = getVideoIdForPart(part.partNumber);
  return {
    videoId,
    cloudinaryId: getCloudinaryId(videoId),
    partNumber: part.partNumber,
    localSeconds,
  };
};

export const convertGlobalRangeToVideoTiming = (startGlobalSeconds, endGlobalSeconds, manifest) => {
  const startTiming = convertGlobalSecondsToVideoTiming(startGlobalSeconds, manifest);
  const endTiming = convertGlobalSecondsToVideoTiming(endGlobalSeconds, manifest);
  if (!startTiming || !endTiming) {
    return null;
  }
  if (startTiming.videoId !== endTiming.videoId) {
    // For now, require the range to stay within a single part
    return null;
  }
  return {
    videoId: startTiming.videoId,
    cloudinaryId: startTiming.cloudinaryId,
    partNumber: startTiming.partNumber,
    startLocalSeconds: Math.max(0, startTiming.localSeconds),
    endLocalSeconds: Math.max(startTiming.localSeconds, endTiming.localSeconds),
  };
};

export const convertVideoTimeToGlobal = (videoId, localSeconds, manifest) => {
  const partNumber = getPartNumberForVideoId(videoId);
  if (!manifest?.parts?.length || !partNumber) {
    return null;
  }
  const part = findManifestPartByNumber(manifest, partNumber);
  if (!part) {
    return null;
  }
  const safeLocal = typeof localSeconds === "number" ? localSeconds : 0;
  return part.globalStartSeconds + safeLocal;
};

/**
 * Get Cloudinary ID from Twelve Labs video ID
 */
export const getCloudinaryId = (videoId) => {
  const canonical = getCanonicalVideoId(videoId);
  const mapped = VIDEO_ID_MAP[canonical]?.cloudinaryId || canonical || videoId;
  return normalizeCloudinaryId(mapped);
};

/**
 * Get video info from Twelve Labs video ID
 */
export const getVideoInfo = (videoId) => {
  const canonical = getCanonicalVideoId(videoId);
  return VIDEO_ID_MAP[canonical] || null;
};

/**
 * Configuration for banned video segments (copyright/watermark)
 */
const BANNED_VIDEO_ID = getVideoIdForPart(2) || "69254488b401380ebb921f0a";
export const BANNED_VIDEO_CONFIG = {
  videoId: BANNED_VIDEO_ID,
  filename: VIDEO_ID_MAP[BANNED_VIDEO_ID]?.filename || "Kill_Bill_Vol1_Part2.mp4",
  bannedStartSeconds: 0,
  bannedEndSeconds: 11,
};

/**
 * Check if a clip should be banned
 */
export const isBannedClip = (videoId, start, filename = null) => {
  if (videoId === BANNED_VIDEO_CONFIG.videoId) {
    if (start < BANNED_VIDEO_CONFIG.bannedEndSeconds) {
      return true;
    }
  }
  const bannedLabel = VIDEO_ID_MAP[BANNED_VIDEO_CONFIG.videoId]?.cloudinaryId || "Kill_Bill_Vol1_Part2";
  if (filename && filename.includes(bannedLabel)) {
    if (start < BANNED_VIDEO_CONFIG.bannedEndSeconds) {
      return true;
    }
  }
  return false;
};

/**
 * Deduplicate clips by video ID and approximate timestamp
 */
export const deduplicateClips = (clips, windowSeconds = 5) => {
  const seen = new Map();
  const unique = [];

  for (const clip of clips) {
    const videoId = getCanonicalVideoId(clip.video_id || clip.videoId);
    const start = typeof clip.start === "number" ? clip.start : 0;
    const key = `${videoId}-${Math.floor(start / windowSeconds)}`;

    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(clip);
    }
  }

  return unique;
};

/**
 * Sort clips chronologically by video order and timestamp
 */
const VIDEO_ORDER = VIDEO_PARTS.reduce((order, part, idx) => {
  if (part?.videoId) {
    order[part.videoId] = idx + 1;
  }
  return order;
}, {});

export const sortClipsChronologically = (clips) => {
  return [...clips].sort((a, b) => {
    const aVideoId = getCanonicalVideoId(a.video_id || a.videoId);
    const bVideoId = getCanonicalVideoId(b.video_id || b.videoId);
    const aOrder = VIDEO_ORDER[aVideoId] || 99;
    const bOrder = VIDEO_ORDER[bVideoId] || 99;

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    const aStart = typeof a.start === "number" ? a.start : 0;
    const bStart = typeof b.start === "number" ? b.start : 0;
    return aStart - bStart;
  });
};

/**
 * Format a clip for response
 */
export const formatClip = (clip, index = 0) => {
  const videoId = getCanonicalVideoId(clip.video_id || clip.videoId);
  const start = typeof clip.start === "number" ? clip.start : 0;
  const end = typeof clip.end === "number" ? clip.end : start + 5;

  return {
    id: index + 1,
    videoId,
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
    duration: Math.round((end - start) * 100) / 100,
    startFormatted: formatTime(start),
    endFormatted: formatTime(end),
    confidence: clip.confidence || clip.score || null,
    thumbnail: clip.thumbnail_url || clip.thumbnailUrl || null,
    description: clip.description || null,
    character: clip.character || null,
    dialogue: clip.dialogue || null,
  };
};

/**
 * Clamp a value between min and max
 */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Sleep for a given number of milliseconds
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  formatTime,
  formatTimeLong,
  formatTimestampPrecise,
  formatTimestampRangePrecise,
  VIDEO_ID_MAP,
  getCloudinaryId,
  getVideoInfo,
  BANNED_VIDEO_CONFIG,
  isBannedClip,
  deduplicateClips,
  sortClipsChronologically,
  formatClip,
  clamp,
  sleep,
  convertGlobalSecondsToVideoTiming,
  convertGlobalRangeToVideoTiming,
  convertVideoTimeToGlobal,
};


