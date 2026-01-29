import fs from "fs";
import path from "path";
import { calculateFrameAccurateSegments, getDurationBucket, loadInstantClipPool, hasLocalInstantClips } from "./songEdit.js";
import { loadSongFormat6 } from "./songEdit6.js";
import { secondsToFrame, frameToSeconds, getEditPlanStats } from "./frameAccurateTiming.js";
import {
  clampVolume,
  getBeatKey,
  normalizeBeatMetadata,
  normalizeIntroBeat,
} from "./songEditScheduler.js";

const RAPID_SAFETY_DEFAULTS = { clipVolume: 0, musicVolume: 1, pauseMusic: false };

const DURATION_BUCKET_SEQUENCE = [
  "rapid",
  "extraShort",
  "short",
  "medium",
  "long",
  "extraLong",
  "superLong",
  "ultraLong",
  "cinematic",
];

const getClipDurationSeconds = (clip) => {
  if (!clip) return 0;
  if (typeof clip.duration === "number") return clip.duration;
  const start = typeof clip.start === "number" ? clip.start : 0;
  const end = typeof clip.end === "number" ? clip.end : start;
  return Math.max(0, end - start);
};

const pickRandom = (items = []) => {
  if (!items.length) return null;
  const idx = Math.floor(Math.random() * items.length);
  return items[idx];
};

export const buildBucketCounts = (buckets = {}) => {
  return Object.fromEntries(
    Object.entries(buckets).map(([bucket, indices]) => [bucket, Array.isArray(indices) ? indices.length : 0])
  );
};

export const resolveLocalClipPath = (clipId) => {
  if (!clipId) return null;
  const localDir = path.join(process.cwd(), "public", "instant-clips");
  const candidate = path.join(localDir, `${clipId}.mp4`);
  return fs.existsSync(candidate) ? candidate : null;
};

export const createClipPoolSummary = (pool) => ({
  totalClips: Array.isArray(pool?.clips) ? pool.clips.length : 0,
  buckets: buildBucketCounts(pool?.buckets),
});

const assignClipToSegment = ({
  segment,
  clip,
  clipDuration,
  poolIndex,
  useLocalPaths,
}) => {
  segment.asset = {
    indexId: clip.indexId || null,
    videoId: clip.videoId || null,
    cloudinaryId: clip.cloudinaryId || null,
    start: clip.start ?? 0,
    end: (clip.start ?? 0) + segment.durationSeconds,
    duration: segment.durationSeconds,
    cutFreeVerified: Boolean(clip.cutFreeVerified),
    poolClipId: clip.id,
    availableDuration: clipDuration,
    sourcePoolIndex: poolIndex,
    localPath: useLocalPaths ? resolveLocalClipPath(clip.id) : null,
  };
};

const filterClipPoolForClips = (pool) => {
  const clips = (pool?.clips || []).filter((c) => (c?.type || "clip") === "clip");
  const buckets = {};
  const tagBuckets = {};
  clips.forEach((clip, idx) => {
    const bucketName = clip.durationBucket || getDurationBucket(getClipDurationSeconds(clip));
    if (!buckets[bucketName]) buckets[bucketName] = [];
    buckets[bucketName].push(idx);
    if (clip?.tags?.some((tag) => (tag || "").toLowerCase().includes("dialogue"))) {
      if (!tagBuckets.dialogue) tagBuckets.dialogue = [];
      tagBuckets.dialogue.push(idx);
    }
  });
  return { ...pool, clips, buckets, tagBuckets };
};

const gatherCandidates = ({
  requiredDuration,
  bucketName,
  pool,
  clipDurations,
  exclude = new Set(),
  used = new Set(),
  allowed = null,
  forceAllBuckets = false,
}) => {
  const bucketStart = DURATION_BUCKET_SEQUENCE.indexOf(bucketName);
  const candidates = [];

  const addFromBucket = (bucket) => {
    const indices = pool?.buckets?.[bucket] || [];
    for (const idx of indices) {
      if (exclude.has(idx)) continue;
      if (used.has(idx)) continue;
      if ((clipDurations[idx] ?? 0) < requiredDuration) continue;
      if (allowed && !allowed.has(idx)) continue;
      candidates.push(idx);
    }
  };

  if (bucketStart >= 0 && !forceAllBuckets) {
    for (let i = bucketStart; i < DURATION_BUCKET_SEQUENCE.length; i += 1) {
      const bucket = DURATION_BUCKET_SEQUENCE[i];
      addFromBucket(bucket);
      if (candidates.length) {
        return candidates;
      }
    }
  }

  Object.keys(pool?.buckets || {}).forEach(addFromBucket);

  if (candidates.length) {
    return candidates;
  }

  const sorted = [...(pool?.clips || []).keys()]
    .filter(
      (idx) =>
        !exclude.has(idx) &&
        !used.has(idx) &&
        (clipDurations[idx] ?? 0) >= requiredDuration &&
        (!allowed || allowed.has(idx))
    )
    .sort((a, b) => (clipDurations[b] || 0) - (clipDurations[a] || 0));
  return sorted;
};

export const assignQuickEdit6Clips = ({
  segments,
  pool,
  options = {},
}) => {
  const filteredPool = filterClipPoolForClips(pool);
  const { useLocalPaths = hasLocalInstantClips(), chronologicalOrder = false } = options;
  const clipDurations = filteredPool.clips.map(getClipDurationSeconds);
  const usedClipIndices = new Set();
  const swapHistory = [];
  const poolSize = filteredPool?.clips?.length || 0;
  const totalSegments = segments?.length || 0;
  const chronologicalWindowSize = chronologicalOrder
    ? Math.max(15, Math.floor(poolSize / Math.max(totalSegments, 1)) + 5)
    : 0;
  const dialogueTagIndices = (() => {
    const fromBuckets = filteredPool?.tagBuckets?.dialogue || [];
    const fromTags = [];
    (filteredPool?.clips || []).forEach((clip, idx) => {
      if (clip?.tags?.some((tag) => (tag || "").toLowerCase().includes("dialogue"))) {
        fromTags.push(idx);
      }
    });
    return Array.from(new Set([...fromBuckets, ...fromTags]));
  })();
  const dialogueAllowed = new Set(dialogueTagIndices);

  const requiresDialogue = (segment) => {
    const tags = segment?.beatMetadata?.guidelineTags || [];
    const intent = (segment?.beatMetadata?.intent || "").toLowerCase();
    const hasDialogueTag = tags.some((tag) => (tag || "").toLowerCase().includes("dialogue"));
    return hasDialogueTag || intent === "dialogue";
  };

  const assignForSegment = (segmentIndex, { exclude = new Set(), allowSwap = true } = {}) => {
    const segment = segments[segmentIndex];
    const requiredDuration = Math.max(segment.durationSeconds, segment.minSourceDuration || 0);
    const bucket = getDurationBucket(requiredDuration);
    const needsDialogue = requiresDialogue(segment);
    const needsPause = Boolean(segment.beatMetadata?.clipSlot?.pauseMusic);
    const allowedSet = needsDialogue ? dialogueAllowed : null;
    if (needsDialogue && allowedSet.size === 0) {
      throw new Error("Dialogue clips required but dialogue pool is empty");
    }
    const selectionTarget = chronologicalOrder
      ? Math.floor(((segmentIndex || 0) / Math.max(totalSegments - 1, 1)) * Math.max(poolSize - 1, 0))
      : null;

    const buildAllowedWindows = () => {
      if (!chronologicalOrder || poolSize === 0) {
        return [null];
      }
      const windows = [];
      const pushWindow = (start, end) => {
        const normalizedStart = Math.max(0, Math.min(poolSize - 1, Math.floor(start)));
        const normalizedEnd = Math.max(normalizedStart + 1, Math.min(poolSize, Math.floor(end)));
        const key = `${normalizedStart}:${normalizedEnd}`;
        if (!windows.some((win) => win && `${win.start}:${win.end}` === key)) {
          windows.push({ start: normalizedStart, end: normalizedEnd });
        }
      };
      pushWindow(selectionTarget, selectionTarget + chronologicalWindowSize);
      pushWindow(
        Math.max(0, selectionTarget - Math.floor(chronologicalWindowSize / 2)),
        selectionTarget + Math.floor(chronologicalWindowSize / 2)
      );
      pushWindow(
        Math.max(0, selectionTarget - chronologicalWindowSize),
        selectionTarget + chronologicalWindowSize * 2
      );
      windows.push(null); // final fallback allows entire pool
      return windows;
    };

    const windowedAllowedSets = buildAllowedWindows().map((window) => {
      if (!window) return null;
      const windowSet = new Set();
      for (let idx = window.start; idx < window.end && idx < poolSize; idx += 1) {
        windowSet.add(idx);
      }
      return windowSet;
    });

    const selectCandidate = (candidates, targetStart) => {
      if (!candidates.length) return null;
      if (!chronologicalOrder) {
        // PauseMusic must not affect selection; always random after gating/filtering
        return pickRandom(candidates);
      }
      let sorted = [...candidates].sort((a, b) => a - b);
      const jitter = Math.max(3, Math.floor(chronologicalWindowSize / 5));
      const startIdx = typeof targetStart === "number" ? sorted.findIndex((idx) => idx >= targetStart) : -1;

      if (startIdx >= 0) {
        const end = Math.min(sorted.length, startIdx + jitter);
        const windowSlice = sorted.slice(startIdx, end);
        const pick = pickRandom(windowSlice);
        if (pick !== null && pick !== undefined) {
          return pick;
        }
        return sorted[startIdx];
      }

      const fallbackSlice = sorted.slice(0, Math.min(sorted.length, jitter));
      const pick = pickRandom(fallbackSlice);
      if (pick !== null && pick !== undefined) {
        return pick;
      }
      return sorted[0];
    };

    for (let windowIdx = 0; windowIdx < windowedAllowedSets.length; windowIdx += 1) {
      const allowedFromWindow = windowedAllowedSets[windowIdx];
      const combinedAllowed =
        allowedSet && allowedFromWindow
          ? new Set([...allowedFromWindow].filter((idx) => allowedSet.has(idx)))
          : allowedSet || allowedFromWindow;
    const candidates = gatherCandidates({
      requiredDuration,
      bucketName: chronologicalOrder ? bucket : null,
      pool: filteredPool,
      clipDurations,
      exclude,
      used: usedClipIndices,
      allowed: combinedAllowed,
      // PauseMusic must not widen buckets; non-chrono intentionally bypasses buckets
      forceAllBuckets: !chronologicalOrder,
    });

      const pick = selectCandidate(candidates, selectionTarget);
      if (pick !== null) {
        assignClipToSegment({
          segment,
          clip: filteredPool.clips[pick],
          clipDuration: clipDurations[pick],
          poolIndex: pick,
          useLocalPaths,
        });
        usedClipIndices.add(pick);
        return pick;
      }
    }

    if (!allowSwap) {
      return null;
    }

    for (let donorIdx = 0; donorIdx < segments.length; donorIdx += 1) {
      if (donorIdx === segmentIndex) continue;
      const donorSegment = segments[donorIdx];
      const donorClipIndex = donorSegment.asset?.sourcePoolIndex;
      if (donorClipIndex === undefined || donorClipIndex === null) continue;
      if (needsDialogue && !allowedSet.has(donorClipIndex)) continue;
      const donorDuration = clipDurations[donorClipIndex] ?? 0;
      if (donorDuration < requiredDuration) continue;
      const donorRequired = Math.max(donorSegment.durationSeconds, donorSegment.minSourceDuration || 0);
      if (donorRequired >= donorDuration) continue;

      usedClipIndices.delete(donorClipIndex);
      const newClipForDonor = assignForSegment(donorIdx, {
        exclude: new Set([donorClipIndex]),
        allowSwap: false,
      });
      if (newClipForDonor !== null) {
        swapHistory.push({
          targetSegment: segmentIndex,
          donorSegment: donorIdx,
          swappedClip: donorClipIndex,
        });
        assignClipToSegment({
          segment,
          clip: filteredPool.clips[donorClipIndex],
          clipDuration: clipDurations[donorClipIndex],
          poolIndex: donorClipIndex,
          useLocalPaths,
        });
        usedClipIndices.add(donorClipIndex);
        return donorClipIndex;
      }
      usedClipIndices.add(donorClipIndex);
    }

    return null;
  };

  segments.forEach((_, idx) => {
    const assignedClip = assignForSegment(idx);
    if (assignedClip === null) {
      throw new Error(`Unable to select clip for segment ${idx} (${segments[idx].type})`);
    }
  });

  return {
    usedClipIndices,
    swapHistory,
  };
};

/**
 * Reselect a single clip for an existing Quick Edit 6 segment.
 *
 * This reuses the same core selection rules as initial assignment:
 * - duration bucket gating (must have enough source duration)
 * - dialogue intent gating (dialogue-tagged clips only)
 * - optional chronological windowing (by pool index)
 * - optional neighbor bounds (pool index min/max) to preserve chronology with adjacent slots
 *
 * NOTE: This does not mutate other segments and does not perform trimming;
 * callers should apply pauseMusic trimming rules separately if needed.
 */
export const reselectQuickEdit6Clip = ({
  segmentIndex,
  segment,
  pool,
  options = {},
  usedPoolIndices = [],
  bounds = {},
}) => {
  if (!segment) {
    throw new Error("segment is required");
  }
  const { chronologicalOrder = false } = options;
  const poolSize = filteredPool?.clips?.length || 0;
  if (!poolSize) {
    throw new Error("Clip pool unavailable");
  }

  const clipDurations = filteredPool.clips.map(getClipDurationSeconds);
  const used = new Set((usedPoolIndices || []).filter((v) => typeof v === "number"));

  // Allow replacing the current assignment
  const currentIdx = segment?.asset?.sourcePoolIndex;
  if (typeof currentIdx === "number") {
    used.delete(currentIdx);
  }

  const requiredDuration = Math.max(segment.durationSeconds, segment.minSourceDuration || 0);
  const bucket = getDurationBucket(requiredDuration);

  const tags = segment?.beatMetadata?.guidelineTags || [];
  const intent = (segment?.beatMetadata?.intent || "").toLowerCase();
  const hasDialogueTag = tags.some((tag) => (tag || "").toLowerCase().includes("dialogue"));
  const needsDialogue = hasDialogueTag || intent === "dialogue";

  const dialogueTagIndices = (() => {
    const fromBuckets = filteredPool?.tagBuckets?.dialogue || [];
    const fromTags = [];
    (filteredPool?.clips || []).forEach((clip, idx) => {
      if (clip?.tags?.some((tag) => (tag || "").toLowerCase().includes("dialogue"))) {
        fromTags.push(idx);
      }
    });
    return Array.from(new Set([...fromBuckets, ...fromTags]));
  })();
  const dialogueAllowed = new Set(dialogueTagIndices);
  const allowedSet = needsDialogue ? dialogueAllowed : null;

  const totalSegments = typeof options.totalSegments === "number" ? options.totalSegments : null;
  const chronologicalWindowSize =
    chronologicalOrder && poolSize && totalSegments
      ? Math.max(15, Math.floor(poolSize / Math.max(totalSegments, 1)) + 5)
      : 0;
  const selectionTarget =
    chronologicalOrder && poolSize && totalSegments
      ? Math.floor(((segmentIndex || 0) / Math.max(totalSegments - 1, 1)) * Math.max(poolSize - 1, 0))
      : null;

  const minPoolIndex = typeof bounds.minPoolIndex === "number" ? bounds.minPoolIndex : null;
  const maxPoolIndex = typeof bounds.maxPoolIndex === "number" ? bounds.maxPoolIndex : null;

  const buildAllowedWindows = () => {
    if (!chronologicalOrder || poolSize === 0) {
      return [null];
    }
    const windows = [];
    const pushWindow = (start, end) => {
      const normalizedStart = Math.max(0, Math.min(poolSize - 1, Math.floor(start)));
      const normalizedEnd = Math.max(normalizedStart + 1, Math.min(poolSize, Math.floor(end)));
      const key = `${normalizedStart}:${normalizedEnd}`;
      if (!windows.some((win) => win && `${win.start}:${win.end}` === key)) {
        windows.push({ start: normalizedStart, end: normalizedEnd });
      }
    };
    pushWindow(selectionTarget, selectionTarget + chronologicalWindowSize);
    pushWindow(
      Math.max(0, selectionTarget - Math.floor(chronologicalWindowSize / 2)),
      selectionTarget + Math.floor(chronologicalWindowSize / 2)
    );
    pushWindow(
      Math.max(0, selectionTarget - chronologicalWindowSize),
      selectionTarget + chronologicalWindowSize * 2
    );
    windows.push(null);
    return windows;
  };

  const windowedAllowedSets = buildAllowedWindows().map((window) => {
    if (!window) return null;
    const windowSet = new Set();
    for (let idx = window.start; idx < window.end && idx < poolSize; idx += 1) {
      windowSet.add(idx);
    }
    return windowSet;
  });

  const selectCandidate = (candidates, targetStart) => {
    if (!candidates.length) return null;
    if (!chronologicalOrder) {
      return pickRandom(candidates);
    }
    const sorted = [...candidates].sort((a, b) => a - b);
    const jitter = Math.max(3, Math.floor(chronologicalWindowSize / 5));
    const startIdx = typeof targetStart === "number" ? sorted.findIndex((idx) => idx >= targetStart) : -1;
    if (startIdx >= 0) {
      const end = Math.min(sorted.length, startIdx + jitter);
      const windowSlice = sorted.slice(startIdx, end);
      const pick = pickRandom(windowSlice);
      if (pick !== null && pick !== undefined) {
        return pick;
      }
      return sorted[startIdx];
    }
    const fallbackSlice = sorted.slice(0, Math.min(sorted.length, jitter));
    const pick = pickRandom(fallbackSlice);
    if (pick !== null && pick !== undefined) {
      return pick;
    }
    return sorted[0];
  };

  const boundFilter = (idx) => {
    if (minPoolIndex !== null && idx < minPoolIndex) return false;
    if (maxPoolIndex !== null && idx >= maxPoolIndex) return false;
    return true;
  };

  for (let windowIdx = 0; windowIdx < windowedAllowedSets.length; windowIdx += 1) {
    const allowedFromWindow = windowedAllowedSets[windowIdx];
    let combinedAllowed =
      allowedSet && allowedFromWindow
        ? new Set([...allowedFromWindow].filter((idx) => allowedSet.has(idx)))
        : allowedSet || allowedFromWindow;

    if (combinedAllowed) {
      combinedAllowed = new Set([...combinedAllowed].filter(boundFilter));
    }

    const candidates = gatherCandidates({
      requiredDuration,
      bucketName: bucket,
      pool: filteredPool,
      clipDurations,
      exclude: new Set(),
      used,
      allowed: combinedAllowed,
      forceAllBuckets: false,
    }).filter(boundFilter);

    const pick = selectCandidate(candidates, selectionTarget);
    if (pick !== null && pick !== undefined) {
      const clip = filteredPool.clips[pick];
      const clipDuration = clipDurations[pick] ?? 0;
      return {
        poolIndex: pick,
        clip,
        clipDuration,
      };
    }
  }

  throw new Error("No valid replacement clip found for segment");
};

export const trimQuickEdit6Segments = ({ segments, fps }) => {
  let totalFrames = 0;
  segments.forEach((segment) => {
    const asset = segment.asset;
    if (!asset) {
      throw new Error(`Segment ${segment.index} missing asset`);
    }
    const effectiveFps = segment.fps || fps || 30;
    const minDuration = 1 / effectiveFps;
    const available = Number(asset.availableDuration) || 0;
    const isRapid = segment.type === "rapid";
    const pauseMusic = isRapid
      ? Boolean(segment.rapidClipSlot?.pauseMusic)
      : Boolean(segment.beatMetadata?.clipSlot?.pauseMusic);

    // Respect the frame-accurate segment duration; do NOT stretch rapid clips
    // to the full source length or the rapid cadence is lost.
    let duration = Math.max(Number(segment.durationSeconds) || 0, minDuration);
    const shouldStretchToAvailable = !isRapid && pauseMusic && available > duration;
    if (shouldStretchToAvailable) {
      duration = available;
    }

    segment.durationSeconds = duration;
    segment.minSourceDuration = Math.max(segment.minSourceDuration || 0, duration);

    segment.asset.end = asset.start + duration;
    if (duration > available) {
      throw new Error(
        `Segment ${segment.index} requires ${duration.toFixed(3)}s but clip provides ${available.toFixed(3)}s`
      );
    }

    const frameCount = Math.max(1, Math.round(duration * effectiveFps));
    segment.frameCount = frameCount;
    if (Number.isFinite(segment.startFrame)) {
      segment.endFrame = segment.startFrame + frameCount;
    }
    if (Number.isFinite(segment.startSeconds)) {
      segment.endSeconds = segment.startSeconds + duration;
    } else if (Number.isFinite(segment.startFrame)) {
      segment.startSeconds = segment.startFrame / effectiveFps;
      segment.endSeconds = segment.endFrame / effectiveFps;
    }

    totalFrames += frameCount;
  });
  return { totalFrames };
};

export const loadQuickEdit6Format = (songSlug) => {
  if (!songSlug) {
    throw new Error("songSlug is required");
  }
  return loadSongFormat6(songSlug);
};

export const buildQuickEdit6Segments = (format) => {
  if (!format) {
    throw new Error("format is required");
  }
  const { segments, fps, totalFrames, stats } = calculateFrameAccurateSegments(format);
  const baseLayer = (format.layers || []).find(
    (layer) => layer?.type === "base" && Array.isArray(layer.frameSegments) && layer.frameSegments.length
  );

  const deriveFromLayer = () => {
    if (!baseLayer) return null;
    const layerSegments = baseLayer.frameSegments.map((seg, idx) => {
      const startSeconds =
        typeof seg.startSeconds === "number"
          ? seg.startSeconds
          : typeof seg.startMs === "number"
          ? seg.startMs / 1000
          : 0;
      const endSecondsRaw =
        typeof seg.endSeconds === "number"
          ? seg.endSeconds
          : typeof seg.endMs === "number"
          ? seg.endMs / 1000
          : null;
      const startFrame =
        typeof seg.startFrame === "number" ? seg.startFrame : secondsToFrame(startSeconds, fps);
      const frameCountCandidate =
        typeof seg.frameCount === "number" ? seg.frameCount : undefined;
      const endFrame =
        typeof seg.endFrame === "number"
          ? seg.endFrame
          : frameCountCandidate
          ? startFrame + frameCountCandidate
          : typeof endSecondsRaw === "number"
          ? secondsToFrame(endSecondsRaw, fps)
          : startFrame;
      const frameCount = Math.max(1, frameCountCandidate ?? endFrame - startFrame);
      const endSeconds =
        typeof endSecondsRaw === "number" ? endSecondsRaw : frameToSeconds(endFrame, fps);
      const durationSeconds =
        typeof seg.durationSeconds === "number"
          ? seg.durationSeconds
          : Math.max(endSeconds - startSeconds, frameCount / fps);

      return {
        ...seg,
        index: typeof seg.index === "number" ? seg.index : idx,
        type: "beat",
        startFrame,
        endFrame,
        frameCount,
        startSeconds,
        endSeconds,
        durationSeconds,
        minSourceDuration: durationSeconds,
        beatWindowSeconds: durationSeconds,
        beatFrameCount: frameCount,
        fps,
      };
    });

    const derivedTotalFrames = layerSegments.reduce(
      (max, seg) => Math.max(max, seg.endFrame || seg.startFrame + seg.frameCount),
      0
    );
    const derivedStats = getEditPlanStats({
      segments: layerSegments,
      fps,
      totalFrames: derivedTotalFrames,
    });

    return { segments: layerSegments, totalFrames: derivedTotalFrames, stats: derivedStats };
  };

  // If no beat/rapid marks exist but FBv2 layer frameSegments are present, prefer them.
  const shouldUseLayerSegments =
    (!Array.isArray(format.beatGrid) || format.beatGrid.length === 0) &&
    (!Array.isArray(format.rapidClipRanges) || format.rapidClipRanges.length === 0);
  const layerDerived = shouldUseLayerSegments ? deriveFromLayer() : null;

  if (layerDerived) {
    return { segments: layerDerived.segments, fps, totalFrames: layerDerived.totalFrames, stats: layerDerived.stats };
  }
  const normalizedBeatMetadata = normalizeBeatMetadata(format.beatGrid || [], format.beatMetadata || []);
  const introBeat = normalizeIntroBeat(format.introBeat);
  const beatMetaByKey = new Map(
    normalizedBeatMetadata.map((entry) => [getBeatKey(entry.beatTime), entry])
  );

  const formatDefaults = {
    clipVolume: clampVolume(
      format?.introBeat?.clipSlot?.clipVolume,
      clampVolume(format?.beatMetadata?.[0]?.clipSlot?.clipVolume, RAPID_SAFETY_DEFAULTS.clipVolume)
    ),
    musicVolume: clampVolume(
      format?.introBeat?.clipSlot?.musicVolume,
      clampVolume(format?.beatMetadata?.[0]?.clipSlot?.musicVolume, RAPID_SAFETY_DEFAULTS.musicVolume)
    ),
    pauseMusic: Boolean(format?.introBeat?.clipSlot?.pauseMusic ?? RAPID_SAFETY_DEFAULTS.pauseMusic),
  };

  const rapidRanges = Array.isArray(format?.rapidClipRanges) ? format.rapidClipRanges : [];
  const resolveRapidClipSlot = (segmentStartSeconds) => {
    const time = typeof segmentStartSeconds === "number" ? segmentStartSeconds : null;
    const idx = time === null
      ? -1
      : rapidRanges.findIndex((range) => {
          const start = range?.start;
          const end = range?.end;
          if (typeof start !== "number" || typeof end !== "number") return false;
          // tolerate floating point edges
          return time >= start - 1e-6 && time < end + 1e-6;
        });
    const range = idx >= 0 ? rapidRanges[idx] : null;
    return {
      rapidRangeIndex: idx >= 0 ? idx : null,
      clipSlot: {
        clipVolume: clampVolume(range?.clipVolume, formatDefaults.clipVolume ?? RAPID_SAFETY_DEFAULTS.clipVolume),
        musicVolume: clampVolume(range?.musicVolume, formatDefaults.musicVolume ?? RAPID_SAFETY_DEFAULTS.musicVolume),
        pauseMusic:
          typeof range?.pauseMusic === "boolean"
            ? range.pauseMusic
            : Boolean(formatDefaults.pauseMusic ?? RAPID_SAFETY_DEFAULTS.pauseMusic),
      },
    };
  };

  const normalizedSegments = segments.map((segment) => {
    const normalizedType = segment.type === "segment" ? "beat" : segment.type;
    const beatMeta =
      normalizedType === "intro"
        ? introBeat
        : normalizedType === "beat"
        ? beatMetaByKey.get(getBeatKey(segment.startSeconds)) || null
        : null;
    const base = {
      ...segment,
      type: normalizedType,
      durationSeconds: segment.durationSeconds,
      minSourceDuration: segment.minSourceDuration,
      beatWindowSeconds: segment.durationSeconds,
      beatFrameCount: segment.frameCount,
      fps,
      beatMetadata: beatMeta,
    };

    if (normalizedType === "rapid") {
      const rapid = resolveRapidClipSlot(segment.startSeconds);
      return {
        ...base,
        rapidRangeIndex: rapid.rapidRangeIndex,
        rapidClipSlot: rapid.clipSlot,
      };
    }

    return base;
  });
  const normalizedStats = getEditPlanStats({
    segments: normalizedSegments,
    fps,
    totalFrames,
  });
  return { segments: normalizedSegments, fps, totalFrames, stats: normalizedStats };
};

export const buildQuickEdit6Plan = ({ songSlug, chronologicalOrder = false }) => {
  const format = loadQuickEdit6Format(songSlug);
  const pool = loadInstantClipPool();
  if (!pool?.clips?.length) {
    throw new Error("Instant clip pool not available. Generate data/instantClipPool.json first.");
  }
  const { segments, fps, totalFrames, stats } = buildQuickEdit6Segments(format);
  const filteredPool = filterClipPoolForClips(pool);
  const { usedClipIndices, swapHistory } = assignQuickEdit6Clips({
    segments,
    pool: filteredPool,
    options: { chronologicalOrder },
  });
  const trimResult = trimQuickEdit6Segments({ segments, fps });

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
      ...createClipPoolSummary(filteredPool),
      uniqueClipsUsed: usedClipIndices.size,
      usedClipCount: usedClipIndices.size,
      swapCount: swapHistory.length,
    },
  };

  return plan;
};

export default {
  buildQuickEdit6Plan,
  loadQuickEdit6Format,
  buildQuickEdit6Segments,
  assignQuickEdit6Clips,
  trimQuickEdit6Segments,
};

