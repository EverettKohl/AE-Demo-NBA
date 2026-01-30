import fs from "fs";
import path from "path";
import crypto from "crypto";
import { loadMovieIndex, pickChunkCandidates } from "./movieIndex.js";
import {
  TARGET_FPS,
  calculateFrameSegments,
  calculateLayerSegments,
  getEditPlanStats,
  frameToSeconds,
  frameCountToMinDuration,
} from "./frameAccurateTiming.js";
import { KillBillAgent, TASK_MODES } from "./killBillAgent.js";
import { searchClips as searchClipsDirectly } from "./killBillAgent/tools.js";
import { isBannedClip } from "./killBillAgent/utils.js";
import {
  loadClipPoolFromDisk,
  getCloudinaryIdForClip,
  getVideoIdForClip,
} from "./clipPoolUtils.js";
import {
  loadSceneCuts,
  getCutsInRange,
  isSegmentCutFree,
  findCutFreeWindow,
  findAllCutFreeWindows,
  hasSceneCutsData,
} from "./sceneCuts.js";
import { STATIC_SONG_FORMATS, getStaticFormatBySlug } from "../data/songFormatsStatic.js";

/**
 * Some song-format exports accidentally wrote two JSON objects back-to-back,
 * which makes JSON.parse fail and causes us to fall back to the static formats
 * (and the default LoveMe audio). This helper attempts to recover by splitting
 * the file into two top-level objects and merging them, preserving the slug
 * while letting the richer second object override placeholder values.
 */
const recoverMultiObjectFormat = (content, slug) => {
  if (!content) return null;

  // Look for a top-level boundary like "}\n{" without a separating comma.
  const separatorMatch = content.match(/}\s*\n\s*{/);
  if (!separatorMatch) return null;

  const separator = separatorMatch[0];
  const splitIndex = content.indexOf(separator);
  if (splitIndex === -1) return null;

  const firstPart = content.slice(0, splitIndex + 1);
  const secondPart = content.slice(splitIndex + separator.length - 1);

  try {
    const firstObj = JSON.parse(firstPart);
    const secondObj = JSON.parse(secondPart.trim());
    const merged = { ...firstObj, ...secondObj };
    if (!merged.slug && slug) merged.slug = slug;
    return merged;
  } catch (parseErr) {
    console.warn(
      `[loadSongFormat] Multi-object recovery failed for ${slug}: ${parseErr?.message}`,
    );
    return null;
  }
};

/**
 * Song Edit Library
 * Creates perfectly timed edits using pre-mapped song formats from the format builder.
 * Features smart clip reuse to handle 100+ clip requirements efficiently.
 * Includes cut detection to ensure clips don't have internal scene changes.
 */

/**
 * Configuration for cut detection
 * Ensures clips used in the edit don't have internal scene changes
 */
export const CUT_DETECTION_CONFIG = {
  // Scene change threshold (0-1). Higher = only detect larger changes
  // 0.3 works well for detecting hard cuts
  threshold: 0.3,
  // Whether cut detection is enabled by default
  enabled: true,
  // Maximum retry attempts when finding replacement clips
  maxRetries: 3,
  // Buffer time (seconds) to add around cut boundaries
  buffer: 0.1,
};

/**
 * Convert a format object into a summary for dropdowns / listing.
 */
const summarizeFormat = (slug, format) => {
  if (!format) return null;
  return {
    slug,
    displayName: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    source: format.source || "unknown",
    duration: format.meta?.durationSeconds || 0,
    bpm: format.meta?.bpm || null,
    beatCount: format.beatGrid?.length || 0,
    rapidRangeCount: format.rapidClipRanges?.length || 0,
    totalClips: format.meta?.totalClips || format.clipSegments?.length || 0,
    captions: format.captions
      ? {
          enabled: typeof format.captions.enabled === "boolean" ? format.captions.enabled : true,
          status: format.captions.status || "ready",
        }
      : null,
  };
};

/**
 * Load a song format from disk, falling back to static bundled definitions.
 */
export const loadSongFormat = (slug) => {
  const formatPath = path.join(process.cwd(), "data", "song-formats", `${slug}.json`);

  if (fs.existsSync(formatPath)) {
    let content = null;
    try {
      content = fs.readFileSync(formatPath, "utf-8");
      return JSON.parse(content);
    } catch (err) {
      console.warn(`[loadSongFormat] Failed to parse ${slug} from disk, using static fallback: ${err?.message}`);
      const recovered = recoverMultiObjectFormat(content, slug);
      if (recovered) {
        console.warn(`[loadSongFormat] Recovered ${slug} by merging multi-object format file`);
        return recovered;
      }
    }
  }

  const fallback = getStaticFormatBySlug(slug);
  if (fallback) return fallback;

  throw new Error(`Song format not found: ${slug}`);
};

/**
 * List all available song formats, including static fallbacks so production
 * never returns an empty list.
 */
export const listSongFormats = () => {
  const formatsDir = path.join(process.cwd(), "data", "song-formats");
  const summaries = new Map();

  if (fs.existsSync(formatsDir)) {
    const files = fs.readdirSync(formatsDir).filter((file) => file.endsWith(".json"));
    files.forEach((file) => {
      const slug = file.replace(/\.json$/, "");
      try {
        const format = loadSongFormat(slug);
        const summary = summarizeFormat(slug, format);
        if (summary) summaries.set(slug, summary);
      } catch (err) {
        console.warn(`[listSongFormats] Skipping ${slug}: ${err?.message}`);
      }
    });
  }

  // Ensure static fallbacks are present when disk formats are missing or invalid.
  STATIC_SONG_FORMATS.forEach((format) => {
    if (!summaries.has(format.slug)) {
      summaries.set(format.slug, summarizeFormat(format.slug, format));
    }
  });

  return Array.from(summaries.values()).filter(Boolean);
};

/**
 * Calculate all clip timestamps from a song format
 * This includes beat grid marks + expanded rapid clip ranges
 * 
 * DEPRECATED: Use calculateFrameSegments from frameAccurateTiming.js for precise timing
 * This function is kept for backward compatibility
 */
export const calculateClipTimestamps = (format) => {
  const timestamps = [];
  
  // Add all beat grid marks
  if (format.beatGrid && Array.isArray(format.beatGrid)) {
    timestamps.push(...format.beatGrid.map((t) => ({ time: t, type: "beat" })));
  }
  
  // Expand rapid clip ranges into individual timestamps
  if (format.rapidClipRanges && Array.isArray(format.rapidClipRanges)) {
    format.rapidClipRanges.forEach((range) => {
      const interval = range.interval || 0.1;
      for (let t = range.start; t <= range.end; t += interval) {
        // Check if this timestamp is already in beatGrid (within tolerance)
        const exists = timestamps.some((ts) => Math.abs(ts.time - t) < 0.001);
        if (!exists) {
          timestamps.push({ time: t, type: "rapid" });
        }
      }
    });
  }
  
  // Sort by time
  timestamps.sort((a, b) => a.time - b.time);
  
  // Calculate durations for each clip (time until next clip)
  const songDuration = format.meta?.durationSeconds || 0;
  return timestamps.map((ts, idx) => {
    const nextTime = idx < timestamps.length - 1 ? timestamps[idx + 1].time : songDuration;
    return {
      ...ts,
      duration: nextTime - ts.time,
      index: idx,
    };
  });
};

/**
 * Calculate frame-accurate clip segments from a song format
 * Uses integer frame math to eliminate floating-point precision errors
 * 
 * @param {Object} format - Song format object
 * @returns {Object} { segments, fps, totalFrames, stats }
 */
export const calculateFrameAccurateSegments = (format) => {
  const result = calculateFrameSegments(format);
  const stats = getEditPlanStats(result);
  const foreground = format?.foreground;
  const foregroundResult = foreground
    ? calculateLayerSegments({
        beatGrid: foreground.beatGrid || [],
        beatMetadata: foreground.beatMetadata || [],
        rapidClipRanges: foreground.rapidClipRanges || [],
        meta: format.meta || {},
      })
    : null;
  
  return {
    ...result,
    stats,
    foregroundSegments: foregroundResult?.segments || [],
    foregroundStats: foregroundResult ? getEditPlanStats(foregroundResult) : null,
  };
};

/**
 * Search for clips using direct Twelve Labs API (Quick Mode - fast)
 */
const searchForClipQuick = async ({ query, candidates, usedClips = new Set() }) => {
  try {
    const result = await searchClipsDirectly({
      query,
      limit: 10,
      searchOptions: ["visual", "audio", "transcription"],
    });

    if (!result.success || !result.clips?.length) {
      // Fallback to first candidate chunk if available
      if (candidates?.length > 0) {
        const fallback = candidates[0];
        const clipStart = fallback.start_offset ?? 0;
        if (!isBannedClip(fallback.videoId, clipStart)) {
          return {
            indexId: fallback.indexId,
            videoId: fallback.videoId,
            start: clipStart,
            end: Math.min(fallback.end_offset ?? clipStart + 5, clipStart + 5),
            confidence: 0.1,
            thumbnail: fallback.thumbnail,
          };
        }
      }
      return null;
    }

    // Filter clips that aren't already used
    for (const clip of result.clips) {
      const videoId = clip.videoId || clip.video_id;
      const start = clip.start || 0;
      const clipKey = `${videoId}:${Math.floor(start)}`;
      
      if (usedClips.has(clipKey)) continue;
      if (isBannedClip(videoId, start)) continue;

      return {
        indexId: process.env.TWELVELABS_INDEX_ID,
        videoId,
        start,
        end: clip.end || start + 5,
        confidence: clip.confidence || 0.5,
        thumbnail: clip.thumbnail_url || clip.thumbnail,
      };
    }

    // Fallback to first candidate
    if (candidates?.length > 0) {
      const fallback = candidates[0];
      const clipStart = fallback.start_offset ?? 0;
      if (!isBannedClip(fallback.videoId, clipStart)) {
        return {
          indexId: fallback.indexId,
          videoId: fallback.videoId,
          start: clipStart,
          end: Math.min(fallback.end_offset ?? clipStart + 5, clipStart + 5),
          confidence: 0.1,
          thumbnail: fallback.thumbnail,
        };
      }
    }

    return null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[searchForClipQuick] Error: ${error.message}, using fallback`);
    
    // Fallback to first candidate on error
    if (candidates?.length > 0) {
      const fallback = candidates[0];
      const clipStart = fallback.start_offset ?? 0;
      if (!isBannedClip(fallback.videoId, clipStart)) {
        return {
          indexId: fallback.indexId,
          videoId: fallback.videoId,
          start: clipStart,
          end: Math.min(fallback.end_offset ?? clipStart + 5, clipStart + 5),
          confidence: 0.1,
          thumbnail: fallback.thumbnail,
        };
      }
    }
    return null;
  }
};

/**
 * Search for clips using unified Kill Bill Agent (Detailed Mode - slower, smarter)
 */
const searchForClipDetailed = async ({ query, candidates, usedClips = new Set() }) => {
  // Create agent instance for song edit task
  const agent = new KillBillAgent(TASK_MODES.SONG_EDIT);
  
  try {
    const result = await agent.process(
      `Find a clip showing: ${query}. Visual intensity, no text or subtitles.`,
      {
        maxClips: 10,
        includeContext: false,
      }
    );

    if (!result.success || !result.clips?.length) {
      // Fallback to first candidate chunk if available
      if (candidates?.length > 0) {
        const fallback = candidates[0];
        const clipStart = fallback.start_offset ?? 0;
        if (!isBannedClip(fallback.videoId, clipStart)) {
          return {
            indexId: fallback.indexId,
            videoId: fallback.videoId,
            start: clipStart,
            end: Math.min(fallback.end_offset ?? clipStart + 5, clipStart + 5),
            confidence: 0.1,
            thumbnail: fallback.thumbnail,
          };
        }
      }
      return null;
    }

    // Filter clips that aren't already used
    for (const clip of result.clips) {
      const videoId = clip.videoId || clip.video_id;
      const start = clip.start || 0;
      const clipKey = `${videoId}:${Math.floor(start)}`;
      
      if (usedClips.has(clipKey)) continue;
      if (isBannedClip(videoId, start)) continue;

      return {
        indexId: process.env.TWELVELABS_INDEX_ID,
        videoId,
        start,
        end: clip.end || start + 5,
        confidence: clip.confidence || 0.5,
        thumbnail: clip.thumbnail_url || clip.thumbnail,
      };
    }

    // Fallback to first candidate
    if (candidates?.length > 0) {
      const fallback = candidates[0];
      const clipStart = fallback.start_offset ?? 0;
      if (!isBannedClip(fallback.videoId, clipStart)) {
        return {
          indexId: fallback.indexId,
          videoId: fallback.videoId,
          start: clipStart,
          end: Math.min(fallback.end_offset ?? clipStart + 5, clipStart + 5),
          confidence: 0.1,
          thumbnail: fallback.thumbnail,
        };
      }
    }

    return null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[searchForClipDetailed] Agent error: ${error.message}, using fallback`);
    
    // Fallback to first candidate on error
    if (candidates?.length > 0) {
      const fallback = candidates[0];
      const clipStart = fallback.start_offset ?? 0;
      if (!isBannedClip(fallback.videoId, clipStart)) {
        return {
          indexId: fallback.indexId,
          videoId: fallback.videoId,
          start: clipStart,
          end: Math.min(fallback.end_offset ?? clipStart + 5, clipStart + 5),
          confidence: 0.1,
          thumbnail: fallback.thumbnail,
        };
      }
    }
    return null;
  }
};

/**
 * Search for clips - uses quick or detailed mode based on parameter
 */
const searchForClip = async ({ query, candidates, usedClips = new Set(), searchMode = "quick" }) => {
  if (searchMode === "detailed") {
    return searchForClipDetailed({ query, candidates, usedClips });
  }
  return searchForClipQuick({ query, candidates, usedClips });
};

/**
 * Build a pool of unique clips for reuse
 * NOW WITH CUT DETECTION: Calculates cut-free windows for each clip
 * 
 * @param {Object} params
 * @param {string} params.searchMode - "quick" (fast, direct TwelveLabs) or "detailed" (AI agent, slower)
 */
const buildClipPool = async ({
  movieIndex,
  poolSize = 20,
  theme = "",
  searchMode = "quick",
  segmentCount = null,
  seed = null,
}) => {
  const pool = [];
  const usedClips = new Set();
  const hasPrecomputedCuts = hasSceneCutsData();
  const rng = createSeededRng((seed ?? crypto.randomInt(1, 1_000_000_000)) >>> 0);
  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Dynamically scale pool for coverage (aim for 1.5x segments)
  const targetPoolSize =
    segmentCount && Number.isFinite(segmentCount)
      ? Math.max(poolSize, Math.min(Math.ceil(segmentCount * 1.5), poolSize * 3))
      : poolSize;

  // Search queries for variety
  const searchQueries = [
    "The Bride intense action fight",
    "O-Ren Ishii sword combat",
    "Vernita Green kitchen confrontation",
    "Gogo Yubari ball and chain weapon",
    "Crazy 88 fight scene chaos",
    "Bill dramatic moment",
    "Hattori Hanzo sword reveal",
    "Pai Mei training sequence",
    "Elle Driver dramatic scene",
    "House of Blue Leaves showdown",
    "Snow garden battle",
    "Hospital scene escape",
    "Bride determination close-up",
    "Iconic revenge moment",
    "Martial arts choreography",
    "Sword unsheathing dramatic",
    "Character stare down",
    "Action impact moment",
    "Emotional intensity scene",
    "Visual contrast movement",
  ];

  // If user provided a theme, generate theme-based queries
  const queries = theme
    ? [...searchQueries.slice(0, 10), ...Array(10).fill(theme).map((t, i) => `${t} ${searchQueries[i % searchQueries.length].split(" ").slice(-2).join(" ")}`)]
    : searchQueries;

  console.log(`[buildClipPool] Using ${searchMode} search mode`);
  
  for (let i = 0; i < Math.min(targetPoolSize, queries.length); i++) {
    const candidates = pickChunkCandidates(movieIndex, null) || movieIndex?.chunks?.slice(0, 5) || [];
    
    const clip = await searchForClip({
      query: queries[i],
      candidates,
      usedClips,
      searchMode,
    });

    if (clip?.videoId) {
      const clipKey = `${clip.videoId}:${Math.floor(clip.start)}`;
      if (!usedClips.has(clipKey)) {
        usedClips.add(clipKey);
        
        // Calculate cut-free windows for this clip
        let cutFreeWindows = [];
        let longestCutFreeSegment = clip.end - clip.start;
        
        if (hasPrecomputedCuts) {
          // Find all cut-free windows (for typical segment durations)
          cutFreeWindows = findAllCutFreeWindows(clip.videoId, clip.start, clip.end, 0.5);
          
          // Calculate longest cut-free segment
          const cuts = getCutsInRange(clip.videoId, clip.start, clip.end);
          if (cuts.length > 0) {
            const boundaries = [clip.start, ...cuts, clip.end];
            longestCutFreeSegment = 0;
            for (let j = 0; j < boundaries.length - 1; j++) {
              const segLen = boundaries[j + 1] - boundaries[j];
              if (segLen > longestCutFreeSegment) {
                longestCutFreeSegment = segLen;
              }
            }
          }
        }
        
        pool.push({
          ...clip,
          query: queries[i],
          poolIndex: pool.length,
          cutFreeWindows,
          longestCutFreeSegment,
          cutsInClip: hasPrecomputedCuts ? getCutsInRange(clip.videoId, clip.start, clip.end).length : 0,
        });
      }
    }
  }

  // Fill remaining slots with random chunks from movie index
  if (pool.length < targetPoolSize && movieIndex?.chunks) {
    const shuffledChunks = shuffleInPlace([...movieIndex.chunks]);
    for (const chunk of shuffledChunks) {
      if (pool.length >= targetPoolSize) break;
      
      const clipStart = chunk.start_offset ?? 0;
      if (isBannedClip(chunk.videoId, clipStart)) continue;
      
      const clipKey = `${chunk.videoId}:${Math.floor(clipStart)}`;
      if (usedClips.has(clipKey)) continue;
      
      const clipEnd = Math.min(chunk.end_offset ?? clipStart + 10, clipStart + 10);

      // Calculate cut-free info for fallback clips too
      let cutFreeWindows = [];
      let longestCutFreeSegment = clipEnd - clipStart;
      
      if (hasPrecomputedCuts) {
        cutFreeWindows = findAllCutFreeWindows(chunk.videoId, clipStart, clipEnd, 0.5);
        const cuts = getCutsInRange(chunk.videoId, clipStart, clipEnd);
        if (cuts.length > 0) {
          const boundaries = [clipStart, ...cuts, clipEnd];
          longestCutFreeSegment = 0;
          for (let j = 0; j < boundaries.length - 1; j++) {
            const segLen = boundaries[j + 1] - boundaries[j];
            if (segLen > longestCutFreeSegment) {
              longestCutFreeSegment = segLen;
            }
          }
        }
      }

      usedClips.add(clipKey);
      pool.push({
        indexId: chunk.indexId,
        videoId: chunk.videoId,
        start: clipStart,
        end: clipEnd,
        confidence: 0.1,
        thumbnail: chunk.thumbnail,
        query: "fallback",
        poolIndex: pool.length,
        cutFreeWindows,
        longestCutFreeSegment,
        cutsInClip: hasPrecomputedCuts ? getCutsInRange(chunk.videoId, clipStart, clipEnd).length : 0,
      });
    }
  }

  // Log pool statistics
  if (hasPrecomputedCuts && pool.length > 0) {
    const avgCuts = pool.reduce((sum, c) => sum + c.cutsInClip, 0) / pool.length;
    const avgLongestSegment = pool.reduce((sum, c) => sum + c.longestCutFreeSegment, 0) / pool.length;
    console.log(`[buildClipPool] Pool stats: ${pool.length} clips, avg ${avgCuts.toFixed(1)} cuts/clip, avg longest cut-free segment: ${avgLongestSegment.toFixed(2)}s`);
  }

  return pool;
};

/**
 * Assign clips to timestamps with smart reuse strategy
 * Ensures proper spacing between reused clips
 * Uses minSourceDuration to ensure clips are long enough for frame-accurate trimming
 * NOW WITH CUT DETECTION: Validates segments don't contain internal cuts
 */
const assignClipsWithReuse = ({
  timestamps,
  clipPool,
  minSpacing = 5,
  fps = TARGET_FPS,
  enforceUnique = false, // Quick mode sets true; others remain unchanged
  diversify = true, // Quick mode diversifies search zones
}) => {
  const segments = [];
  const recentlyUsed = []; // Track recent clip pool indices

  // Per-request RNG (seeded from crypto) to avoid deterministic ordering
  const seed = crypto.randomInt(1, 1_000_000_000);
  let rngState = seed;
  const rng = () => {
    // simple xorshift32 for deterministic-but-random per request
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return ((rngState >>> 0) / 0xffffffff);
  };
  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  
  // Load scene cuts data once for all lookups
  const hasPrecomputedCuts = hasSceneCutsData();
  if (hasPrecomputedCuts) {
    console.log(`[assignClipsWithReuse] Using pre-computed scene cuts for cut-free segment selection`);
  }

  // Per-edit clip usage ledger to enforce uniqueness and non-overlap
  // Map<assetId, Array<{ startFrame, endFrame }>>
  const clipUsageLedger = new Map();
  const recordUsage = (assetId, startSeconds, endSeconds) => {
    if (!enforceUnique) return;
    if (!assetId || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return;
    const startFrame = Math.round(startSeconds * fps);
    const endFrame = Math.round(endSeconds * fps);
    if (!clipUsageLedger.has(assetId)) clipUsageLedger.set(assetId, []);
    clipUsageLedger.get(assetId).push({ startFrame, endFrame });
  };
  const overlapsLedger = (assetId, startSeconds, endSeconds) => {
    if (!enforceUnique) return false;
    if (!assetId || !clipUsageLedger.has(assetId)) return false;
    const startFrame = Math.round(startSeconds * fps);
    const endFrame = Math.round(endSeconds * fps);
    return clipUsageLedger.get(assetId).some(
      (range) => !(endFrame <= range.startFrame || startFrame >= range.endFrame)
    );
  };
  const pickDiversifiedStart = (sourceClip, neededDuration, reuseCount, zoneFraction) => {
    const clipDuration = sourceClip.end - sourceClip.start;
    const slack = Math.max(0, clipDuration - neededDuration);
    const offset = diversify ? slack * zoneFraction : slack * Math.random();
    let start = sourceClip.start + offset;
    if (reuseCount > 0 && slack > 0) {
      const reuseNudge = Math.min(slack, (reuseCount % 3) * (neededDuration * 0.1));
      start = Math.min(start + reuseNudge, sourceClip.end - neededDuration);
    }
    const end = Math.min(start + neededDuration, sourceClip.end);
    return { start, end };
  };

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    
    // Use minSourceDuration if available (frame-accurate), otherwise fall back to duration
    const neededDuration = ts.minSourceDuration || Math.max(0.1, ts.duration) + 0.1;
    
    // Find eligible clips (not recently used within minSpacing AND long enough)
    const eligibleIndices = clipPool
      .map((clip, idx) => ({ clip, idx }))
      .filter(({ clip, idx }) => {
        // Check if clip is long enough
        const clipDuration = clip.end - clip.start;
        if (clipDuration < neededDuration) return false;
        
        // For rapid clips, allow more aggressive reuse with smaller spacing
        const spacing = ts.type === "rapid" ? Math.max(2, Math.floor(minSpacing / 2)) : minSpacing;
        return !recentlyUsed.slice(-spacing).includes(idx);
      })
      .map(({ idx }) => idx);

    // If no eligible clips, try without spacing restriction but still check duration
    let selectedIdx;
    let segmentStart;
    let segmentEnd;
    let cutCheckPassed = false;
    
    // Try to find a clip with a cut-free segment
    const candidateIndices = eligibleIndices.length > 0 
      ? eligibleIndices 
      : clipPool.map((_, idx) => idx).filter(idx => (clipPool[idx].end - clipPool[idx].start) >= neededDuration);
    
    // Shuffle candidates per request for true random ordering
    const shuffledCandidates = shuffleInPlace([...candidateIndices]);

    // Pass order: strict (unused asset) -> relaxed (used, non-overlap) -> fallback (overlap)
    const passOrder = enforceUnique ? ["strict", "relaxed", "fallback"] : ["fallback"];
    for (const pass of passOrder) {
      for (const candidateIdx of shuffledCandidates) {
        const sourceClip = clipPool[candidateIdx];
        if (!sourceClip) continue;

        const sourceClipDuration = sourceClip.end - sourceClip.start;

        // Determine initial segment position based on reuse count and diversified zone
        const reuseCount = recentlyUsed.filter((idx) => idx === candidateIdx).length;
        const zoneFraction = diversify
          ? Math.min(1, Math.max(0, i / Math.max(1, timestamps.length - 1)))
          : rng();
        const { start: initialStart, end: initialEnd } = pickDiversifiedStart(
          sourceClip,
          neededDuration,
          reuseCount,
          zoneFraction
        );

        // Ledger gating
        const assetId = sourceClip.videoId || sourceClip.cloudinaryId || sourceClip.id;
        const isUnused = !clipUsageLedger.has(assetId);
        const overlaps = overlapsLedger(assetId, initialStart, initialEnd);
      if (pass === "strict" && !isUnused) continue;
      if (pass === "relaxed" && (isUnused || overlaps)) continue;
      // fallback allows overlaps

        // === CUT DETECTION CHECK ===
        if (hasPrecomputedCuts) {
          const cutsInSegment = getCutsInRange(sourceClip.videoId, initialStart, initialEnd);
          if (cutsInSegment.length > 0) {
            const window = findCutFreeWindow(
              sourceClip.videoId,
              sourceClip.start,
              sourceClip.end,
              neededDuration,
              { buffer: CUT_DETECTION_CONFIG.buffer, preferStart: true }
            );
            if (window.found) {
              segmentStart = window.start;
              segmentEnd = window.end;
              // re-evaluate overlap after window adjustment
              const postOverlap = overlapsLedger(assetId, segmentStart, segmentEnd);
              if (pass === "strict" && !isUnused) continue;
              if (pass === "relaxed" && postOverlap) continue;
              selectedIdx = candidateIdx;
              cutCheckPassed = true;
              if (window.cutsAvoided > 0 && (i % 20 === 0 || ts.type !== "rapid")) {
                console.log(
                  `[assignClipsWithReuse] Clip ${i}: Adjusted timing to avoid ${window.cutsAvoided} cut(s) in ${sourceClip.videoId.slice(-6)}`
                );
              }
              break;
            } else {
              continue;
            }
          } else {
            segmentStart = initialStart;
            segmentEnd = initialEnd;
            const postOverlap = overlapsLedger(assetId, segmentStart, segmentEnd);
            if (pass === "strict" && !isUnused) continue;
            if (pass === "relaxed" && postOverlap) continue;
            selectedIdx = candidateIdx;
            cutCheckPassed = true;
            break;
          }
        } else {
          segmentStart = initialStart;
          segmentEnd = initialEnd;
          const postOverlap = overlapsLedger(assetId, segmentStart, segmentEnd);
          if (pass === "strict" && !isUnused) continue;
          if (pass === "relaxed" && postOverlap) continue;
          selectedIdx = candidateIdx;
          cutCheckPassed = true;
          break;
        }
      }
      if (cutCheckPassed) {
        break;
      }
      // If strict/relaxed failed, loop continues to next pass
    }
    
    // If no cut-free clip found, fall back to original behavior
    if (!cutCheckPassed) {
      if (eligibleIndices.length === 0) {
        // Last resort: use longest available clip
        let longestIdx = 0;
        let longestDuration = 0;
        clipPool.forEach((clip, idx) => {
          const dur = clip.end - clip.start;
          if (dur > longestDuration) {
            longestDuration = dur;
            longestIdx = idx;
          }
        });
        selectedIdx = longestIdx;
        console.warn(`[assignClipsWithReuse] No cut-free clip for ${neededDuration.toFixed(3)}s at timestamp ${ts.time}, using longest (${longestDuration.toFixed(3)}s)`);
      } else {
        selectedIdx = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
      }
      
      const sourceClip = clipPool[selectedIdx];
      const sourceClipDuration = sourceClip.end - sourceClip.start;
      const reuseCount = recentlyUsed.filter((idx) => idx === selectedIdx).length;
      
      segmentStart = sourceClip.start;
      if (sourceClipDuration > neededDuration * 2) {
        const numSegments = Math.floor(sourceClipDuration / neededDuration);
        const segmentIndex = reuseCount % numSegments;
        segmentStart = sourceClip.start + (segmentIndex * neededDuration);
      }
      segmentEnd = Math.min(segmentStart + neededDuration, sourceClip.end);
    }

    const sourceClip = clipPool[selectedIdx];
    if (!sourceClip) {
      console.warn(`[assignClipsWithReuse] No clip found for timestamp ${ts.time}`);
      continue;
    }

    const assetId = sourceClip.videoId || sourceClip.cloudinaryId || sourceClip.id;
    const forcedReuse = overlapsLedger(assetId, segmentStart, segmentEnd);

    segments.push({
      index: i,
      songTime: ts.time,
      duration: ts.duration,
      frameCount: ts.frameCount,
      minSourceDuration: ts.minSourceDuration,
      type: ts.type,
      asset: {
        indexId: sourceClip.indexId,
        videoId: sourceClip.videoId,
        start: segmentStart,
        end: segmentEnd,
        confidence: sourceClip.confidence,
        thumbnail: sourceClip.thumbnail,
      },
      sourcePoolIndex: selectedIdx,
      isReused: recentlyUsed.includes(selectedIdx),
      cutFreeVerified: cutCheckPassed && hasPrecomputedCuts,
      forcedReuse,
      __debugPass: enforceUnique ? (forcedReuse ? "fallback" : "strict_or_relaxed") : "fallback",
    });
    recordUsage(assetId, segmentStart, segmentEnd);

    // Update recently used tracking
    recentlyUsed.push(selectedIdx);
    if (recentlyUsed.length > minSpacing * 2) {
      recentlyUsed.shift();
    }
  }

  return segments;
};

function createSeededRng(seed = 1) {
  // Mulberry32 for reproducible pseudo-randomness
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Quick V2 helpers (asset-first, pool-manager sourced)
 */
const loadQuickPoolClips = () => {
  const pool = loadClipPoolFromDisk();
  const clips = pool?.pool?.clips || pool?.clips || [];
  return clips
    .map((clip, idx) => {
      const duration = Number.isFinite(clip.duration)
        ? clip.duration
        : Math.max(0, (clip.end || 0) - (clip.start || 0));
      const videoId = clip.videoId || getVideoIdForClip(clip) || null;
      const cloudinaryId = getCloudinaryIdForClip(clip) || null;
      return {
        id: clip.id || `clip-${idx}`,
        videoId,
        cloudinaryId,
        start: Number(clip.start || 0),
        end: Number.isFinite(clip.end) ? Number(clip.end) : Number(clip.start || 0) + duration,
        duration,
        source: clip,
      };
    })
    .filter((c) => c.videoId && c.duration > 0);
};

const assignClipsQuickV2 = ({ frameSegments, fps, seed = Date.now(), poolClips: poolClipsArg = null }) => {
  const rng = createSeededRng(seed >>> 0);
  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const requirements = frameSegments.map((seg) => {
    const targetFrames = seg.frameCount || Math.max(1, Math.round((seg.durationSeconds || 0.1) * fps));
    const targetSeconds = frameToSeconds(targetFrames, fps);
    return {
      index: seg.index,
      targetFrames,
      targetSeconds,
      type: seg.type,
    };
  });

  const poolClips = shuffleInPlace(
    poolClipsArg && poolClipsArg.length ? [...poolClipsArg] : loadQuickPoolClips()
  );
  if (!poolClips.length) {
    throw new Error("[quick-v2] Clip pool is empty");
  }
  if (poolClips.length < requirements.length) {
    throw new Error(
      `[quick-v2] Insufficient unique clips: have ${poolClips.length}, need ${requirements.length}`
    );
  }

  // Sort requirements by descending duration to reduce failure chance
  const sortedReqs = [...requirements].sort((a, b) => b.targetFrames - a.targetFrames);
  const selection = new Map(); // segIdx -> clip
  const usedVideoIds = new Set();

  sortedReqs.forEach((req) => {
    const neededSeconds = req.targetSeconds;
    const candidate = poolClips.find((clip) => {
      if (selection.has(req.index)) return false;
      if (clip.duration + 1e-3 < neededSeconds) return false;
      if (!clip.videoId) return false;
      if (usedVideoIds.has(clip.videoId)) return false; // enforce uniqueness
      return true;
    });
    if (!candidate) {
      throw new Error(
        `[quick-v2] Unable to assign unique clip for segment ${req.index}; insufficient candidates (need ${neededSeconds.toFixed(
          3
        )}s)`
      );
    }
    selection.set(req.index, candidate);
    usedVideoIds.add(candidate.videoId);
  });

  // Build segments in original order
  const segments = frameSegments.map((seg) => {
    const req = requirements.find((r) => r.index === seg.index);
    const clip = selection.get(seg.index);
    if (!clip) {
      throw new Error(`[quick-v2] Missing assignment for segment ${seg.index}`);
    }
    const availableSeconds = clip.duration;
    if (availableSeconds + 1e-6 < req.targetSeconds) {
      throw new Error(
        `[quick-v2] Assigned clip too short for segment ${seg.index}: ${availableSeconds.toFixed(
          3
        )}s < ${req.targetSeconds.toFixed(3)}s`
      );
    }
    const start = clip.start;
    const end = start + req.targetSeconds;
    if (end - start > availableSeconds + 1e-6) {
      throw new Error(
        `[quick-v2] Computed window exceeds clip for segment ${seg.index}: ${end - start}s > ${availableSeconds}s`
      );
    }
    return {
      index: seg.index,
      songTime: seg.startSeconds,
      duration: req.targetSeconds,
      frameCount: req.targetFrames,
      minSourceDuration: req.targetSeconds + 0.2,
      type: seg.type,
      asset: {
        clipId: clip.id,
        videoId: clip.videoId,
        cloudinaryId: clip.cloudinaryId,
        start,
        end,
        thumbnail: clip.source?.thumbnail || null,
      },
      sourcePoolIndex: null,
      isReused: false,
      cutFreeVerified: false,
      forcedReuse: false,
      phaseUsed: "quick-v2",
      targetFrames: req.targetFrames,
    };
  });

  // Validation: uniqueness already enforced; check totals
  const sumFrames = segments.reduce((s, seg) => s + (seg.frameCount || 0), 0);
  const expectedFrames = frameSegments.reduce((s, seg) => s + (seg.frameCount || 0), 0);
  if (sumFrames !== expectedFrames) {
    throw new Error(
      `[quick-v2] Frame sum mismatch: segments ${sumFrames} vs timeline ${expectedFrames}`
    );
  }
  return { segments, seedUsed: seed, poolCount: poolClips.length };
};

/**
 * Deterministic, ledger-backed assignment for Quick mode.
 * - No overlap unless allowOverlap is true.
 * - Reuse is off by default (asset used at most once).
 * - Fails fast with diagnostics if coverage cannot be achieved.
 */
const assignClipsQuickDeterministic = ({
  timestamps,
  clipPool,
  fps = TARGET_FPS,
  reuseClips = false,
  allowOverlap = false,
  seed = 1,
}) => {
  const rng = createSeededRng(seed >>> 0);
  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const ledger = new Map(); // assetId -> ranges [{startFrame,endFrame}]
  const useCount = new Map(); // assetId -> integer

  const durationFrames = (clip) =>
    Math.max(1, Math.round((clip.end - clip.start) * fps));

  const pickWindow = (clip, neededFrames) => {
    const neededDuration = neededFrames / fps;
    const clipDur = clip.end - clip.start;
    if (clipDur < neededDuration) return null;
    const slack = Math.max(0, clipDur - neededDuration);
    const offset = slack * rng();
    const start = clip.start + offset;
    const end = start + neededDuration;
    return { start, end };
  };

  const overlaps = (assetId, start, end) => {
    if (!ledger.has(assetId)) return false;
    const startFrame = Math.round(start * fps);
    const endFrame = Math.round(end * fps);
    return ledger.get(assetId).some(
      (r) => !(endFrame <= r.startFrame || startFrame >= r.endFrame)
    );
  };

  const addRange = (assetId, start, end) => {
    const startFrame = Math.round(start * fps);
    const endFrame = Math.round(end * fps);
    if (!ledger.has(assetId)) ledger.set(assetId, []);
    ledger.get(assetId).push({ startFrame, endFrame });
    useCount.set(assetId, (useCount.get(assetId) || 0) + 1);
  };

  const assignments = new Array(timestamps.length).fill(null);

  const requirementList = timestamps.map((ts, idx) => {
    const targetFrames =
      ts.frameCount ||
      Math.max(1, Math.round((ts.duration || 0.1) * fps));
    const minSourceDuration =
      ts.minSourceDuration || ts.duration + 0.1 || targetFrames / fps;
    return {
      idx,
      targetFrames,
      minSourceDuration,
      type: ts.type,
    };
  });

  // Greedy deterministic assignment with backtracking-lite: one retry per segment after reshuffle.
  for (const req of requirementList) {
    const ts = timestamps[req.idx];
    const requiredFrames = Math.max(
      req.targetFrames,
      Math.round(req.minSourceDuration * fps)
    );
    const candidates = clipPool.filter(
      (c) => durationFrames(c) >= requiredFrames
    );
    if (!candidates.length) {
      throw new Error(
        `[quick-mode] No clips long enough for segment ${req.idx} (${requiredFrames}f required)`
      );
    }

    // Deterministic shuffle of candidates
    shuffleInPlace(candidates);

    let placed = false;
    for (const clip of candidates) {
      const assetId = clip.videoId || clip.cloudinaryId || clip.id;
      if (!assetId) continue;

      // Reuse gating: default off
      if (!reuseClips && useCount.has(assetId)) continue;

      const window = pickWindow(clip, requiredFrames);
      if (!window) continue;
      const { start, end } = window;

      // Overlap gating
      const hasOverlap = overlaps(assetId, start, end);
      if (hasOverlap && !allowOverlap) continue;

      // Ensure window fits
      const clipFrames = Math.round((end - start) * fps);
      if (clipFrames < requiredFrames) continue;

      assignments[req.idx] = {
        clip,
        start,
        end,
        forcedReuse: hasOverlap,
        assetId,
      };
      addRange(assetId, start, end);
      placed = true;
      break;
    }

    if (!placed) {
      throw new Error(
        `[quick-mode] Unable to assign clip for segment ${req.idx}; candidates tried=${candidates.length}`
      );
    }
  }

  const segments = assignments.map((assign, i) => {
    if (!assign) {
      throw new Error(`[quick-mode] Unassigned segment ${i}`);
    }
    const ts = timestamps[i];
    const targetFrames =
      ts.frameCount ||
      Math.max(1, Math.round((ts.duration || 0.1) * fps));
    const sourceClip = assign.clip;
    const assetKey = assign.assetId || sourceClip.videoId || sourceClip.cloudinaryId || sourceClip.id;
    return {
      index: i,
      songTime: ts.time,
      duration: ts.duration,
      frameCount: targetFrames,
      minSourceDuration: ts.minSourceDuration || ts.duration + 0.1,
      type: ts.type,
      asset: {
        indexId: sourceClip.indexId,
        videoId: sourceClip.videoId,
        start: assign.start,
        end: assign.end,
        confidence: sourceClip.confidence,
        thumbnail: sourceClip.thumbnail,
      },
      sourcePoolIndex: sourceClip.poolIndex ?? null,
      isReused: (useCount.get(assetKey) || 0) > 1,
      cutFreeVerified: false,
      forcedReuse: assign.forcedReuse,
      phaseUsed: "deterministic",
      targetFrames,
    };
  });

  return { segments, assetLedger: ledger, seedUsed: seed };
};

/**
 * Assign clips without reuse - find unique clips for each timestamp
 */
const assignClipsUnique = async ({ timestamps, movieIndex }) => {
  const segments = [];
  const usedClips = new Set();

  // Pre-generate search queries
  const baseQueries = [
    "intense action", "dramatic moment", "sword fight", "emotional scene",
    "character close-up", "combat sequence", "visual impact", "iconic shot",
    "confrontation", "training sequence", "revenge moment", "standoff",
  ];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const query = baseQueries[i % baseQueries.length];
    
    const candidates = pickChunkCandidates(movieIndex, null) || movieIndex?.chunks?.slice(0, 5) || [];
    
    const clip = await searchForClip({
      query,
      candidates,
      usedClips,
    });

    if (clip?.videoId) {
      const clipKey = `${clip.videoId}:${Math.floor(clip.start)}`;
      usedClips.add(clipKey);

      const neededDuration = Math.max(0.1, ts.duration);
      const segmentEnd = Math.min(clip.start + neededDuration, clip.end);

      segments.push({
        index: i,
        songTime: ts.time,
        duration: ts.duration,
        type: ts.type,
        asset: {
          indexId: clip.indexId,
          videoId: clip.videoId,
          start: clip.start,
          end: segmentEnd,
          confidence: clip.confidence,
          thumbnail: clip.thumbnail,
        },
        sourcePoolIndex: null,
        isReused: false,
      });
    } else {
      // Fallback to a random chunk
      const fallbackChunk = movieIndex?.chunks?.[i % (movieIndex?.chunks?.length || 1)];
      if (fallbackChunk) {
        const clipStart = fallbackChunk.start_offset ?? 0;
        segments.push({
          index: i,
          songTime: ts.time,
          duration: ts.duration,
          type: ts.type,
          asset: {
            indexId: fallbackChunk.indexId,
            videoId: fallbackChunk.videoId,
            start: clipStart,
            end: clipStart + ts.duration,
            confidence: 0.1,
            thumbnail: fallbackChunk.thumbnail,
          },
          sourcePoolIndex: null,
          isReused: false,
        });
      }
    }
  }

  return segments;
};

/**
 * Create a song edit plan with frame-accurate timing
 * 
 * @param {Object} params
 * @param {string} params.searchMode - "quick" (fast, direct TwelveLabs) or "detailed" (AI agent, slower)
 */
export const createSongEditPlan = async ({
  songSlug,
  theme = "",
  reuseClips = false,
  poolSize = 20,
  minSpacing = 5,
  searchMode = "quick",
  variantSeed = null,
  allowOverlap = false,
  quickV2 = true,
}) => {
  // Load song format
  const format = loadSongFormat(songSlug);
  
  // Ensure format has target FPS
  if (!format.meta) format.meta = {};
  if (!format.meta.targetFps) format.meta.targetFps = TARGET_FPS;
  
  // Load movie index
  const movieIndex = await loadMovieIndex({ forceRefresh: false });

  // Calculate frame-accurate segments (uses integer math, no floating-point errors)
  const { segments: frameSegments, fps, totalFrames, stats } = calculateFrameAccurateSegments(format);
  
  const baseSeed =
    typeof variantSeed === "number"
      ? variantSeed
      : typeof variantSeed === "string"
      ? variantSeed
          .split("")
          .reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
      : Date.now();
  const seed = Number.isFinite(baseSeed) ? baseSeed : Date.now();

  console.log(`[createSongEditPlan] Song: ${songSlug}`);
  console.log(`[createSongEditPlan] Frame-accurate: ${frameSegments.length} clips @ ${fps}fps (${totalFrames} total frames)`);
  console.log(`[createSongEditPlan] Clip durations: min=${stats.minClipDuration.toFixed(3)}s, max=${stats.maxClipDuration.toFixed(3)}s`);
  console.log(`[createSongEditPlan] Reuse clips: ${reuseClips}, Pool size: ${poolSize}, Search mode: ${searchMode}, Seed: ${seed}`);
  console.log(`[createSongEditPlan] Pre-computed cut detection: ${hasSceneCutsData() ? 'ENABLED' : 'DISABLED (will use FFmpeg fallback)'}`);

  // Convert frame segments to timestamp format for clip assignment
  const timestamps = frameSegments.map((seg) => ({
    time: seg.startSeconds,
    type: seg.type,
    duration: seg.durationSeconds,
    frameCount: seg.frameCount,
    minSourceDuration: seg.minSourceDuration,
    index: seg.index,
  }));

  let segments;
  let clipPool = null;

  if (searchMode === "quick" && quickV2 !== false) {
    const quickPoolClips = loadQuickPoolClips();
    if (!quickPoolClips.length) {
      throw new Error("[createSongEditPlan] Quick pool empty; load pool manager data first");
    }
    if (quickPoolClips.length < timestamps.length) {
      throw new Error(
        `[createSongEditPlan] Quick pool has ${quickPoolClips.length} clips but needs ${timestamps.length}; cannot proceed`
      );
    }
    const { segments: quickSegments, seedUsed, poolCount } = assignClipsQuickV2({
      frameSegments,
      fps,
      seed,
      poolClips: quickPoolClips,
    });
    segments = quickSegments;
    clipPool = quickPoolClips.slice(0, Math.min(quickPoolClips.length, 200)); // lightweight echo for diagnostics
    clipPool.__seedUsed = seedUsed;
    clipPool.__poolCount = poolCount;
  } else if (searchMode === "quick") {
    // Legacy quick path only if explicitly requested
    clipPool = await buildClipPool({
      movieIndex,
      poolSize,
      theme,
      searchMode,
      segmentCount: timestamps.length,
      seed,
    });
    console.log(`[createSongEditPlan] Built clip pool with ${clipPool.length} clips using ${searchMode} mode (legacy)`);
    const result = assignClipsQuickDeterministic({
      timestamps,
      clipPool,
      fps,
      reuseClips,
      allowOverlap,
      seed,
    });
    segments = result.segments;
    clipPool.__assetLedger = result.assetLedger;
    clipPool.__seedUsed = result.seedUsed;
  } else if (reuseClips) {
    clipPool = await buildClipPool({
      movieIndex,
      poolSize,
      theme,
      searchMode,
      segmentCount: timestamps.length,
      seed,
    });
    console.log(`[createSongEditPlan] Built clip pool with ${clipPool.length} clips using ${searchMode} mode`);
    const enforceUnique = false;
    segments = assignClipsWithReuse({ timestamps, clipPool, minSpacing, fps, enforceUnique });
  } else {
    // Find unique clips for each timestamp (slower, may not have enough variety)
    segments = await assignClipsUnique({ timestamps, movieIndex });
  }

  // Merge frame info back into segments
  segments = segments.map((seg, idx) => ({
    ...seg,
    frameCount: frameSegments[idx]?.frameCount || Math.ceil(seg.duration * fps),
    minSourceDuration: frameSegments[idx]?.minSourceDuration || seg.duration + 0.1,
    fps,
  }));

  // Log cut detection results
  const cutFreeCount = segments.filter(s => s.cutFreeVerified).length;
  if (hasSceneCutsData()) {
    console.log(`[createSongEditPlan] Created ${segments.length} frame-accurate segments (${cutFreeCount} verified cut-free)`);
  } else {
    console.log(`[createSongEditPlan] Created ${segments.length} frame-accurate segments (cut verification at render time)`);
  }

  // Build render plan
  const renderPlan = buildRenderPlan({ format, segments });

  // Calculate cut detection stats
  const cutDetectionStats = hasSceneCutsData() ? {
    enabled: true,
    precomputed: true,
    cutFreeSegments: cutFreeCount,
    totalSegments: segments.length,
    cutFreePercentage: ((cutFreeCount / segments.length) * 100).toFixed(1),
  } : {
    enabled: CUT_DETECTION_CONFIG.enabled,
    precomputed: false,
    cutFreeSegments: 0,
    totalSegments: segments.length,
    cutFreePercentage: "N/A (checked at render)",
  };

  return {
    songSlug,
    songFormat: {
      source: format.source,
      meta: {
        ...format.meta,
        targetFps: fps,
      },
      beatCount: format.beatGrid?.length || 0,
      rapidRangeCount: format.rapidClipRanges?.length || 0,
    },
    theme,
    reuseClips,
    allowOverlap,
    seed,
    quickV2,
    poolSize: clipPool?.length || 0,
    totalClips: segments.length,
    fps,
    totalFrames,
    frameStats: stats,
    cutDetection: cutDetectionStats,
    segments,
    clipPool: clipPool?.map((c) => ({
      videoId: c.videoId,
      indexId: c.indexId,
      start: c.start,
      end: c.end,
      thumbnail: c.thumbnail,
      longestCutFreeSegment: c.longestCutFreeSegment,
      cutsInClip: c.cutsInClip,
    })) || null,
    renderPlan,
    movieIndex: {
      chunkCount: movieIndex?.chunkCount || 0,
      generatedAt: movieIndex?.generatedAt,
    },
    quickV2Used: searchMode === "quick" && quickV2 !== false,
  };
};

/**
 * Build render plan for FFmpeg
 */
const buildRenderPlan = ({ format, segments }) => {
  const songDuration = format.meta?.durationSeconds || 0;
  
  const steps = [
    `Download ${segments.length} video clips from Cloudinary`,
    `Trim each clip to exact duration (${segments.filter((s) => s.type === "rapid").length} rapid clips at 0.1s intervals)`,
    "Scale and pad clips to 9:16 aspect ratio (1080x1920)",
    "Concatenate clips in sequence",
    `Mix with song audio (${format.source})`,
    "Output final video with faststart for streaming",
  ];

  const ffmpegCommand = [
    "ffmpeg",
    `-i ${format.source}`,
    "[clip inputs...]",
    `-filter_complex "[clips trimmed, scaled, concat][song]"`,
    "-map [vout] -map [aout]",
    "-preset veryfast -movflags +faststart",
    "output-song-edit.mp4",
  ].join(" ");

  return {
    steps,
    ffmpegCommand,
    estimatedDuration: songDuration,
    clipCount: segments.length,
    rapidClipCount: segments.filter((s) => s.type === "rapid").length,
  };
};

/**
 * Find an alternative segment within a clip's time range that avoids cuts
 * 
 * @param {Object} params - Parameters
 * @param {number} params.clipStart - Original clip start time
 * @param {number} params.clipEnd - Original clip end time  
 * @param {number} params.requiredDuration - Required duration for the segment
 * @param {number[]} params.cutTimestamps - Array of cut timestamps within the clip
 * @param {number} params.buffer - Buffer time around cuts (default 0.1)
 * @returns {{found: boolean, start: number, end: number}} Alternative segment or null
 */
export const findAlternativeSegmentInClip = ({
  clipStart,
  clipEnd,
  requiredDuration,
  cutTimestamps,
  buffer = CUT_DETECTION_CONFIG.buffer,
}) => {
  const totalRequired = requiredDuration + buffer;
  
  // If no cuts, the original segment is fine
  if (!cutTimestamps || cutTimestamps.length === 0) {
    return {
      found: true,
      start: clipStart,
      end: clipStart + requiredDuration,
    };
  }

  // Filter cuts to only those within our clip range
  const relevantCuts = cutTimestamps
    .filter(t => t > clipStart && t < clipEnd)
    .sort((a, b) => a - b);

  if (relevantCuts.length === 0) {
    return {
      found: true,
      start: clipStart,
      end: clipStart + requiredDuration,
    };
  }

  // Add boundaries to make gap finding easier
  const boundaries = [clipStart, ...relevantCuts, clipEnd];
  
  // Find gaps between cuts that are large enough
  for (let i = 0; i < boundaries.length - 1; i++) {
    const gapStart = boundaries[i];
    const gapEnd = boundaries[i + 1];
    const gapDuration = gapEnd - gapStart;

    if (gapDuration >= totalRequired) {
      // Use start of gap with buffer from cut boundary (except at clip start)
      const safeStart = i === 0 ? gapStart : gapStart + buffer;
      const safeEnd = safeStart + requiredDuration;
      
      // Make sure we don't exceed the gap
      if (safeEnd <= gapEnd - buffer) {
        return {
          found: true,
          start: safeStart,
          end: safeEnd,
        };
      }
    }
  }

  return {
    found: false,
    start: clipStart,
    end: clipStart + requiredDuration,
  };
};

/**
 * Get a replacement clip from the movie index, avoiding already used clips
 * 
 * @param {Object} params - Parameters
 * @param {Object} params.movieIndex - The movie index with chunks
 * @param {Set} params.usedClipKeys - Set of already used clip keys (videoId:startSecond)
 * @param {number} params.requiredDuration - Required duration for the clip
 * @param {string} params.excludeVideoId - Video ID to exclude (the one with cuts)
 * @returns {Object|null} Replacement clip or null
 */
export const getReplacementClip = ({
  movieIndex,
  usedClipKeys = new Set(),
  requiredDuration,
  excludeVideoId = null,
}) => {
  if (!movieIndex?.chunks?.length) {
    return null;
  }

  // Shuffle chunks to get variety
  const shuffledChunks = [...movieIndex.chunks].sort(() => Math.random() - 0.5);
  
  for (const chunk of shuffledChunks) {
    const clipStart = chunk.start_offset ?? 0;
    const clipEnd = chunk.end_offset ?? clipStart + 10;
    const clipDuration = clipEnd - clipStart;
    
    // Skip if same video we're replacing
    if (excludeVideoId && chunk.videoId === excludeVideoId) {
      continue;
    }
    
    // Skip banned clips
    if (isBannedClip(chunk.videoId, clipStart)) {
      continue;
    }
    
    // Skip already used clips
    const clipKey = `${chunk.videoId}:${Math.floor(clipStart)}`;
    if (usedClipKeys.has(clipKey)) {
      continue;
    }
    
    // Check if clip is long enough
    if (clipDuration < requiredDuration) {
      continue;
    }
    
    return {
      indexId: chunk.indexId,
      videoId: chunk.videoId,
      start: clipStart,
      end: clipStart + requiredDuration,
      confidence: 0.1,
      thumbnail: chunk.thumbnail,
    };
  }
  
  return null;
};

// ============================================================================
// INSTANT MODE FUNCTIONS
// For lightning-fast song edit generation using pre-baked clips
// ============================================================================

// VideoId to Cloudinary public_id mapping.
//
// Canonical (post-migration) IDs point at the stored 30fps CFR assets.
// Legacy IDs remain supported in reverse mapping for back-compat with older data.
export const VIDEO_ID_TO_CLOUDINARY_LEGACY = {
  '69254495b401380ebb921f0d': 'Kill_Bill_Vol1_Part1',
  '69254488b401380ebb921f0a': 'Kill_Bill_Vol1_Part2',
  '69255fc7c631cdc4fe330a73': 'Kill_Bill_Vol2_Part1',
  '69255fe49fbc66589d49dbac': 'Kill_Bill_Vol2_Part2',
  '69255ff6c631cdc4fe330a9c': 'Kill_Bill_Vol2_Part3',
};

const CANONICAL_SUFFIX = "_30FPS";
const CUTOUT_SUFFIX = "_CUTOUT";
const stripExtension = (value) => (value ? value.replace(/\.mp4$/i, "") : value);
const normalizeCanonicalId = (legacyId) => {
  if (!legacyId) return legacyId;
  const trimmed = stripExtension(legacyId);
  const lower = trimmed.toLowerCase();
  const hasCutout = lower.endsWith(CUTOUT_SUFFIX.toLowerCase());
  const base = hasCutout ? trimmed.slice(0, -CUTOUT_SUFFIX.length) : trimmed;
  let canonical = base;
  if (canonical.toLowerCase().endsWith("_30fps")) {
    canonical = canonical.replace(/_30fps$/i, CANONICAL_SUFFIX);
  } else if (!canonical.toUpperCase().endsWith(CANONICAL_SUFFIX)) {
    canonical = `${canonical}${CANONICAL_SUFFIX}`;
  }
  return hasCutout ? `${canonical}${CUTOUT_SUFFIX}` : canonical;
};

export const VIDEO_ID_TO_CLOUDINARY = Object.fromEntries(
  Object.entries(VIDEO_ID_TO_CLOUDINARY_LEGACY).map(([videoId, legacyId]) => [
    videoId,
    normalizeCanonicalId(legacyId),
  ])
);

export const CLOUDINARY_VARIANTS = {
  default: "default",
  cutout: "cutout",
};

export const VIDEO_ID_TO_CLOUDINARY_VARIANTS = Object.fromEntries(
  Object.entries(VIDEO_ID_TO_CLOUDINARY).map(([videoId, canonicalId]) => [
    videoId,
    {
      [CLOUDINARY_VARIANTS.default]: canonicalId,
      [CLOUDINARY_VARIANTS.cutout]: normalizeCanonicalId(`${canonicalId}${CUTOUT_SUFFIX}`),
    },
  ])
);

export const CLOUDINARY_TO_VIDEO_ID = Object.fromEntries(
  [
    // Canonical mappings for all known variants
    ...Object.entries(VIDEO_ID_TO_CLOUDINARY_VARIANTS).flatMap(([videoId, variants]) =>
      Object.values(variants).map((cloudinaryId) => [cloudinaryId, videoId])
    ),
    // Legacy ids (pre-30fps) plus their cutout forms
    ...Object.entries(VIDEO_ID_TO_CLOUDINARY_LEGACY).flatMap(([videoId, legacyId]) => {
      const base = stripExtension(legacyId);
      const canonical = normalizeCanonicalId(base);
      return [
        [base, videoId],
        [canonical, videoId],
        [normalizeCanonicalId(`${base}${CUTOUT_SUFFIX}`), videoId],
      ];
    }),
  ]
);

// Duration buckets for clip matching (seconds)
const DURATION_BUCKETS = {
  rapid: { min: 0.033, max: 0.3 },
  extraShort: { min: 0.3, max: 0.5 },
  short: { min: 0.5, max: 0.8 },
  medium: { min: 0.8, max: 1.2 },
  long: { min: 1.2, max: 1.6 },
  extraLong: { min: 1.6, max: 2.4 },
  superLong: { min: 2.4, max: 3.2 },
  ultraLong: { min: 3.2, max: 4.5 },
  cinematic: { min: 4.5, max: 6.8 },
};
const DURATION_BUCKET_NAMES = Object.keys(DURATION_BUCKETS);
const LAST_DURATION_BUCKET = DURATION_BUCKET_NAMES[DURATION_BUCKET_NAMES.length - 1];

// Cinema edit slug for special handling
const CINEMA_EDIT_SLUG = 'cinemaedit';

// Instant clip pool cache
let instantPoolCache = null;
let cinemaStructureCache = null;

/**
 * Load the pre-baked instant clip pool
 * @returns {Object|null} The instant clip pool or null if not available
 */
export const loadInstantClipPool = () => {
  if (instantPoolCache) {
    return instantPoolCache;
  }
  
  const poolPath = path.join(process.cwd(), "data", "instantClipPool.json");
  
  if (!fs.existsSync(poolPath)) {
    console.warn("[loadInstantClipPool] instantClipPool.json not found");
    return null;
  }
  
  try {
    const content = fs.readFileSync(poolPath, "utf-8");
    instantPoolCache = JSON.parse(content);
    console.log(`[loadInstantClipPool] Loaded ${instantPoolCache.clips?.length || 0} pre-baked clips`);
    return instantPoolCache;
  } catch (error) {
    console.error("[loadInstantClipPool] Error loading pool:", error.message);
    return null;
  }
};

/**
 * Load the Cinema Edit structure file
 * @returns {Object|null} The cinema edit structure or null if not available
 */
export const loadCinemaEditStructure = () => {
  if (cinemaStructureCache) {
    return cinemaStructureCache;
  }
  
  const structurePath = path.join(process.cwd(), "data", "cinema-edit-structure.json");
  
  if (!fs.existsSync(structurePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(structurePath, "utf-8");
    cinemaStructureCache = JSON.parse(content);
    return cinemaStructureCache;
  } catch (error) {
    console.error("[loadCinemaEditStructure] Error:", error.message);
    return null;
  }
};

/**
 * Get the duration bucket for a given duration
 * @param {number} durationSeconds - Duration in seconds
 * @returns {string} Bucket name
 */
export const getDurationBucket = (durationSeconds) => {
  for (const [bucket, range] of Object.entries(DURATION_BUCKETS)) {
    if (durationSeconds >= range.min && durationSeconds < range.max) {
      return bucket;
    }
  }
  return LAST_DURATION_BUCKET;
};

const getClipDurationSeconds = (clip) => {
  if (!clip) return 0;
  if (typeof clip.duration === "number") return clip.duration;
  const start = typeof clip.start === "number" ? clip.start : 0;
  const end = typeof clip.end === "number" ? clip.end : start;
  return Math.max(0, end - start);
};

/**
 * Check if local instant clips are available
 * @returns {boolean} True if instant clips exist on disk
 */
export const hasLocalInstantClips = () => {
  const clipsDir = path.join(process.cwd(), "public", "instant-clips");
  if (!fs.existsSync(clipsDir)) {
    return false;
  }
  
  const files = fs.readdirSync(clipsDir);
  return files.filter(f => f.endsWith('.mp4')).length > 0;
};

/**
 * Check if Cinema Edit optimized assets are available
 * @returns {boolean} True if cinema edit assets exist
 */
export const hasCinemaEditAssets = () => {
  const cinemaDir = path.join(process.cwd(), "public", "instant-edits", "cinema-edit");
  if (!fs.existsSync(cinemaDir)) {
    return false;
  }
  
  // Check for at least one rapid section variant
  const rapidPath = path.join(cinemaDir, "rapid-1-variant-a.mp4");
  return fs.existsSync(rapidPath);
};

/**
 * Create an instant song edit plan using pre-baked clips
 * No API calls, pure JSON lookup - executes in ~5ms
 * 
 * @param {Object} params
 * @param {string} params.songSlug - Song format slug
 * @returns {Object} Edit plan with local file paths
 */
export const createInstantSongEditPlan = ({ songSlug }) => {
  const format = loadSongFormat(songSlug);
  const pool = loadInstantClipPool();
  
  if (!pool?.clips?.length) {
    throw new Error("Instant clip pool not available. Run scripts/generate-instant-pool.js first.");
  }
  
  // Ensure format has target FPS
  if (!format.meta) format.meta = {};
  if (!format.meta.targetFps) format.meta.targetFps = TARGET_FPS;
  
  const fps = format.meta.targetFps;
  
  // Check if this is the Cinema Edit (special optimized handling)
  const isCinemaEdit = songSlug === CINEMA_EDIT_SLUG;
  const cinemaStructure = isCinemaEdit ? loadCinemaEditStructure() : null;
  const hasOptimizedAssets = isCinemaEdit && hasCinemaEditAssets() && cinemaStructure;
  
  console.log(`[createInstantSongEditPlan] Song: ${songSlug}, Cinema Edit: ${isCinemaEdit}, Optimized: ${hasOptimizedAssets}`);
  
  // Calculate frame-accurate segments
  const { segments: frameSegments, totalFrames } = calculateFrameAccurateSegments(format);
  
  // Determine if we have local clips available
  const useLocalClips = hasLocalInstantClips();
  const localClipsDir = path.join(process.cwd(), "public", "instant-clips");
  
  // Build segments with clip assignments
  const segments = [];
  const usedClipIndices = new Set();
  let recentlyUsedIndices = [];
  const minSpacing = 5;
  const clipDurations = pool.clips.map(getClipDurationSeconds);
  const clipsByDurationDesc = clipDurations
    .map((duration, idx) => ({ duration, idx }))
    .sort((a, b) => b.duration - a.duration);
  const getQualifiedIndices = (requiredDuration) => {
    const preferredBucket = getDurationBucket(requiredDuration);
    const startIdx = Math.max(0, DURATION_BUCKET_NAMES.indexOf(preferredBucket));
    for (let b = startIdx; b < DURATION_BUCKET_NAMES.length; b++) {
      const bucketName = DURATION_BUCKET_NAMES[b];
      const bucketIndices = pool.buckets?.[bucketName] || [];
      const matching = bucketIndices.filter((idx) => clipDurations[idx] >= requiredDuration);
      if (matching.length) {
        return matching;
      }
    }
    // Fall back to any clip that is long enough
    return clipsByDurationDesc
      .filter(({ duration }) => duration >= requiredDuration)
      .map(({ idx }) => idx);
  };
  const pickRandomIndex = (indices) => {
    if (!indices?.length) return null;
    const rand = Math.floor(Math.random() * indices.length);
    return indices[rand];
  };
  
  // For Cinema Edit with optimized assets, use pre-rendered sections
  const rapidRanges = format.rapidClipRanges || [];
  
  for (let i = 0; i < frameSegments.length; i++) {
    const frameSeg = frameSegments[i];
    const segmentDuration = frameSeg.durationSeconds;
    
    // Check if this segment falls within a rapid range (for Cinema Edit)
    let isInRapidRange = false;
    let rapidRangeIndex = -1;
    
    if (isCinemaEdit) {
      for (let r = 0; r < rapidRanges.length; r++) {
        if (frameSeg.startSeconds >= rapidRanges[r].start && frameSeg.startSeconds < rapidRanges[r].end) {
          isInRapidRange = true;
          rapidRangeIndex = r;
          break;
        }
      }
    }
    
    const neededDuration = Math.max(
      frameSeg.minSourceDuration || segmentDuration + 0.05,
      segmentDuration + (1 / fps)
    );
    let candidateIndices = getQualifiedIndices(neededDuration);
    if (!candidateIndices.length) {
      const fallbackIdx = clipsByDurationDesc[0]?.idx ?? 0;
      console.warn(`[createInstantSongEditPlan] No clip >= ${neededDuration.toFixed(3)}s; falling back to longest clip (${clipDurations[fallbackIdx]?.toFixed(3)}s)`);
      candidateIndices = [fallbackIdx];
    }
    
    // Filter to eligible clips (not recently used)
    let eligibleIndices = candidateIndices.filter(idx => !recentlyUsedIndices.slice(-minSpacing).includes(idx));
    if (!eligibleIndices.length) {
      eligibleIndices = candidateIndices;
    }
    
    const selectedIdx = pickRandomIndex(eligibleIndices);
    if (selectedIdx === null || selectedIdx === undefined) {
      throw new Error(`[createInstantSongEditPlan] Unable to select clip for segment ${i}`);
    }
    const selectedClip = pool.clips[selectedIdx];
    if (!selectedClip) {
      throw new Error(`[createInstantSongEditPlan] Clip index ${selectedIdx} not found in pool`);
    }
    const selectedClipDuration = clipDurations[selectedIdx];
    
    // Build segment entry
    const segment = {
      index: i,
      songTime: frameSeg.startSeconds,
      duration: segmentDuration,
      frameCount: frameSeg.frameCount,
      minSourceDuration: frameSeg.minSourceDuration,
      type: frameSeg.type,
      fps,
      // Clip assignment
      asset: {
        indexId: process.env.TWELVELABS_INDEX_ID,
        videoId: CLOUDINARY_TO_VIDEO_ID[selectedClip.cloudinaryId] || selectedClip.videoId,
        cloudinaryId: selectedClip.cloudinaryId,
        start: selectedClip.start,
        end: typeof selectedClip.end === "number"
          ? selectedClip.end
          : selectedClip.start + selectedClipDuration,
        cutFreeVerified: selectedClip.cutFreeVerified || false,
        poolClipId: selectedClip.id,
        availableDuration: selectedClipDuration,
      },
      sourcePoolIndex: selectedIdx,
      isReused: recentlyUsedIndices.includes(selectedIdx),
      // Local file path if available
      localPath: useLocalClips ? path.join(localClipsDir, `${selectedClip.id}.mp4`) : null,
      // Cinema Edit optimization markers
      isInRapidRange,
      rapidRangeIndex,
    };
    
    segments.push(segment);
    
    // Update tracking
    recentlyUsedIndices.push(selectedIdx);
    if (recentlyUsedIndices.length > minSpacing * 2) {
      recentlyUsedIndices.shift();
    }
    usedClipIndices.add(selectedIdx);
  }
  
  // Build Cinema Edit assembly plan if applicable
  let cinemaAssembly = null;
  if (hasOptimizedAssets && cinemaStructure) {
    cinemaAssembly = buildCinemaEditAssembly(format, segments, cinemaStructure);
  }
  
  return {
    songSlug,
    songFormat: {
      source: format.source,
      meta: format.meta,
      beatCount: format.beatGrid?.length || 0,
      rapidRangeCount: rapidRanges.length,
    },
    instantMode: true,
    useLocalClips,
    hasOptimizedAssets,
    fps,
    totalFrames,
    totalClips: segments.length,
    poolSize: pool.clips.length,
    uniqueClipsUsed: usedClipIndices.size,
    segments,
    cinemaAssembly,
    clipPool: {
      totalClips: pool.clips.length,
      buckets: Object.fromEntries(
        Object.entries(pool.buckets || {}).map(([k, v]) => [k, v.length])
      ),
    },
  };
};

/**
 * Build assembly instructions for Cinema Edit using pre-rendered sections
 * 
 * @param {Object} format - Song format
 * @param {Array} segments - All segments
 * @param {Object} cinemaStructure - Cinema edit structure file
 * @returns {Object} Assembly instructions
 */
const buildCinemaEditAssembly = (format, segments, cinemaStructure) => {
  const rapidRanges = format.rapidClipRanges || [];
  const songDuration = format.meta?.durationSeconds || 106;
  const cinemaDir = path.join(process.cwd(), "public", "instant-edits", "cinema-edit");
  
  // Randomly select variants
  const rapidVariants = rapidRanges.map((_, idx) => {
    const variant = ['a', 'b', 'c'][Math.floor(Math.random() * 3)];
    return {
      section: idx + 1,
      variant,
      filename: `rapid-${idx + 1}-variant-${variant}.mp4`,
      path: path.join(cinemaDir, `rapid-${idx + 1}-variant-${variant}.mp4`),
      timeRange: rapidRanges[idx],
    };
  });
  
  const secondHalfVariant = ['a', 'b'][Math.floor(Math.random() * 2)];
  const lastRapidEnd = rapidRanges.length > 0 
    ? Math.max(...rapidRanges.map(r => r.end)) 
    : 82;
  
  // Build ordered assembly pieces
  const pieces = [];
  let currentTime = 0;
  
  // Identify section boundaries
  const sectionBoundaries = [
    { type: 'intro', start: 0, end: format.beatGrid?.[0] || 4.5 },
  ];
  
  // Add beats before first rapid
  if (rapidRanges.length > 0) {
    sectionBoundaries.push({
      type: 'first_half_beats',
      start: format.beatGrid?.[0] || 4.5,
      end: rapidRanges[0].start,
    });
  }
  
  // Add rapid sections and inter-rapid beats
  for (let i = 0; i < rapidRanges.length; i++) {
    sectionBoundaries.push({
      type: 'rapid',
      index: i,
      start: rapidRanges[i].start,
      end: rapidRanges[i].end,
    });
    
    // Add beats between rapid sections
    if (i < rapidRanges.length - 1) {
      sectionBoundaries.push({
        type: 'inter_rapid_beats',
        start: rapidRanges[i].end,
        end: rapidRanges[i + 1].start,
      });
    }
  }
  
  // Add second half
  sectionBoundaries.push({
    type: 'second_half',
    start: lastRapidEnd,
    end: songDuration,
  });
  
  // Build pieces array
  for (const section of sectionBoundaries) {
    if (section.type === 'rapid') {
      // Use pre-rendered rapid section
      const rapidInfo = rapidVariants[section.index];
      pieces.push({
        type: 'pre_rendered',
        section: `rapid_${section.index + 1}`,
        path: rapidInfo.path,
        filename: rapidInfo.filename,
        startTime: section.start,
        endTime: section.end,
        duration: section.end - section.start,
      });
    } else if (section.type === 'second_half' && cinemaStructure.secondHalf?.length) {
      // Use pre-rendered second half
      pieces.push({
        type: 'pre_rendered',
        section: 'second_half',
        path: path.join(cinemaDir, `second-half-variant-${secondHalfVariant}.mp4`),
        filename: `second-half-variant-${secondHalfVariant}.mp4`,
        startTime: section.start,
        endTime: section.end,
        duration: section.end - section.start,
      });
    } else {
      // Use individual clips for this section
      const sectionSegments = segments.filter(
        s => s.songTime >= section.start && s.songTime < section.end
      );
      
      pieces.push({
        type: 'clip_sequence',
        section: section.type,
        startTime: section.start,
        endTime: section.end,
        clipCount: sectionSegments.length,
        segments: sectionSegments.map(s => s.index),
      });
    }
  }
  
  return {
    variant: {
      rapid: rapidVariants.map(r => r.variant),
      secondHalf: secondHalfVariant,
    },
    pieces,
    rapidVariants,
    secondHalfPath: path.join(cinemaDir, `second-half-variant-${secondHalfVariant}.mp4`),
    estimatedFFmpegInputs: pieces.filter(p => p.type === 'pre_rendered').length +
      pieces.filter(p => p.type === 'clip_sequence').reduce((sum, p) => sum + p.clipCount, 0),
  };
};

/**
 * Clear instant mode caches
 * Useful for testing or when files are updated
 */
export const clearInstantCaches = () => {
  instantPoolCache = null;
  cinemaStructureCache = null;
};

// Back-compat alias used by clip-pool API routes.
export const invalidateInstantClipPoolCache = () => {
  clearInstantCaches();
};

export default {
  loadSongFormat,
  listSongFormats,
  calculateClipTimestamps,
  calculateFrameAccurateSegments,
  createSongEditPlan,
  findAlternativeSegmentInClip,
  getReplacementClip,
  CUT_DETECTION_CONFIG,
  TARGET_FPS,
  // Instant mode exports
  loadInstantClipPool,
  loadCinemaEditStructure,
  getDurationBucket,
  hasLocalInstantClips,
  hasCinemaEditAssets,
  createInstantSongEditPlan,
  clearInstantCaches,
  invalidateInstantClipPoolCache,
  CINEMA_EDIT_SLUG,
};

