/**
 * Cloudinary utility functions (v2) for generating video clip URLs
 * Uses the v2 pre-cached clip map.
 */

import {
  findBestPreCachedClip,
  getPreCachedClipUrl as getPreCachedUrl,
  PRE_CACHED_CLIPS,
} from "@/data/preCachedClips2.js";

// Re-export pre-cached clip utilities
export { findBestPreCachedClip, PRE_CACHED_CLIPS };

/**
 * Check if pre-cached clips are available for a video
 * @param {string} videoId - The Cloudinary video ID
 * @returns {boolean}
 */
export function hasPreCachedClips(videoId) {
  const normalized = normalizeCloudinaryPublicId(videoId);
  return PRE_CACHED_CLIPS[normalized] && PRE_CACHED_CLIPS[normalized].length > 0;
}

const CLOUDINARY_30FPS_MAP = {
  Kill_Bill_Vol1_Part1: "Kill_Bill_Vol1_Part1_30FPS",
  Kill_Bill_Vol1_Part2: "Kill_Bill_Vol1_Part2_30FPS",
  Kill_Bill_Vol2_Part1: "Kill_Bill_Vol2_Part1_30FPS",
  Kill_Bill_Vol2_Part2: "Kill_Bill_Vol2_Part2_30FPS",
  Kill_Bill_Vol2_Part3: "Kill_Bill_Vol2_Part3_30FPS",
};

export const normalizeCloudinaryPublicId = (publicId) => {
  if (!publicId || typeof publicId !== "string") return publicId;
  const stripped = publicId.replace(/\.mp4$/i, "");
  const upgraded = CLOUDINARY_30FPS_MAP[stripped] || stripped;
  return upgraded;
};

const DEFAULT_FPS = 30;

export const buildSafeRange = (start, end, fps = DEFAULT_FPS) => {
  const frameDuration = 1 / Math.max(fps || DEFAULT_FPS, 1);
  const tiny = frameDuration * 0.25;
  const startSec = Number(start) || 0;
  const endSec = Number(end) || startSec;
  const startRounded = Math.round(startSec * 1000) / 1000;
  const endExclusive = endSec;
  let eo = Math.floor((endExclusive - tiny) * 1000) / 1000;
  if (!(eo > startRounded)) {
    eo = Math.round((startRounded + Math.max(frameDuration * 0.1, 0.001)) * 1000) / 1000;
  }
  return { startRounded, endRounded: eo };
};

export function getOptimalClipUrl(videoId, targetStart, targetEnd, options = {}) {
  // Allow caller to override cloudName (e.g., fetched from API on client)
  const cloudName =
    options.cloudName ||
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
    null;
  if (!cloudName) {
    throw new Error("Cloudinary cloud name not provided");
  }

  const normalizedVideoId = normalizeCloudinaryPublicId(videoId);
  const preCachedClip = findBestPreCachedClip(normalizedVideoId, targetStart, targetEnd);

  if (preCachedClip) {
    const url = getPreCachedUrl(preCachedClip, cloudName);
    const seekOffset = targetStart - preCachedClip.start;
    return {
      url,
      clip: preCachedClip,
      isPreCached: true,
      seekOffset: Math.max(0, seekOffset),
      previewStart: preCachedClip.start,
      previewEnd: preCachedClip.end,
      previewDuration: preCachedClip.duration,
    };
  }

  const { startRounded, endRounded } = buildSafeRange(targetStart, targetEnd, options.fps || DEFAULT_FPS);
  const url = `https://res.cloudinary.com/${cloudName}/video/upload/so_${startRounded},eo_${endRounded},f_mp4/${normalizedVideoId}.mp4`;

  return {
    url,
    clip: null,
    isPreCached: false,
    seekOffset: 0,
    previewStart: startRounded,
    previewEnd: endRounded,
    previewDuration: endRounded - startRounded,
  };
}

export function getClipUrl(videoId, start, end, options = {}) {
  const { download = false, maxDuration = 180, fps = DEFAULT_FPS } = options;
  const normalizedVideoId = normalizeCloudinaryPublicId(videoId);
  if (!videoId || typeof videoId !== "string") throw new Error("videoId must be a non-empty string");
  if (typeof start !== "number" || typeof end !== "number") throw new Error("start and end must be numbers");

  const { startRounded, endRounded } = buildSafeRange(start, end, fps);
  if (startRounded >= endRounded) throw new Error(`Invalid time range: start (${startRounded}) must be less than end (${endRounded})`);
  const duration = endRounded - startRounded;
  if (duration > maxDuration) throw new Error(`Clip duration (${duration}s) exceeds maximum allowed duration (${maxDuration}s)`);

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) throw new Error("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME environment variable is not set");

  const frameRate = Math.max(fps || DEFAULT_FPS, 1);
  const tinyClipThreshold = 5 / frameRate;
  const keyframeInterval = duration <= tinyClipThreshold ? 1 : Math.max(4, Math.min(24, Math.round(frameRate / 2)));

  const transformations = [`so_${startRounded}`, `eo_${endRounded}`, "f_mp4", "vc_h264:high", "q_auto:good", `ki_${keyframeInterval}`];
  if (download) transformations.push("fl_attachment");

  const transformationString = transformations.join(",");
  const resourcePath = normalizedVideoId;
  return `https://res.cloudinary.com/${cloudName}/video/upload/${transformationString}/${resourcePath}.mp4`;
}

export function getPreviewUrl(videoId, start, end, options = {}) {
  return getClipUrl(videoId, start, end, { ...options, download: false });
}

export function getDownloadUrl(videoId, start, end, options = {}) {
  return getClipUrl(videoId, start, end, { ...options, download: true });
}
