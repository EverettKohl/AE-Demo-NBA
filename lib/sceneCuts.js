/**
 * Scene Cuts Utility Library
 * 
 * Provides fast lookups against pre-computed scene cut data from clip-boundaries.json.
 * Used to validate that clip segments don't contain internal cuts, which would
 * break beat alignment in song-based edits.
 * 
 * Key features:
 * - Lazy loading: JSON loaded once, cached in memory
 * - Binary search: O(log n) lookups on sorted cut arrays
 * - VideoId mapping: Maps Twelve Labs videoIds to filenames
 */

import fs from "fs";
import path from "path";

// ============================================================================
// VideoId to Filename Mapping
// ============================================================================

/**
 * Maps Twelve Labs videoIds to clip-boundaries.json filenames
 * This mapping comes from movieIndex.json
 */
const VIDEO_ID_TO_FILENAME = {
  '69254495b401380ebb921f0d': 'Kill_Bill_Vol1_Part1.mp4',
  '69254488b401380ebb921f0a': 'Kill_Bill_Vol1_Part2.mp4',
  '69255fc7c631cdc4fe330a73': 'Kill_Bill_Vol2_Part1.mp4',
  '69255fe49fbc66589d49dbac': 'Kill_Bill_Vol2_Part2.mp4',
  '69255ff6c631cdc4fe330a9c': 'Kill_Bill_Vol2_Part3.mp4',
};

// Reverse mapping for convenience
const FILENAME_TO_VIDEO_ID = Object.fromEntries(
  Object.entries(VIDEO_ID_TO_FILENAME).map(([k, v]) => [v, k])
);

// ============================================================================
// Module-level cache
// ============================================================================

let sceneCutsCache = null;
let sceneCutsLoadError = null;

// ============================================================================
// Helpers
// ============================================================================

const toNumber = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const pickFps = (chunk) => {
  const fromChunk = toNumber(chunk?.fps);
  const fromFrameDuration =
    toNumber(chunk?.frameDuration) && chunk.frameDuration > 0 ? 1 / chunk.frameDuration : null;
  return fromChunk || fromFrameDuration || null;
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Load scene cuts data from JSON file
 * Caches the result for subsequent calls
 * 
 * @returns {Object|null} Scene cuts data or null if unavailable
 */
export const loadSceneCuts = () => {
  // Return cached data if available
  if (sceneCutsCache) {
    return sceneCutsCache;
  }
  
  // Return null if we already tried and failed
  if (sceneCutsLoadError) {
    return null;
  }

  const sceneCutsPath = path.join(process.cwd(), "data", "clip-boundaries.json");
  
  try {
    if (!fs.existsSync(sceneCutsPath)) {
      console.warn("[sceneCuts] clip-boundaries.json not found, cut detection will use FFmpeg fallback");
      sceneCutsLoadError = "File not found";
      return null;
    }
    
    const content = fs.readFileSync(sceneCutsPath, "utf-8");
    const data = JSON.parse(content);
    
    // Index chunks for fast lookup.
    const chunksByFilename = {};
    const chunksByVideoId = {};
    const chunksByPartId = {};
    
    for (const chunk of data.chunks || []) {
      // Normalize cuts to ensure both object and primitive forms work
      const normalizedCuts = (chunk.cuts || [])
        .map((entry) => {
          if (typeof entry === "number") {
            return {
              rawSeconds: entry,
              rawMs: Math.round(entry * 1000),
              frameSeconds: null,
              frameIndex: null,
            };
          }
          if (entry && typeof entry === "object") {
            const rawSeconds = toNumber(entry.rawSeconds, null);
            const frameSeconds = toNumber(entry.frameSeconds, null);
            const frameIndex = Number.isInteger(entry.frameIndex) ? entry.frameIndex : null;
            const bestSeconds =
              frameSeconds != null
                ? frameSeconds
                : rawSeconds != null
                ? rawSeconds
                : null;
            if (bestSeconds == null) return null;
            return {
              rawSeconds: rawSeconds != null ? rawSeconds : bestSeconds,
              rawMs: Math.round((rawSeconds != null ? rawSeconds : bestSeconds) * 1000),
              frameSeconds: frameSeconds,
              frameIndex,
            };
          }
          return null;
        })
        .filter(Boolean);

      // Preserve detailed entries and also a numeric array for compatibility
      chunk.cutEntries = normalizedCuts;
      chunk.cuts = normalizedCuts.map((c) =>
        typeof c === "number"
          ? c
          : toNumber(c.frameSeconds, toNumber(c.rawSeconds, 0))
      );

      // Keep fps metadata if present
      const fps = pickFps(chunk);
      chunk.fps = fps;
      chunk.frameDuration =
        toNumber(chunk?.frameDuration) && chunk.frameDuration > 0
          ? chunk.frameDuration
          : fps
          ? 1 / fps
          : null;

      chunksByFilename[chunk.filename] = chunk;
      if (chunk.partId) {
        chunksByPartId[chunk.partId] = chunk;
      }
      
      // Also index by videoId if we have the mapping
      if (chunk.videoId) {
        chunksByVideoId[chunk.videoId] = chunk;
      } else {
        // Try to find videoId from our mapping
        const videoId = FILENAME_TO_VIDEO_ID[chunk.filename];
        if (videoId) {
          chunksByVideoId[videoId] = chunk;
        }
      }
    }
    
    sceneCutsCache = {
      ...data,
      chunksByFilename,
      chunksByVideoId,
      chunksByPartId,
    };
    
    console.log(`[sceneCuts] Loaded scene cuts: ${data.totalCuts} cuts across ${data.chunks?.length || 0} videos (threshold: ${data.threshold})`);
    
    return sceneCutsCache;
  } catch (error) {
    console.error("[sceneCuts] Failed to load clip-boundaries.json:", error.message);
    sceneCutsLoadError = error.message;
    return null;
  }
};

/**
 * Get the chunk data for a video by its ID or filename
 * 
 * @param {string} videoIdOrFilename - Twelve Labs videoId or filename
 * @returns {Object|null} Chunk data with cuts array, or null
 */
export const getChunkData = (videoIdOrFilename) => {
  const data = loadSceneCuts();
  if (!data) return null;
  
  // Try partId (preferred for app-level calls)
  if (data.chunksByPartId?.[videoIdOrFilename]) {
    return data.chunksByPartId[videoIdOrFilename];
  }

  // Try videoId first
  if (data.chunksByVideoId[videoIdOrFilename]) {
    return data.chunksByVideoId[videoIdOrFilename];
  }
  
  // Try filename
  if (data.chunksByFilename[videoIdOrFilename]) {
    return data.chunksByFilename[videoIdOrFilename];
  }
  
  // Try mapping videoId to filename
  const filename = VIDEO_ID_TO_FILENAME[videoIdOrFilename];
  if (filename && data.chunksByFilename[filename]) {
    return data.chunksByFilename[filename];
  }
  
  return null;
};

export const getChunkMetadata = (videoIdOrFilename) => {
  const chunk = getChunkData(videoIdOrFilename);
  if (!chunk) return null;
  return {
    filename: chunk.filename,
    videoId: chunk.videoId || FILENAME_TO_VIDEO_ID[chunk.filename] || null,
    fps: chunk.fps || null,
    frameDuration: chunk.frameDuration || (chunk.fps ? 1 / chunk.fps : null),
    durationSeconds: toNumber(chunk.duration) || null,
    durationFrames: Number.isFinite(chunk.durationFrames) ? chunk.durationFrames : null,
  };
};

export const getCutEntries = (videoIdOrFilename) => {
  const chunk = getChunkData(videoIdOrFilename);
  return chunk?.cutEntries || chunk?.cuts || [];
};

export const getCutsSeconds = (videoIdOrFilename) => {
  const cuts = getCutEntries(videoIdOrFilename);
  return cuts.map((c) => (typeof c === "number" ? c : toNumber(c.frameSeconds, toNumber(c.rawSeconds, 0)))).filter((v) => typeof v === "number");
};

export const getCutsFrames = (videoIdOrFilename) => {
  const chunk = getChunkData(videoIdOrFilename);
  const fps = pickFps(chunk) || DEFAULT_FRAME_RATE;
  const cuts = getCutEntries(videoIdOrFilename);
  return cuts
    .map((c) => {
      if (c && typeof c === "object" && Number.isInteger(c.frameIndex)) return c.frameIndex;
      const seconds = typeof c === "number" ? c : toNumber(c.frameSeconds, toNumber(c.rawSeconds, null));
      return seconds != null ? Math.round(seconds * fps) : null;
    })
    .filter((v) => Number.isInteger(v));
};

/**
 * Binary search to find the index of the first cut >= startTime
 * 
 * @param {number[]} cuts - Sorted array of cut timestamps
 * @param {number} time - Time to search for
 * @returns {number} Index of first cut >= time, or cuts.length if none
 */
const binarySearchCuts = (cuts, time) => {
  let left = 0;
  let right = cuts.length;
  
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (cuts[mid] < time) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  
  return left;
};

/**
 * Get all cuts within a time range for a video
 * Uses binary search for efficient lookup
 * 
 * @param {string} videoId - Twelve Labs videoId or filename
 * @param {number} startTime - Start of range (seconds)
 * @param {number} endTime - End of range (seconds)
 * @returns {number[]} Array of cut timestamps within range
 */
export const getCutsInRange = (videoId, startTime, endTime) => {
  const chunk = getChunkData(videoId);
  if (!chunk || !chunk.cuts || chunk.cuts.length === 0) {
    return [];
  }
  
  const cuts = chunk.cuts;
  
  // Find first cut >= startTime
  const startIdx = binarySearchCuts(cuts, startTime);
  
  // Collect cuts until we exceed endTime
  const result = [];
  for (let i = startIdx; i < cuts.length && cuts[i] < endTime; i++) {
    result.push(cuts[i]);
  }
  
  return result;
};

/**
 * Check if a segment is cut-free
 * 
 * @param {string} videoId - Twelve Labs videoId or filename
 * @param {number} startTime - Start of segment (seconds)
 * @param {number} endTime - End of segment (seconds)
 * @returns {boolean} True if no cuts exist in the segment
 */
export const isSegmentCutFree = (videoId, startTime, endTime) => {
  const cuts = getCutsInRange(videoId, startTime, endTime);
  return cuts.length === 0;
};

/**
 * Find the best cut-free window within a clip's time range
 * Tries to find a segment of requiredDuration that has no internal cuts
 * 
 * @param {string} videoId - Twelve Labs videoId or filename
 * @param {number} clipStart - Start of available clip range
 * @param {number} clipEnd - End of available clip range
 * @param {number} requiredDuration - Required duration for the segment
 * @param {Object} options - Options
 * @param {number} options.buffer - Buffer time around cuts (default 0.05)
 * @param {boolean} options.preferStart - Prefer windows closer to clipStart (default true)
 * @returns {{found: boolean, start: number, end: number, cutsAvoided: number}}
 */
export const findCutFreeWindow = (videoId, clipStart, clipEnd, requiredDuration, options = {}) => {
  const {
    buffer = 0.05,
    preferStart = true,
  } = options;
  
  const chunk = getChunkData(videoId);
  
  // If no cut data available, assume the segment is fine
  if (!chunk || !chunk.cuts || chunk.cuts.length === 0) {
    return {
      found: true,
      start: clipStart,
      end: clipStart + requiredDuration,
      cutsAvoided: 0,
      reason: "no_cut_data",
    };
  }
  
  const cuts = chunk.cuts;
  const totalRequired = requiredDuration + buffer;
  
  // If clip range is too short, can't fit required duration
  if (clipEnd - clipStart < totalRequired) {
    return {
      found: false,
      start: clipStart,
      end: clipStart + requiredDuration,
      cutsAvoided: 0,
      reason: "clip_too_short",
    };
  }
  
  // Get cuts within the clip range (with some buffer on each side)
  const relevantCuts = cuts.filter(t => t > clipStart - buffer && t < clipEnd + buffer);
  
  // If no cuts in range, the whole clip is fine
  if (relevantCuts.length === 0) {
    return {
      found: true,
      start: clipStart,
      end: clipStart + requiredDuration,
      cutsAvoided: 0,
      reason: "no_cuts_in_range",
    };
  }
  
  // Build boundaries: [clipStart, cut1, cut2, ..., cutN, clipEnd]
  const boundaries = [clipStart, ...relevantCuts.filter(t => t > clipStart && t < clipEnd), clipEnd];
  
  // Find all valid windows (gaps between cuts that are large enough)
  const validWindows = [];
  
  for (let i = 0; i < boundaries.length - 1; i++) {
    const gapStart = boundaries[i];
    const gapEnd = boundaries[i + 1];
    const gapDuration = gapEnd - gapStart;
    
    if (gapDuration >= totalRequired) {
      // This gap can fit our required duration
      // Position the window with buffer from cut boundaries
      const safeStart = i === 0 ? gapStart : gapStart + buffer;
      const safeEnd = safeStart + requiredDuration;
      
      // Verify we don't exceed the gap
      if (safeEnd <= gapEnd - (i === boundaries.length - 2 ? 0 : buffer)) {
        validWindows.push({
          start: safeStart,
          end: safeEnd,
          gapSize: gapDuration,
          distanceFromClipStart: safeStart - clipStart,
        });
      }
    }
  }
  
  if (validWindows.length === 0) {
    return {
      found: false,
      start: clipStart,
      end: clipStart + requiredDuration,
      cutsAvoided: relevantCuts.length,
      reason: "no_valid_windows",
    };
  }
  
  // Sort windows by preference
  if (preferStart) {
    validWindows.sort((a, b) => a.distanceFromClipStart - b.distanceFromClipStart);
  } else {
    // Prefer largest gaps
    validWindows.sort((a, b) => b.gapSize - a.gapSize);
  }
  
  const best = validWindows[0];
  return {
    found: true,
    start: best.start,
    end: best.end,
    cutsAvoided: relevantCuts.length,
    reason: "found_window",
  };
};

/**
 * Find multiple cut-free windows within a clip
 * Useful for clips that will be reused multiple times
 * 
 * @param {string} videoId - Twelve Labs videoId or filename
 * @param {number} clipStart - Start of available clip range
 * @param {number} clipEnd - End of available clip range
 * @param {number} requiredDuration - Required duration for each segment
 * @param {Object} options - Options
 * @returns {Array<{start: number, end: number}>} Array of valid windows
 */
export const findAllCutFreeWindows = (videoId, clipStart, clipEnd, requiredDuration, options = {}) => {
  const { buffer = 0.05 } = options;
  
  const chunk = getChunkData(videoId);
  
  // If no cut data, return the whole clip as one window
  if (!chunk || !chunk.cuts || chunk.cuts.length === 0) {
    const numWindows = Math.floor((clipEnd - clipStart) / requiredDuration);
    const windows = [];
    for (let i = 0; i < numWindows; i++) {
      windows.push({
        start: clipStart + i * requiredDuration,
        end: clipStart + (i + 1) * requiredDuration,
      });
    }
    return windows;
  }
  
  const cuts = chunk.cuts;
  const totalRequired = requiredDuration + buffer;
  
  // Get cuts within range
  const relevantCuts = cuts.filter(t => t > clipStart && t < clipEnd);
  
  // Build boundaries
  const boundaries = [clipStart, ...relevantCuts, clipEnd];
  
  // Find all windows
  const windows = [];
  
  for (let i = 0; i < boundaries.length - 1; i++) {
    const gapStart = boundaries[i];
    const gapEnd = boundaries[i + 1];
    const gapDuration = gapEnd - gapStart;
    
    // How many windows can fit in this gap?
    const safeGapStart = i === 0 ? gapStart : gapStart + buffer;
    const safeGapEnd = i === boundaries.length - 2 ? gapEnd : gapEnd - buffer;
    const safeGapDuration = safeGapEnd - safeGapStart;
    
    const numWindowsInGap = Math.floor(safeGapDuration / requiredDuration);
    
    for (let j = 0; j < numWindowsInGap; j++) {
      windows.push({
        start: safeGapStart + j * requiredDuration,
        end: safeGapStart + (j + 1) * requiredDuration,
      });
    }
  }
  
  return windows;
};

/**
 * Get statistics about a video's cuts
 * 
 * @param {string} videoId - Twelve Labs videoId or filename
 * @returns {Object|null} Statistics or null if no data
 */
export const getVideoStats = (videoId) => {
  const chunk = getChunkData(videoId);
  if (!chunk) {
    return null;
  }
  
  const cuts = chunk.cuts || [];
  const duration = chunk.duration || 0;
  
  if (cuts.length === 0) {
    return {
      videoId,
      filename: chunk.filename,
      duration,
      cutCount: 0,
      avgSegmentLength: duration,
      longestSegment: { start: 0, end: duration, duration },
      shortestSegment: { start: 0, end: duration, duration },
    };
  }
  
  // Calculate segment lengths (gaps between cuts)
  const boundaries = [0, ...cuts, duration];
  const segments = [];
  
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    segments.push({
      start: segStart,
      end: segEnd,
      duration: segEnd - segStart,
    });
  }
  
  // Find longest and shortest
  segments.sort((a, b) => b.duration - a.duration);
  
  const totalSegmentDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const avgSegmentLength = totalSegmentDuration / segments.length;
  
  return {
    videoId,
    filename: chunk.filename,
    duration,
    cutCount: cuts.length,
    avgSegmentLength,
    longestSegment: segments[0],
    shortestSegment: segments[segments.length - 1],
    segments,
  };
};

/**
 * Check if scene cuts data is available
 * 
 * @returns {boolean} True if data is loaded and available
 */
export const hasSceneCutsData = () => {
  const data = loadSceneCuts();
  return data !== null;
};

/**
 * Get the threshold used for scene detection
 * 
 * @returns {number|null} Threshold value or null if no data
 */
export const getDetectionThreshold = () => {
  const data = loadSceneCuts();
  return data?.threshold || null;
};

/**
 * Clear the cached scene cuts data
 * Useful for testing or when the data file is updated
 */
export const clearCache = () => {
  sceneCutsCache = null;
  sceneCutsLoadError = null;
};

// ============================================================================
// Exports
// ============================================================================

export { VIDEO_ID_TO_FILENAME, FILENAME_TO_VIDEO_ID };

export default {
  loadSceneCuts,
  getChunkData,
  getCutsInRange,
  isSegmentCutFree,
  findCutFreeWindow,
  findAllCutFreeWindows,
  getVideoStats,
  hasSceneCutsData,
  getDetectionThreshold,
  clearCache,
  VIDEO_ID_TO_FILENAME,
  FILENAME_TO_VIDEO_ID,
};

