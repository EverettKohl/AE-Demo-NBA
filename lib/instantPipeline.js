import {
  loadQuickEdit3Format,
  buildQuickEdit3Segments,
  assignQuickEdit3Clips,
  trimQuickEdit3Segments,
  createClipPoolSummary,
} from "./quickEdit3.js";
import { loadInstantClipPool } from "./songEdit.js";

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

const remapIndices = (indices = [], indexMap = new Map()) =>
  indices
    .map((idx) => indexMap.get(idx))
    .filter((val) => typeof val === "number" && val >= 0);

const applyPoolPermutation = (pool, perm) => {
  if (!pool?.clips?.length) return pool;
  const newClips = perm.map((oldIdx) => pool.clips[oldIdx]);
  const indexMap = new Map();
  perm.forEach((oldIdx, newIdx) => indexMap.set(oldIdx, newIdx));

  const remapBuckets = (buckets = {}) =>
    Object.fromEntries(
      Object.entries(buckets).map(([bucket, indices]) => [bucket, remapIndices(indices || [], indexMap)])
    );

  const remapTagBuckets = (tagBuckets = {}) =>
    Object.fromEntries(
      Object.entries(tagBuckets).map(([tag, indices]) => [tag, remapIndices(indices || [], indexMap)])
    );

  return {
    ...pool,
    clips: newClips,
    buckets: remapBuckets(pool.buckets || {}),
    tagBuckets: remapTagBuckets(pool.tagBuckets || {}),
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
    const biasWeight = Math.pow(normalized, 2); // emphasize longer clips
    const jitter = rng() * 0.25; // prevent strict ordering
    return { idx, score: biasWeight + jitter };
  });

  weighted.sort((a, b) => b.score - a.score);
  const perm = weighted.map((entry) => entry.idx);
  return perm;
};

export const buildInstantPlan = ({ songSlug, chronologicalOrder = false, variantSeed = Date.now(), bias = true }) => {
  if (!songSlug) {
    throw new Error("songSlug is required");
  }

  const format = loadQuickEdit3Format(songSlug);
  const pool = loadInstantClipPool();
  if (!pool?.clips?.length) {
    throw new Error("Instant clip pool not available. Generate data/instantClipPool.json first.");
  }

  const seed = Number.isFinite(variantSeed) ? variantSeed : Date.now();
  const permutation = bias ? buildBiasedPermutation(pool, seed) : pool.clips.map((_, idx) => idx);
  const biasedPool = applyPoolPermutation(pool, permutation);

  const { segments, fps, totalFrames, stats } = buildQuickEdit3Segments(format);
  const { usedClipIndices, swapHistory } = assignQuickEdit3Clips({
    segments,
    pool: biasedPool,
    options: { chronologicalOrder },
  });
  const trimResult = trimQuickEdit3Segments({ segments, fps });

  const plan = {
    songSlug,
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
      ...createClipPoolSummary(biasedPool),
      uniqueClipsUsed: usedClipIndices.size,
      usedClipCount: usedClipIndices.size,
      swapCount: swapHistory.length,
    },
    variantSeed: seed,
    biasInfo: {
      strategy: bias ? "duration_priority_seeded" : "none",
      seed,
    },
  };

  return plan;
};

