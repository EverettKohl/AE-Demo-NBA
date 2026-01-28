"use strict";

import fs from "fs";
import path from "path";
import {
  loadQuickEdit3Format,
  buildQuickEdit3Segments,
  assignQuickEdit3Clips,
  trimQuickEdit3Segments,
} from "@/lib/quickEdit3";
import { loadInstantClipPool } from "@/lib/songEdit";
import { computeTriPartBoundaries } from "@/lib/partBoundaries";

const PUBLIC_ROOT = path.join(process.cwd(), "public", "instant-edits");

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const buildBiasedPermutation = (pool, seed) => {
  const rng = mulberry32(seed || Date.now());
  const clips = pool?.clips || [];
  const durations = clips.map((clip) => {
    if (!clip) return 0;
    if (typeof clip.duration === "number") return clip.duration;
    const start = typeof clip.start === "number" ? clip.start : 0;
    const end = typeof clip.end === "number" ? clip.end : start;
    return Math.max(0, end - start);
  });

  const maxDuration = durations.reduce((m, v) => Math.max(m, v || 0), 0) || 1;
  const weighted = clips.map((_, idx) => {
    const normalized = Math.max(0, durations[idx] || 0) / maxDuration;
    const biasWeight = Math.pow(normalized, 2);
    const jitter = rng() * 0.25;
    return { idx, score: biasWeight + jitter };
  });

  weighted.sort((a, b) => b.score - a.score);
  return weighted.map((entry) => entry.idx);
};

const applyPoolPermutation = (pool, perm) => {
  if (!pool?.clips?.length) return pool;
  const newClips = perm.map((oldIdx) => pool.clips[oldIdx]);
  const indexMap = new Map();
  perm.forEach((oldIdx, newIdx) => indexMap.set(oldIdx, newIdx));

  const remapIndices = (indices = []) =>
    indices
      .map((idx) => indexMap.get(idx))
      .filter((val) => typeof val === "number" && val >= 0);

  const remapBuckets = (buckets = {}) =>
    Object.fromEntries(
      Object.entries(buckets).map(([bucket, indices]) => [bucket, remapIndices(indices || [])])
    );

  const remapTagBuckets = (tagBuckets = {}) =>
    Object.fromEntries(
      Object.entries(tagBuckets).map(([tag, indices]) => [tag, remapIndices(indices || [])])
    );

  return {
    ...pool,
    clips: newClips,
    buckets: remapBuckets(pool.buckets || {}),
    tagBuckets: remapTagBuckets(pool.tagBuckets || {}),
  };
};

const rebaseSegments = (segments, startIdx, endIdx) => {
  const slice = segments.slice(startIdx, endIdx);
  if (!slice.length) return { segments: [], totalFrames: 0 };

  const baseStart = slice[0].startSeconds || 0;

  let cursorFrame = 0;
  const rebased = slice.map((seg, i) => {
    const duration = typeof seg.durationSeconds === "number" ? seg.durationSeconds : 0;
    const frameCount =
      typeof seg.frameCount === "number"
        ? seg.frameCount
        : typeof seg.beatFrameCount === "number"
        ? seg.beatFrameCount
        : Math.round(duration * (seg.fps || 30));
    const beatMeta =
      seg.type === "rapid"
        ? seg.rapidClipSlot
          ? { ...seg.rapidClipSlot }
          : seg.beatMetadata
        : seg.beatMetadata;
    const beatTime =
      typeof beatMeta?.beatTime === "number" ? beatMeta.beatTime - baseStart : undefined;
    const next = {
      ...seg,
      index: i,
      startSeconds: Math.max(0, seg.startSeconds - baseStart),
      endSeconds: Math.max(0, seg.endSeconds - baseStart),
      startFrame: cursorFrame,
      endFrame: cursorFrame + frameCount,
      beatMetadata:
        beatMeta && beatTime !== undefined ? { ...beatMeta, beatTime } : beatMeta || seg.beatMetadata,
    };
    cursorFrame += frameCount;
    return next;
  });

  return { segments: rebased, totalFrames: cursorFrame };
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeDataUrlToFile = (dataUrl, targetPath) => {
  const parts = typeof dataUrl === "string" ? dataUrl.split(",") : [];
  if (parts.length < 2) {
    throw new Error("Invalid dataUrl");
  }
  const buffer = Buffer.from(parts[1], "base64");
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, buffer);
};

const renderPlanToFile = async ({ plan, seed, songSlug }) => {
  const renderer = globalThis.__debugRenderInstantSongEdit;
  if (typeof renderer !== "function") {
    throw new Error("Instant renderer unavailable");
  }
  const render = await renderer(plan, {});
  if (!render?.dataUrl) {
    throw new Error(`Render failed for ${plan.partType}`);
  }
  const filename = `${plan.partType}-${seed}.mp4`;
  const absPath = path.join(PUBLIC_ROOT, songSlug, "parts", filename);
  writeDataUrlToFile(render.dataUrl, absPath);
  const url = `/instant-edits/${songSlug}/parts/${filename}`;
  const duration =
    render?.meta?.duration ?? plan.segments.reduce((s, seg) => s + (seg.durationSeconds || 0), 0);
  return { url, absPath, duration };
};

export const buildInstantPartVariants = async ({
  songSlug,
  chronologicalOrder = false,
  bias = true,
  counts = { intro: 1, body: 1, outro: 1 },
  baseSeed = Date.now(),
}) => {
  if (!songSlug) {
    throw new Error("songSlug is required");
  }

  const format = loadQuickEdit3Format(songSlug);
  const pool = loadInstantClipPool();
  if (!pool?.clips?.length) {
    throw new Error("Instant clip pool not available. Generate data/instantClipPool.json first.");
  }

  const { segments: fullSegments, fps, stats } = buildQuickEdit3Segments(format);
  const { introEndIdx, outroStartIdx, boundariesSeconds } = computeTriPartBoundaries(fullSegments);
  const windows = {
    intro: { startIdx: 0, endIdx: introEndIdx },
    body: { startIdx: introEndIdx, endIdx: outroStartIdx },
    outro: { startIdx: outroStartIdx, endIdx: fullSegments.length },
  };

  const results = [];
  const totalCounts = {
    intro: Math.max(0, counts.intro || 0),
    body: Math.max(0, counts.body || 0),
    outro: Math.max(0, counts.outro || 0),
  };

  let seedCursor = baseSeed;
  for (const partType of ["intro", "body", "outro"]) {
    const count = totalCounts[partType];
    for (let i = 0; i < count; i += 1) {
      const seed = seedCursor + i + 1;
      const perm = bias ? buildBiasedPermutation(pool, seed) : pool.clips.map((_, idx) => idx);
      const biasedPool = applyPoolPermutation(pool, perm);
      const window = windows[partType];
      const { segments, totalFrames } = rebaseSegments(fullSegments, window.startIdx, window.endIdx);
      const { usedClipIndices, swapHistory } = assignQuickEdit3Clips({
        segments,
        pool: biasedPool,
        options: { chronologicalOrder },
      });
      const trimResult = trimQuickEdit3Segments({ segments, fps });

      const plan = {
        songSlug,
        partType,
        songFormat: {
          source: format.source,
          meta: format.meta || {},
          beatCount: format.beatGrid?.length || 0,
          rapidRangeCount: format.rapidClipRanges?.length || 0,
        },
        chronologicalOrder: Boolean(chronologicalOrder),
        selectionMode: chronologicalOrder ? "chronological" : "randomized",
        fps,
        totalFrames: trimResult?.totalFrames ?? totalFrames,
        totalClips: segments.length,
        uniqueClipsUsed: usedClipIndices.size,
        swapCount: swapHistory.length,
        stats,
        segments,
        clipPool: {
          totalClips: Array.isArray(biasedPool?.clips) ? biasedPool.clips.length : 0,
          uniqueClipsUsed: usedClipIndices.size,
          usedClipCount: usedClipIndices.size,
          swapCount: swapHistory.length,
        },
        boundaries: {
          introEndSeconds: boundariesSeconds.introEnd,
          outroStartSeconds: boundariesSeconds.outroStart,
          startUnitIdx: window.startIdx,
          endUnitIdx: window.endIdx,
        },
      };

      const partDuration = segments.reduce((s, seg) => s + (seg.durationSeconds || 0), 0);
      const startSeconds = fullSegments[window.startIdx]?.startSeconds || 0;
      plan.partWindow = {
        startSeconds,
        endSeconds: startSeconds + partDuration,
      };

      const render = await renderPlanToFile({ plan, seed, songSlug });
      results.push({
        id: `${partType}-${seed}`,
        partType,
        seed,
        renderUrl: render.url,
        durationSeconds: render.duration,
        startSeconds: 0,
        endSeconds: render.duration,
        boundaries: plan.boundaries,
        status: "ready",
        plan,
      });
    }
    seedCursor += count + 10;
  }

  return {
    parts: results,
    boundaries: boundariesSeconds,
  };
};

export const rebuildSinglePart = async ({
  songSlug,
  partEntry,
  overrides = {},
  chronologicalOrder = false,
}) => {
  if (!songSlug || !partEntry) {
    throw new Error("songSlug and partEntry are required");
  }
  const format = loadQuickEdit3Format(songSlug);
  const pool = loadInstantClipPool();
  if (!pool?.clips?.length) {
    throw new Error("Instant clip pool not available. Generate data/instantClipPool.json first.");
  }

  const seed = partEntry.seed || Date.now();
  const perm = buildBiasedPermutation(pool, seed);
  const biasedPool = applyPoolPermutation(pool, perm);

  const { segments: fullSegments, fps, stats } = buildQuickEdit3Segments(format);
  const startIdx = partEntry.boundaries?.startUnitIdx ?? 0;
  const endIdx = partEntry.boundaries?.endUnitIdx ?? fullSegments.length;
  const { segments, totalFrames } = rebaseSegments(fullSegments, startIdx, endIdx);

  const { usedClipIndices, swapHistory } = assignQuickEdit3Clips({
    segments,
    pool: biasedPool,
    options: { chronologicalOrder },
  });

  // Apply overrides (replace/trim) similar to Quick Edit 3 rerender
  const applyOverrides = (segs, edits) => {
    if (!edits || typeof edits !== "object") return segs;
    return segs.map((segment, index) => {
      const edited = edits[index] ?? edits[String(index)];
      if (!edited) return segment;
      if (
        !edited.videoId ||
        typeof edited.start !== "number" ||
        typeof edited.end !== "number" ||
        edited.end <= edited.start
      ) {
        return segment;
      }
      return {
        ...segment,
        asset: {
          ...segment.asset,
          videoId: edited.videoId,
          indexId: edited.indexId || segment.asset?.indexId || null,
          start: edited.start,
          end: edited.end,
        },
      };
    });
  };

  const overriddenSegments = applyOverrides(segments, overrides);
  const trimResult = trimQuickEdit3Segments({ segments: overriddenSegments, fps });

  const partDuration = overriddenSegments.reduce((s, seg) => s + (seg.durationSeconds || 0), 0);
  const startSeconds = fullSegments[startIdx]?.startSeconds || 0;
  const plan = {
    songSlug,
    partType: partEntry.partType,
    songFormat: {
      source: format.source,
      meta: format.meta || {},
      beatCount: format.beatGrid?.length || 0,
      rapidRangeCount: format.rapidClipRanges?.length || 0,
    },
    chronologicalOrder: Boolean(chronologicalOrder),
    selectionMode: chronologicalOrder ? "chronological" : "randomized",
    fps,
    totalFrames: trimResult?.totalFrames ?? totalFrames,
    totalClips: overriddenSegments.length,
    uniqueClipsUsed: usedClipIndices.size,
    swapCount: swapHistory.length,
    stats,
    segments: overriddenSegments,
    clipPool: {
      totalClips: Array.isArray(biasedPool?.clips) ? biasedPool.clips.length : 0,
      uniqueClipsUsed: usedClipIndices.size,
      usedClipCount: usedClipIndices.size,
      swapCount: swapHistory.length,
    },
    boundaries: partEntry.boundaries,
    partWindow: {
      startSeconds,
      endSeconds: startSeconds + partDuration,
    },
  };

  const render = await renderPlanToFile({ plan, seed, songSlug });

  return {
    id: partEntry.id,
    partType: partEntry.partType,
    seed,
    renderUrl: render.url,
    durationSeconds: render.duration,
    startSeconds: 0,
    endSeconds: render.duration,
    boundaries: plan.boundaries,
    status: "ready",
    plan,
  };
};

export default {
  buildInstantPartVariants,
  rebuildSinglePart,
};
