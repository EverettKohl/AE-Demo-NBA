/**
 * Video validation utilities using ffprobe and ffmpeg
 */

import { spawn } from "child_process";
import fsSync from "fs";
import path from "path";

/**
 * Get ffmpeg path from ffmpeg-static
 */
const getFfmpegPath = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fsSync.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) {
    // ignore
  }
  return process.env.FFMPEG_PATH || "ffmpeg";
};

/**
 * Get ffprobe path (usually bundled with ffmpeg-static)
 */
const getFfprobePath = () => {
  try {
    // Try to find ffprobe in the same directory as ffmpeg
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fsSync.existsSync(ffmpegStatic)) {
      const ffmpegDir = path.dirname(ffmpegStatic);
      const ffprobePath = path.join(ffmpegDir, "ffprobe");
      if (fsSync.existsSync(ffprobePath)) {
        return ffprobePath;
      }
    }
  } catch (e) {
    // ignore
  }
  return process.env.FFPROBE_PATH || "ffprobe";
};

/**
 * Get video metadata using ffprobe
 * @param {string} videoPath - Path to video file
 * @returns {Promise<{duration: number, width: number, height: number, frameCount: number, streams: number}>}
 */
export const getVideoMetadata = async (videoPath) => {
  const ffprobeBin = getFfprobePath();
  
  return new Promise((resolve, reject) => {
    const args = [
      "-count_frames",
      "-v",
      "error",
      "-show_entries",
      "format=duration,size:stream=width,height,nb_frames,nb_read_frames,codec_type",
      "-of",
      "json",
      videoPath,
    ];

    const ffprobe = spawn(ffprobeBin, args);
    let stdout = "";
    let stderr = "";

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const metadata = JSON.parse(stdout);
        const format = metadata.format || {};
        const streams = metadata.streams || [];
        
        const videoStream = streams.find((s) => s.codec_type === "video");
        const audioStreams = streams.filter((s) => s.codec_type === "audio");

        const duration = parseFloat(format.duration) || 0;
        const width = parseInt(videoStream?.width || 0, 10);
        const height = parseInt(videoStream?.height || 0, 10);
        // Prefer the authoritative frame counter (-count_frames -> nb_read_frames)
        const frameCount = parseInt(
          videoStream?.nb_read_frames ?? videoStream?.nb_frames ?? 0,
          10
        );

        resolve({
          duration,
          width,
          height,
          frameCount,
          videoStreams: videoStream ? 1 : 0,
          audioStreams: audioStreams.length,
          totalStreams: streams.length,
        });
      } catch (error) {
        reject(new Error(`Failed to parse ffprobe output: ${error.message}`));
      }
    });

    ffprobe.on("error", (error) => {
      reject(new Error(`Failed to spawn ffprobe: ${error.message}`));
    });
  });
};

/**
 * Validate video meets requirements
 * @param {string} videoPath - Path to video file
 * @param {Object} requirements - Validation requirements
 * @param {number} requirements.minDuration - Minimum duration in seconds
 * @param {number} requirements.expectedSegments - Expected number of segments (optional)
 * @returns {Promise<{valid: boolean, metadata: Object, errors: string[]}>}
 */
export const validateVideo = async (videoPath, requirements = {}) => {
  const { minDuration = 15, expectedSegments = null } = requirements;
  const errors = [];

  try {
    const metadata = await getVideoMetadata(videoPath);

    if (metadata.duration < minDuration) {
      errors.push(
        `Video duration (${metadata.duration.toFixed(2)}s) is less than required minimum (${minDuration}s)`
      );
    }

    if (metadata.videoStreams === 0) {
      errors.push("Video has no video streams");
    }

    if (metadata.audioStreams === 0) {
      errors.push("Video has no audio streams");
    }

    // Note: We can't directly count segments from metadata, but we can check
    // if the duration roughly matches expectations
    if (expectedSegments !== null) {
      const avgSegmentDuration = metadata.duration / expectedSegments;
      if (avgSegmentDuration < 1 || avgSegmentDuration > 15) {
        errors.push(
          `Video duration suggests incorrect number of segments. Expected ~${expectedSegments} segments, but average segment duration is ${avgSegmentDuration.toFixed(2)}s`
        );
      }
    }

    return {
      valid: errors.length === 0,
      metadata,
      errors,
    };
  } catch (error) {
    return {
      valid: false,
      metadata: null,
      errors: [`Failed to validate video: ${error.message}`],
    };
  }
};

/**
 * Default threshold for scene change detection (0-1 scale)
 * Higher values = only detect larger changes
 * 0.3 is a good starting point for detecting hard cuts
 */
const DEFAULT_SCENE_THRESHOLD = 0.3;

/**
 * Detect cuts (scene changes) within a video file or segment
 * Uses FFmpeg's scene detection filter
 * 
 * @param {string} videoPath - Path to video file
 * @param {Object} options - Detection options
 * @param {number} options.startTime - Start time in seconds (optional)
 * @param {number} options.endTime - End time in seconds (optional)
 * @param {number} options.threshold - Scene change threshold 0-1 (default 0.3)
 * @returns {Promise<{hasCuts: boolean, cuts: Array<{time: number, score: number}>, error: string|null}>}
 */
export const detectCutsInClip = async (videoPath, options = {}) => {
  const {
    startTime = null,
    endTime = null,
    threshold = DEFAULT_SCENE_THRESHOLD,
  } = options;

  const ffmpegBin = getFfmpegPath();
  
  return new Promise((resolve) => {
    const args = [];
    
    // Add seek options if start/end times specified
    if (startTime !== null && startTime > 0) {
      args.push("-ss", startTime.toFixed(3));
    }
    
    args.push("-i", videoPath);
    
    if (endTime !== null) {
      const duration = startTime !== null ? endTime - startTime : endTime;
      args.push("-t", duration.toFixed(3));
    }
    
    // Use select filter with scene detection and showinfo to get frame info
    // The scene value ranges from 0 to 1, where higher values indicate bigger changes
    args.push(
      "-vf",
      `select='gt(scene,${threshold})',showinfo`,
      "-f",
      "null",
      "-"
    );

    const ffmpeg = spawn(ffmpegBin, args);
    let stderr = "";
    const cuts = [];

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0 && !stderr.includes("frame=")) {
        // FFmpeg error, but not a simple "no frames selected" case
        resolve({
          hasCuts: false,
          cuts: [],
          error: `FFmpeg scene detection failed: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Parse showinfo output to find scene change timestamps
      // Format: [Parsed_showinfo_1 @ ...] n:0 pts:12345 pts_time:1.234 ...
      const ptsTimeRegex = /pts_time:(\d+\.?\d*)/g;
      let match;
      
      while ((match = ptsTimeRegex.exec(stderr)) !== null) {
        const time = parseFloat(match[1]);
        // Adjust for startTime offset if seeking was used
        const adjustedTime = startTime !== null ? time + startTime : time;
        cuts.push({
          time: adjustedTime,
          score: threshold, // We don't get exact scores with this method
        });
      }

      resolve({
        hasCuts: cuts.length > 0,
        cuts,
        error: null,
      });
    });

    ffmpeg.on("error", (error) => {
      resolve({
        hasCuts: false,
        cuts: [],
        error: `Failed to spawn ffmpeg: ${error.message}`,
      });
    });
  });
};

/**
 * Detect all cuts in an entire video file
 * Returns timestamps of all scene changes
 * 
 * @param {string} videoPath - Path to video file
 * @param {number} threshold - Scene change threshold 0-1 (default 0.3)
 * @returns {Promise<{cuts: number[], duration: number, error: string|null}>}
 */
export const detectAllCutsInVideo = async (videoPath, threshold = DEFAULT_SCENE_THRESHOLD) => {
  const ffmpegBin = getFfmpegPath();
  
  // First get the video duration
  let duration = 0;
  try {
    const metadata = await getVideoMetadata(videoPath);
    duration = metadata.duration;
  } catch (e) {
    // Continue anyway, we'll detect cuts
  }

  return new Promise((resolve) => {
    const args = [
      "-i",
      videoPath,
      "-vf",
      `select='gt(scene,${threshold})',showinfo`,
      "-f",
      "null",
      "-"
    ];

    const ffmpeg = spawn(ffmpegBin, args);
    let stderr = "";
    const cuts = [];

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      // Parse showinfo output
      const ptsTimeRegex = /pts_time:(\d+\.?\d*)/g;
      let match;
      
      while ((match = ptsTimeRegex.exec(stderr)) !== null) {
        cuts.push(parseFloat(match[1]));
      }

      // Sort cuts by time
      cuts.sort((a, b) => a - b);

      resolve({
        cuts,
        duration,
        error: code !== 0 && cuts.length === 0 ? stderr.slice(-200) : null,
      });
    });

    ffmpeg.on("error", (error) => {
      resolve({
        cuts: [],
        duration,
        error: `Failed to spawn ffmpeg: ${error.message}`,
      });
    });
  });
};

/**
 * Find a segment within a video that has no cuts
 * 
 * @param {string} videoPath - Path to video file
 * @param {number} requiredDuration - Required duration for the cut-free segment
 * @param {Object} options - Options
 * @param {number} options.threshold - Scene change threshold (default 0.3)
 * @param {number} options.buffer - Extra buffer time to ensure clean cuts (default 0.1)
 * @param {number} options.maxStartTime - Maximum start time to search (optional, uses video duration)
 * @returns {Promise<{found: boolean, start: number, end: number, error: string|null}>}
 */
export const findCutFreeSegment = async (videoPath, requiredDuration, options = {}) => {
  const {
    threshold = DEFAULT_SCENE_THRESHOLD,
    buffer = 0.1,
    maxStartTime = null,
  } = options;

  // Detect all cuts in the video
  const { cuts, duration, error } = await detectAllCutsInVideo(videoPath, threshold);
  
  if (error && cuts.length === 0) {
    return {
      found: false,
      start: 0,
      end: 0,
      error,
    };
  }

  const videoDuration = duration || maxStartTime || 60; // Fallback to 60s if unknown
  const searchLimit = maxStartTime !== null ? Math.min(maxStartTime, videoDuration) : videoDuration;
  const totalRequired = requiredDuration + buffer;

  // If no cuts detected, the whole video is cut-free
  if (cuts.length === 0) {
    if (videoDuration >= totalRequired) {
      return {
        found: true,
        start: 0,
        end: requiredDuration,
        error: null,
      };
    }
    return {
      found: false,
      start: 0,
      end: 0,
      error: `Video too short (${videoDuration.toFixed(2)}s) for required duration (${totalRequired.toFixed(2)}s)`,
    };
  }

  // Add virtual "cuts" at start and end to simplify gap finding
  const boundaries = [0, ...cuts, videoDuration];
  
  // Find gaps between cuts that are large enough
  for (let i = 0; i < boundaries.length - 1; i++) {
    const gapStart = boundaries[i];
    const gapEnd = boundaries[i + 1];
    const gapDuration = gapEnd - gapStart;

    // Check if this gap is large enough and within search limits
    if (gapDuration >= totalRequired && gapStart < searchLimit) {
      // Return a segment from the start of the gap
      // Add a small offset from cut boundaries
      const safeStart = i === 0 ? 0 : gapStart + buffer;
      const safeEnd = safeStart + requiredDuration;
      
      if (safeEnd <= gapEnd - buffer && safeEnd <= searchLimit + requiredDuration) {
        return {
          found: true,
          start: safeStart,
          end: safeEnd,
          error: null,
        };
      }
    }
  }

  return {
    found: false,
    start: 0,
    end: 0,
    error: `No cut-free segment of ${totalRequired.toFixed(2)}s found in video`,
  };
};

/**
 * Check if a specific segment of a video has cuts
 * Convenience wrapper around detectCutsInClip
 * 
 * @param {string} videoPath - Path to video file
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {number} threshold - Scene change threshold (default 0.3)
 * @returns {Promise<boolean>} - True if the segment has cuts
 */
export const segmentHasCuts = async (videoPath, startTime, endTime, threshold = DEFAULT_SCENE_THRESHOLD) => {
  const result = await detectCutsInClip(videoPath, {
    startTime,
    endTime,
    threshold,
  });
  return result.hasCuts;
};

