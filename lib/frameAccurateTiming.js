/**
 * Frame-Accurate Timing Library
 * 
 * Provides precise frame-based timing calculations for video edits.
 * Using frame numbers (integers) instead of seconds (floats) eliminates
 * floating-point precision errors and ensures exact clip synchronization.
 */

// Default target framerate for all edits
export const TARGET_FPS = 30;

/**
 * Convert seconds to the nearest frame number
 * @param {number} seconds - Time in seconds
 * @param {number} fps - Frames per second (default 30)
 * @returns {number} Frame number (integer)
 */
export const secondsToFrame = (seconds, fps = TARGET_FPS) => {
  if (!isFinite(seconds) || isNaN(seconds)) return 0;
  return Math.round(seconds * fps);
};

/**
 * Convert frame number to exact seconds
 * @param {number} frame - Frame number
 * @param {number} fps - Frames per second (default 30)
 * @returns {number} Time in seconds
 */
export const frameToSeconds = (frame, fps = TARGET_FPS) => {
  if (!isFinite(frame) || isNaN(frame)) return 0;
  return frame / fps;
};

/**
 * Convert a duration in seconds to frame count
 * Uses floor to ensure we don't request more frames than available
 * @param {number} durationSeconds - Duration in seconds
 * @param {number} fps - Frames per second (default 30)
 * @returns {number} Number of frames
 */
export const durationToFrameCount = (durationSeconds, fps = TARGET_FPS) => {
  if (!isFinite(durationSeconds) || isNaN(durationSeconds)) return 0;
  return Math.max(1, Math.floor(durationSeconds * fps));
};

/**
 * Calculate the minimum source clip duration needed for a given frame count
 * Adds a small buffer to account for codec boundary issues
 * @param {number} frameCount - Required number of frames
 * @param {number} fps - Frames per second (default 30)
 * @returns {number} Minimum source duration in seconds
 */
export const frameCountToMinDuration = (frameCount, fps = TARGET_FPS) => {
  // Add 2 frames worth of buffer to handle keyframe boundaries
  return (frameCount + 2) / fps;
};

/**
 * Filter a segment grid using segment metadata where layerEnabled can disable segments.
 * @param {number[]} segmentGrid - Segment times in seconds
 * @param {Array<{segmentTime?: number, beatTime?: number, time?: number, layerEnabled?: boolean}>} segmentMetadata
 * @returns {number[]} Filtered segment grid
 */
export const getEnabledSegmentGrid = (segmentGrid = [], segmentMetadata = []) => {
  if (!Array.isArray(segmentGrid) || segmentGrid.length === 0) return [];
  if (!Array.isArray(segmentMetadata) || segmentMetadata.length === 0) return segmentGrid;

  const disabledKeys = new Set();
  segmentMetadata.forEach((entry) => {
    const raw =
      typeof entry?.segmentTime === "number"
        ? entry.segmentTime
        : typeof entry?.beatTime === "number" // legacy
        ? entry.beatTime
        : typeof entry?.time === "number"
        ? entry.time
        : null;
    if (raw === null) return;
    const key = Number(raw.toFixed(3));
    if (entry.layerEnabled === false) {
      disabledKeys.add(key);
    }
  });

  return segmentGrid.filter((time) => {
    const key = Number(time.toFixed(3));
    return !disabledKeys.has(key);
  });
};

// Legacy alias
export const getEnabledBeatGrid = getEnabledSegmentGrid;

/**
 * Convert segment grid (array of seconds) to frame-based segment marks
 * @param {number[]} segmentGrid - Array of segment times in seconds
 * @param {number} fps - Frames per second (default 30)
 * @returns {Array<{time: number, frame: number}>}
 */
export const segmentGridToFrames = (segmentGrid, fps = TARGET_FPS) => {
  if (!Array.isArray(segmentGrid)) return [];
  
  return segmentGrid.map((time) => ({
    time: time,
    frame: secondsToFrame(time, fps),
  }));
};

// Legacy alias
export const beatGridToFrames = segmentGridToFrames;
/**
 * Expand rapid clip ranges into frame-based markers
 * Uses integer frame math to avoid floating-point accumulation errors
 * @param {Array<{start: number, end: number, interval: number}>} rapidClipRanges
 * @param {number} fps - Frames per second (default 30)
 * @returns {Array<{time: number, frame: number}>}
 */
export const rapidRangesToFrames = (rapidClipRanges, fps = TARGET_FPS) => {
  if (!Array.isArray(rapidClipRanges)) return [];
  
  const frames = [];
  
  rapidClipRanges.forEach((range) => {
    const startFrame = secondsToFrame(range.start, fps);
    const endFrame = secondsToFrame(range.end, fps);
    // Convert interval to frames (minimum 1 frame)
    const frameInterval = Math.max(1, secondsToFrame(range.interval || 0.1, fps));
    
    // Use integer frame iteration to avoid floating-point errors
    for (let f = startFrame; f <= endFrame; f += frameInterval) {
      frames.push({
        frame: f,
        time: frameToSeconds(f, fps), // Derive time from frame for consistency
      });
    }
  });
  
  return frames;
};

/**
 * Calculate all clip segments with exact frame counts
 * This is the core function for generating a frame-accurate edit plan
 * 
 * @param {Object} format - Song format object
 * @param {number[]} format.segmentGrid - Array of segment times in seconds (preferred)
 * @param {number[]} format.beatGrid - Legacy array of beat times in seconds
 * @param {Array} format.rapidClipRanges - Rapid clip range definitions
 * @param {Object} format.meta - Metadata including duration
 * @returns {Object} { segments, fps, totalFrames }
 */
export const calculateFrameSegments = (format) => {
  const fps = format.meta?.targetFps || TARGET_FPS;
  const totalDuration = format.meta?.durationSeconds || 0;
  const totalFrames = secondsToFrame(totalDuration, fps);
  
  // Collect all clip change points
  const clipChangeFrames = new Map(); // Use Map to dedupe by frame number
  
  // Add segment grid marks (legacy beat naming supported)
  const segmentGrid = Array.isArray(format.segmentGrid) && format.segmentGrid.length
    ? format.segmentGrid
    : format.beatGrid || [];
  if (segmentGrid.length) {
    segmentGrid.forEach((time) => {
      const frame = secondsToFrame(time, fps);
      if (!clipChangeFrames.has(frame)) {
        clipChangeFrames.set(frame, { frame, type: "segment", time });
      }
    });
  }
  
  // Add rapid clip range marks
  if (format.rapidClipRanges?.length) {
    const rapidFrames = rapidRangesToFrames(format.rapidClipRanges, fps);
    rapidFrames.forEach(({ frame, time }) => {
      if (!clipChangeFrames.has(frame)) {
        clipChangeFrames.set(frame, { frame, type: "rapid", time });
      }
    });
  }
  
  // Sort by frame number
  const sortedChanges = [...clipChangeFrames.values()].sort((a, b) => a.frame - b.frame);
  
  // Handle edge case: no marks defined
  if (sortedChanges.length === 0) {
    return {
      segments: [{
        index: 0,
        startFrame: 0,
        endFrame: totalFrames,
        frameCount: totalFrames,
        startSeconds: 0,
        endSeconds: totalDuration,
        durationSeconds: totalDuration,
        type: "full",
      }],
      fps,
      totalFrames,
    };
  }
  
  // Build segments with exact frame counts
  // IMPORTANT: Marks indicate the START of a NEW clip, not the end of the previous one
  // So we need N+1 segments for N marks:
  //   - Segment 0: frame 0 → first mark (intro/lead-in)
  //   - Segment 1: first mark → second mark
  //   - ...
  //   - Segment N: last mark → end of song
  const segments = [];
  
  // First segment: from start (frame 0) to first change point
  const firstChange = sortedChanges[0];
  if (firstChange.frame > 0) {
    const frameCount = firstChange.frame;
    segments.push({
      index: 0,
      startFrame: 0,
      endFrame: firstChange.frame,
      frameCount,
      startSeconds: 0,
      endSeconds: frameToSeconds(firstChange.frame, fps),
      durationSeconds: frameToSeconds(frameCount, fps),
      type: "intro", // First segment before any marks
      minSourceDuration: frameCountToMinDuration(frameCount, fps),
    });
  }
  
  // Remaining segments: from each mark to the next (or end of song)
  for (let i = 0; i < sortedChanges.length; i++) {
    const current = sortedChanges[i];
    const next = sortedChanges[i + 1];
    
    const startFrame = current.frame;
    const endFrame = next ? next.frame : totalFrames;
    const frameCount = endFrame - startFrame;
    
    // Skip zero-length segments (shouldn't happen but safety check)
    if (frameCount <= 0) continue;
    
    segments.push({
      index: segments.length,
      startFrame,
      endFrame,
      frameCount,
      startSeconds: frameToSeconds(startFrame, fps),
      endSeconds: frameToSeconds(endFrame, fps),
      durationSeconds: frameToSeconds(frameCount, fps),
      type: current.type,
      // Store the minimum source clip duration needed
      minSourceDuration: frameCountToMinDuration(frameCount, fps),
    });
  }
  
  return { segments, fps, totalFrames };
};

/**
 * Calculate segments for a single layer with optional per-segment enable filtering.
 * @param {Object} layer - Layer data (background or foreground)
 * @param {number[]} layer.segmentGrid - Segment times in seconds (preferred)
 * @param {number[]} layer.beatGrid - Segment times in seconds (legacy name)
 * @param {Array} layer.beatMetadata - Segment metadata (optional layerEnabled)
 * @param {Array} layer.rapidClipRanges - Rapid clip range definitions
 * @param {Object} layer.meta - Shared meta with durationSeconds/targetFps
 * @returns {{segments: Array, fps: number, totalFrames: number}}
 */
export const calculateLayerSegments = (layer = {}) => {
  const enabledBeatGrid = getEnabledSegmentGrid(
    (layer.segmentGrid && layer.segmentGrid.length ? layer.segmentGrid : layer.beatGrid) || [],
    layer.beatMetadata || []
  );
  return calculateFrameSegments({
    segmentGrid: enabledBeatGrid,
    rapidClipRanges: layer.rapidClipRanges || [],
    meta: layer.meta || {},
  });
};

/**
 * Calculate segments for background and optional foreground layers.
 * Keeps backwards-compatible background calculation.
 * @param {Object} format - Format containing background + optional foreground
 * @returns {{backgroundSegments: Array, foregroundSegments: Array, fps: number, totalFrames: number}}
 */
export const calculateLayeredSegments = (format = {}) => {
  const backgroundResult = calculateFrameSegments(format);
  const foreground = format.foreground || null;

  const foregroundResult = foreground
    ? calculateLayerSegments({
        segmentGrid: (foreground.segmentGrid && foreground.segmentGrid.length
          ? foreground.segmentGrid
          : foreground.beatGrid) || [],
        beatMetadata: foreground.beatMetadata || [],
        rapidClipRanges: foreground.rapidClipRanges || [],
        meta: format.meta || {},
      })
    : { segments: [], fps: backgroundResult.fps, totalFrames: backgroundResult.totalFrames };

  return {
    backgroundSegments: backgroundResult.segments,
    foregroundSegments: foregroundResult.segments,
    fps: backgroundResult.fps,
    totalFrames: backgroundResult.totalFrames,
  };
};

/**
 * Validate that a clip has enough frames for a segment
 * @param {number} clipDurationSeconds - Actual clip duration in seconds
 * @param {number} requiredFrames - Number of frames needed
 * @param {number} fps - Frames per second (default 30)
 * @returns {{valid: boolean, actualFrames: number, message: string}}
 */
export const validateClipFrameCount = (clipDurationSeconds, requiredFrames, fps = TARGET_FPS) => {
  const actualFrames = Math.floor(clipDurationSeconds * fps);
  const valid = actualFrames >= requiredFrames;
  
  return {
    valid,
    actualFrames,
    requiredFrames,
    message: valid 
      ? `OK: ${actualFrames} frames available (need ${requiredFrames})`
      : `FAIL: Only ${actualFrames} frames available, need ${requiredFrames}`,
  };
};

/**
 * Build FFmpeg filter for frame-accurate trimming
 * Uses frame count instead of duration for exact timing
 * 
 * @param {number} inputIndex - FFmpeg input index
 * @param {number} outputIndex - Output label index
 * @param {Object} segment - Segment with frameCount
 * @param {number} fps - Target FPS
 * @param {Object} options - Additional options
 * @returns {string} FFmpeg filter string
 */
export const buildFrameAccurateVideoFilter = (
  inputIndex,
  outputIndex,
  segment,
  fps = TARGET_FPS,
  options = {}
) => {
  const {
    width = 1920,
    height = 1080,
    showOverlay = true,
  } = options;
  
  const frameCount = segment.frameCount;
  
  let filter = `[${inputIndex}:v]`;
  
  // 1. Force consistent framerate first
  filter += `fps=${fps},`;
  
  // 2. Trim by exact frame count (not duration!)
  filter += `trim=end_frame=${frameCount},setpts=PTS-STARTPTS,`;
  
  // 3. Scale and pad to target dimensions
  filter += `scale=${width}:${height}:force_original_aspect_ratio=decrease,`;
  filter += `pad=${width}:${height}:(${width}-iw)/2:(${height}-ih)/2:color=black,setsar=1`;
  
  // 4. Optional debug overlay
  if (showOverlay) {
    const clipNum = outputIndex + 1;
    const clipType = segment.type === "rapid" ? "R" : "B";
    const songTime = segment.startSeconds.toFixed(2);
    const dur = segment.durationSeconds.toFixed(3);
    const frames = segment.frameCount;
    
    const overlayText = `Clip ${clipNum} [${clipType}] @${songTime}s (${dur}s/${frames}f)`;
    const escapedText = overlayText.replace(/:/g, "\\:").replace(/'/g, "\\'");
    
    filter += `,drawtext=text='${escapedText}':fontsize=28:fontcolor=white:x=20:y=20:`;
    filter += `box=1:boxcolor=black@0.7:boxborderw=5`;
  }
  
  filter += `[v${outputIndex}]`;
  
  return filter;
};

/**
 * Build FFmpeg audio filter (mute video audio)
 * @param {number} inputIndex - FFmpeg input index
 * @param {number} outputIndex - Output label index
 * @returns {string} FFmpeg filter string
 */
export const buildAudioMuteFilter = (inputIndex, outputIndex) => {
  return `[${inputIndex}:a]volume=0[a${outputIndex}]`;
};

/**
 * Generate summary statistics for a frame-accurate edit plan
 * @param {Object} plan - Edit plan with segments
 * @returns {Object} Statistics
 */
export const getEditPlanStats = (plan) => {
  const { segments, fps, totalFrames } = plan;
  
  const totalClips = segments.length;
  const beatClips = segments.filter(s => s.type === "beat").length; // legacy
  const segmentClips = segments.filter(s => s.type === "segment").length;
  const rapidClips = segments.filter(s => s.type === "rapid").length;
  
  const minFrames = Math.min(...segments.map(s => s.frameCount));
  const maxFrames = Math.max(...segments.map(s => s.frameCount));
  const avgFrames = totalFrames / totalClips;
  
  const minDuration = frameToSeconds(minFrames, fps);
  const maxDuration = frameToSeconds(maxFrames, fps);
  const avgDuration = frameToSeconds(avgFrames, fps);
  
  return {
    totalClips,
    beatClips,
    segmentClips,
    rapidClips,
    fps,
    totalFrames,
    totalDurationSeconds: frameToSeconds(totalFrames, fps),
    minClipFrames: minFrames,
    maxClipFrames: maxFrames,
    avgClipFrames: Math.round(avgFrames),
    minClipDuration: minDuration,
    maxClipDuration: maxDuration,
    avgClipDuration: avgDuration,
  };
};

export default {
  TARGET_FPS,
  secondsToFrame,
  frameToSeconds,
  durationToFrameCount,
  frameCountToMinDuration,
  segmentGridToFrames,
  beatGridToFrames,
  rapidRangesToFrames,
  calculateFrameSegments,
  calculateLayerSegments,
  calculateLayeredSegments,
  validateClipFrameCount,
  buildFrameAccurateVideoFilter,
  buildAudioMuteFilter,
  getEditPlanStats,
};

