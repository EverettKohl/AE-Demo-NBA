/**
 * Cloudinary utility functions for generating video clip URLs
 */

import {
  findBestPreCachedClip,
  getPreCachedClipUrl as getPreCachedUrl,
  PRE_CACHED_CLIPS,
} from "@/data/preCachedClips.js";

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

/**
 * Map legacy Kill Bill public IDs to their 30fps versions.
 * Accepts ids with or without the .mp4 extension.
 */
const CLOUDINARY_30FPS_MAP = {
  Kill_Bill_Vol1_Part1: "Kill_Bill_Vol1_Part1_30FPS",
  Kill_Bill_Vol1_Part2: "Kill_Bill_Vol1_Part2_30FPS",
  Kill_Bill_Vol2_Part1: "Kill_Bill_Vol2_Part1_30FPS",
  Kill_Bill_Vol2_Part2: "Kill_Bill_Vol2_Part2_30FPS",
  Kill_Bill_Vol2_Part3: "Kill_Bill_Vol2_Part3_30FPS",
};

/**
 * Normalize any Kill Bill Cloudinary public_id to the 30fps variant.
 * - Strips ".mp4" if present
 * - Upgrades legacy ids to *_30FPS
 * - Leaves unknown ids untouched
 */
export const normalizeCloudinaryPublicId = (publicId) => {
  if (!publicId || typeof publicId !== "string") return publicId;
  const stripped = publicId.replace(/\.mp4$/i, "");
  const upgraded = CLOUDINARY_30FPS_MAP[stripped] || stripped;
  return upgraded;
};

/**
 * Get the best pre-cached clip URL for a target time range
 * Falls back to on-demand URL if no suitable pre-cached clip exists
 * 
 * @param {string} videoId - The Cloudinary video ID
 * @param {number} targetStart - Target clip start time
 * @param {number} targetEnd - Target clip end time
 * @param {Object} options - Options
 * @returns {Object} { url, clip, isPreCached, seekOffset }
 */
// Canonical FPS for clip window rounding in this project.
// (Callers should still pass an explicit fps when working with non-canonical sources.)
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
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME environment variable is not set');
  }

  const normalizedVideoId = normalizeCloudinaryPublicId(videoId);
  
  // Try to find a pre-cached clip
  const preCachedClip = findBestPreCachedClip(normalizedVideoId, targetStart, targetEnd);
  
  if (preCachedClip) {
    const url = getPreCachedUrl(preCachedClip, cloudName);
    // Calculate how far into the pre-cached clip we need to seek
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
  
  // Fall back to on-demand URL
  const { startRounded, endRounded } = buildSafeRange(targetStart, targetEnd, options.fps || DEFAULT_FPS);
  // Include .mp4 extension for better player compatibility
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

/**
 * Generates a Cloudinary URL for a video clip
 * @param {string} videoId - The video ID (filename without extension)
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @param {Object} options - Additional options
 * @param {boolean} options.download - If true, adds fl_attachment for download (default: false for preview)
 * @param {number} options.maxDuration - Maximum clip duration in seconds (default: 180)
 * @returns {string} Cloudinary transformation URL
 */
export function getClipUrl(videoId, start, end, options = {}) {
  const { download = false, maxDuration = 180, fps = DEFAULT_FPS } = options;
  const normalizedVideoId = normalizeCloudinaryPublicId(videoId);

  // Validate inputs
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('videoId must be a non-empty string');
  }

  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error('start and end must be numbers');
  }

  const { startRounded, endRounded } = buildSafeRange(start, end, fps);

  // Validate start < end
  if (startRounded >= endRounded) {
    throw new Error(`Invalid time range: start (${startRounded}) must be less than end (${endRounded})`);
  }

  // Validate duration
  const duration = endRounded - startRounded;
  if (duration > maxDuration) {
    throw new Error(`Clip duration (${duration}s) exceeds maximum allowed duration (${maxDuration}s)`);
  }

  // Get Cloudinary cloud name from environment
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME environment variable is not set');
  }

  // Build Cloudinary transformation URL
  // Format: https://res.cloudinary.com/{cloud_name}/video/upload/{transformations}/{resource_path}
  // Transformations: so_{start},eo_{end},f_mp4 (start offset, end offset, format mp4)
  // For download: add fl_attachment flag
  const frameRate = Math.max(fps || DEFAULT_FPS, 1);
  const tinyClipThreshold = 5 / frameRate; // ~5 frames
  const keyframeInterval = duration <= tinyClipThreshold
    ? 1
    : Math.max(4, Math.min(24, Math.round(frameRate / 2))); // ~0.5s at canonical fps

  const transformations = [
    `so_${startRounded}`,
    `eo_${endRounded}`,
    'f_mp4',
    'vc_h264:high',
    'q_auto:good',
    `ki_${keyframeInterval}`
  ];

  if (download) {
    transformations.push('fl_attachment');
  }

  const transformationString = transformations.join(',');
  // Use videoId directly (no movies/ folder)
  // Include .mp4 extension for better player compatibility (helps ReactPlayer detect as video file)
  // The videoId should match the Cloudinary public_id (e.g., "Kill_Bill_Vol1_Part1")
  const resourcePath = normalizedVideoId;

  return `https://res.cloudinary.com/${cloudName}/video/upload/${transformationString}/${resourcePath}.mp4`;
}

/**
 * Generates a preview URL for a video clip (without download flag)
 * @param {string} videoId - The video ID
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @returns {string} Cloudinary preview URL
 */
export function getClipPreviewUrl(videoId, start, end) {
  return getClipUrl(videoId, start, end, { download: false });
}

/**
 * Generates a download URL for a video clip (with download flag)
 * @param {string} videoId - The video ID
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @returns {string} Cloudinary download URL
 */
export function getClipDownloadUrl(videoId, start, end, options = {}) {
  return getClipUrl(videoId, start, end, { download: true, ...options });
}

/**
 * Calculate 3-minute preview window centered on the current clip
 * Clip should be in the middle (1.5 minutes on each side)
 * If video doesn't have enough time on one side, adjust to fill the window
 * @param {number} clipStart - Start time of the current clip
 * @param {number} clipEnd - End time of the current clip
 * @param {number} videoDuration - Total duration of the video
 * @param {number} windowDuration - Duration of the preview window (default 180s = 3 minutes)
 * @returns {Object} { previewStart, previewEnd, previewDuration }
 */
export function calculatePreviewWindow(clipStart, clipEnd, videoDuration, windowDuration = 180) {
  const clipCenter = (clipStart + clipEnd) / 2;
  const halfWindow = windowDuration / 2;
  
  // Try to center the clip
  let previewStart = clipCenter - halfWindow;
  let previewEnd = clipCenter + halfWindow;
  
  // If video is shorter than window duration, use full video
  if (videoDuration < windowDuration) {
    return {
      previewStart: 0,
      previewEnd: videoDuration,
      previewDuration: videoDuration,
    };
  }
  
  // Handle edge cases - adjust to still fill window when possible
  if (previewStart < 0) {
    previewStart = 0;
    previewEnd = Math.min(videoDuration, windowDuration);
  } else if (previewEnd > videoDuration) {
    previewEnd = videoDuration;
    previewStart = Math.max(0, videoDuration - windowDuration);
  }
  
  const previewDuration = previewEnd - previewStart;
  
  return {
    previewStart: Math.round(previewStart * 100) / 100,
    previewEnd: Math.round(previewEnd * 100) / 100,
    previewDuration: Math.round(previewDuration * 100) / 100,
  };
}

/**
 * Generates a 3-minute preview URL for editing a clip
 * @param {string} videoId - The video ID
 * @param {number} clipStart - Start time of the current clip
 * @param {number} clipEnd - End time of the current clip
 * @param {number} videoDuration - Total duration of the video
 * @returns {string} Cloudinary preview URL for the 3-minute window
 */
export function getPreviewWindowUrl(videoId, clipStart, clipEnd, videoDuration) {
  const window = calculatePreviewWindow(clipStart, clipEnd, videoDuration);
  return getClipPreviewUrl(videoId, window.previewStart, window.previewEnd);
}

