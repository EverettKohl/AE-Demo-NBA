import fs from "fs";
import path from "path";
import {
  getDurationBucket,
  VIDEO_ID_TO_CLOUDINARY,
  VIDEO_ID_TO_CLOUDINARY_VARIANTS,
  CLOUDINARY_TO_VIDEO_ID,
  CLOUDINARY_VARIANTS,
} from "./songEdit.js";
import {
  loadMovieAnnotationGuidance,
  findAnnotationOverlaps,
  clipOverlapsDisliked,
} from "./movieAnnotation.js";

const POOL_PATH = path.join(process.cwd(), "data", "instantClipPool.json");
const MANIFEST_PATH = path.join(process.cwd(), "data", "killBillMovieManifest.json");

const DEFAULT_DUPLICATE_TOLERANCE = 0.08; // seconds
const DEFAULT_OVERLAP_TOLERANCE = 0.05; // seconds
const DEFAULT_FRAME_RATE = 30;

const formatTwoDigits = (value) => value.toString().padStart(2, "0");

export const formatTimecode = (seconds = 0) => {
  if (Number.isNaN(seconds) || seconds === null || seconds === undefined) {
    return "00:00";
  }
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${formatTwoDigits(minutes)}:${formatTwoDigits(secs)}`;
  }
  return `${formatTwoDigits(minutes)}:${formatTwoDigits(secs)}`;
};

export const parseTimecode = (value) => {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return Number(value) || 0;
  }
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  const segments = trimmed.split(":").map((seg) => Number(seg));
  if (segments.some((seg) => Number.isNaN(seg))) {
    return 0;
  }
  if (segments.length === 3) {
    const [hours, minutes, seconds] = segments;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (segments.length === 2) {
    const [minutes, seconds] = segments;
    return minutes * 60 + seconds;
  }
  return segments[0] || 0;
};

const canonicalizeCloudinaryId = (value) => {
  if (!value || typeof value !== "string") return null;
  return value.replace(/\.mp4$/i, "");
};

const normalizeVariantKey = (variant) => {
  const raw = (variant || "").toString().toLowerCase();
  if (
    raw === CLOUDINARY_VARIANTS.cutout ||
    raw === "background-removed" ||
    raw === "bg-removed" ||
    raw === "cut-out"
  ) {
    return CLOUDINARY_VARIANTS.cutout;
  }
  return CLOUDINARY_VARIANTS.default;
};

const resolveVariantForVideo = (videoId, variant) => {
  const variants = VIDEO_ID_TO_CLOUDINARY_VARIANTS[videoId];
  if (!variants) return null;
  return variants[variant] || variants[CLOUDINARY_VARIANTS.default] || null;
};

const resolveVariantKeyFromClip = (clip = {}, options = {}) => {
  if (options?.variant) return normalizeVariantKey(options.variant);
  if (clip.cloudinaryVariant) return normalizeVariantKey(clip.cloudinaryVariant);
  if (clip.useCutout === true) return CLOUDINARY_VARIANTS.cutout;
  return CLOUDINARY_VARIANTS.default;
};

export const getCloudinaryIdForClip = (clip = {}, options = {}) => {
  const variantKey = resolveVariantKeyFromClip(clip, options);

  // Explicit per-clip variant mapping takes priority
  if (clip.cloudinaryVariants && typeof clip.cloudinaryVariants === "object") {
    const explicit = clip.cloudinaryVariants[variantKey];
    if (explicit) {
      return canonicalizeCloudinaryId(explicit);
    }
  }

  if (variantKey === CLOUDINARY_VARIANTS.cutout && clip.cloudinaryCutoutId) {
    return canonicalizeCloudinaryId(clip.cloudinaryCutoutId);
  }

  if (clip.cloudinaryId) {
    const canonical = canonicalizeCloudinaryId(clip.cloudinaryId);
    if (clip.videoId) {
      const mapped = resolveVariantForVideo(clip.videoId, variantKey);
      if (mapped) return canonicalizeCloudinaryId(mapped);
    }
    if (variantKey === CLOUDINARY_VARIANTS.cutout && canonical) {
      if (canonical.toLowerCase().endsWith("_cutout")) return canonical;
      return canonicalizeCloudinaryId(`${canonical}_CUTOUT`);
    }
    return canonical;
  }

  if (clip.videoId) {
    const mapped = resolveVariantForVideo(clip.videoId, variantKey);
    if (mapped) return canonicalizeCloudinaryId(mapped);
  }

  const fallback = canonicalizeCloudinaryId(clip.filename || clip.source);
  if (variantKey === CLOUDINARY_VARIANTS.cutout && fallback) {
    if (fallback.toLowerCase().endsWith("_cutout")) return fallback;
    return canonicalizeCloudinaryId(`${fallback}_CUTOUT`);
  }
  return fallback;
};

export const getVideoIdForClip = (clip = {}, options = {}) => {
  if (clip.videoId) return clip.videoId;
  const cloudinaryId = getCloudinaryIdForClip(clip, options);
  if (cloudinaryId && CLOUDINARY_TO_VIDEO_ID[cloudinaryId]) {
    return CLOUDINARY_TO_VIDEO_ID[cloudinaryId];
  }
  return null;
};

export const loadClipPoolFromDisk = () => {
  if (!fs.existsSync(POOL_PATH)) {
    throw new Error(`instantClipPool.json not found at ${POOL_PATH}`);
  }
  const content = fs.readFileSync(POOL_PATH, "utf-8");
  return JSON.parse(content);
};

export const saveClipPoolToDisk = (pool) => {
  fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2));
  return pool;
};

export const loadManifest = () => {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`killBillMovieManifest.json not found at ${MANIFEST_PATH}`);
  }
  const content = fs.readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(content);
};

const buildManifestIndex = (manifest) => {
  const parts = manifest?.parts || [];
  const index = new Map();
  parts.forEach((part, order) => {
    const registerVariant = (cloudinaryId, variant = CLOUDINARY_VARIANTS.default) => {
      const canonical = canonicalizeCloudinaryId(cloudinaryId);
      if (!canonical) return;
      index.set(canonical, {
        ...part,
        canonicalId: canonical,
        variant,
        order,
      });
    };

    // Start with explicit data from the manifest
    const explicitVariants = {
      ...(part.cloudinaryVariants || {}),
    };
    if (part.cloudinaryId && !explicitVariants[CLOUDINARY_VARIANTS.default]) {
      explicitVariants[CLOUDINARY_VARIANTS.default] = part.cloudinaryId;
    }
    if (part.cloudinaryCutoutId && !explicitVariants[CLOUDINARY_VARIANTS.cutout]) {
      explicitVariants[CLOUDINARY_VARIANTS.cutout] = part.cloudinaryCutoutId;
    }
    if (part.filename && !explicitVariants[CLOUDINARY_VARIANTS.default]) {
      explicitVariants[CLOUDINARY_VARIANTS.default] = part.filename;
    }

    Object.entries(explicitVariants).forEach(([variant, cloudinaryId]) =>
      registerVariant(cloudinaryId, normalizeVariantKey(variant))
    );

    // Ensure all known variants for this videoId are present
    const mappedVariants =
      part.videoId && VIDEO_ID_TO_CLOUDINARY_VARIANTS[part.videoId]
        ? VIDEO_ID_TO_CLOUDINARY_VARIANTS[part.videoId]
        : null;
    if (mappedVariants) {
      Object.entries(mappedVariants).forEach(([variant, cloudinaryId]) =>
        registerVariant(cloudinaryId, normalizeVariantKey(variant))
      );
    }
  });
  return index;
};

export const getManifestIndex = () => buildManifestIndex(loadManifest());
export const createManifestIndex = (manifest) => buildManifestIndex(manifest);

const resolveDurationBucket = (durationSeconds, durationBuckets, fallbackBucket) => {
  if (durationBuckets && typeof durationBuckets === "object") {
    for (const [bucket, range] of Object.entries(durationBuckets)) {
      const min = Number(range?.min ?? 0);
      const max = Number(range?.max ?? Number.POSITIVE_INFINITY);
      if (durationSeconds >= min && durationSeconds < max) {
        return bucket;
      }
    }
  }
  if (typeof fallbackBucket === "string") {
    return fallbackBucket;
  }
  return getDurationBucket(durationSeconds);
};

const dedupeStrings = (values = []) => {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
};

export const normalizeClipPayload = (
  clip,
  { durationBuckets, manifestIndex, annotationGuidance = null, fps: optFps = null }
) => {
  if (!clip) {
    throw new Error("Clip payload is required.");
  }
  const hasFrameData =
    Number.isFinite(clip.startFrame) && Number.isFinite(clip.endFrameExclusive);
  const fps =
    Number.isFinite(optFps) && optFps > 0
      ? Number(optFps)
      : Number.isFinite(clip.fps) && clip.fps > 0
      ? Number(clip.fps)
      : Number.isFinite(clip.frameRate) && clip.frameRate > 0
      ? Number(clip.frameRate)
      : DEFAULT_FRAME_RATE;

  const startFrame = hasFrameData ? Math.round(clip.startFrame) : null;
  const endFrameExclusive = hasFrameData ? Math.round(clip.endFrameExclusive) : null;

  if (hasFrameData && !(endFrameExclusive > startFrame)) {
    throw new Error("endFrameExclusive must be greater than startFrame.");
  }

  const startFromFrames = hasFrameData ? startFrame / fps : null;
  const endFromFrames = hasFrameData ? endFrameExclusive / fps : null;

  const start = hasFrameData ? startFromFrames : parseTimecode(clip.start ?? 0);
  const end = hasFrameData ? endFromFrames : parseTimecode(clip.end ?? start);
  const safeEnd = Math.max(end, start);

  const durationSeconds = Number((safeEnd - start).toFixed(3));
  const durationFrames = hasFrameData
    ? endFrameExclusive - startFrame
    : Math.round(durationSeconds * fps);
  const canonicalCloudinaryId = getCloudinaryIdForClip(clip);
  const videoId = getVideoIdForClip({ ...clip, cloudinaryId: canonicalCloudinaryId });
  const bucket = resolveDurationBucket(durationSeconds, durationBuckets, clip.durationBucket);
  const tags = dedupeStrings(clip.tags);
  const songAssociations = dedupeStrings(clip.songAssociations);

  const manifestPart =
    canonicalCloudinaryId && manifestIndex?.get(canonicalCloudinaryId)
      ? manifestIndex.get(canonicalCloudinaryId)
      : null;

  if (!canonicalCloudinaryId) {
    throw new Error("cloudinaryId or videoId is required for clip entries.");
  }

  if (!videoId) {
    throw new Error(`Unable to infer videoId for ${canonicalCloudinaryId}.`);
  }

  if (durationSeconds <= 0) {
    throw new Error("Clip duration must be greater than zero.");
  }

  if (manifestPart) {
    if (start < 0 || safeEnd > manifestPart.durationSeconds + DEFAULT_OVERLAP_TOLERANCE) {
      throw new Error(
        `Clip timing exceeds manifest bounds for ${manifestPart.label}. (${start.toFixed(
          2
        )}-${safeEnd.toFixed(2)}s, allowed <= ${manifestPart.durationSeconds}s)`
      );
    }
  }

  const guidance = annotationGuidance || loadMovieAnnotationGuidance();
  const dislikedOverlap = clipOverlapsDisliked(videoId, start, safeEnd, guidance);
  if (dislikedOverlap) {
    throw new Error(
      `Clip overlaps a disliked annotation (${dislikedOverlap.label || dislikedOverlap.source}).`
    );
  }

  const annotationMatches = findAnnotationOverlaps(videoId, start, safeEnd, guidance);
  const annotationSources = annotationMatches.map((match) => ({
    id: match.id,
    label: match.label,
    type: match.type,
    rating: match.rating,
    source: match.source,
  }));

  if (annotationSources.length) {
    tags.push("annotation");
    annotationMatches.forEach((match) => {
      if (match.type) {
        tags.push(`annotation_${match.type}`);
      }
      if (match.source) {
        tags.push(`annotation_${match.source}`);
      }
    });
  }

  const dialogue =
    clip.dialogue && typeof clip.dialogue === "object"
      ? { ...clip.dialogue }
      : clip.dialogue ?? null;

  if (dialogue && typeof clip.dialogueText === "string") {
    dialogue.text = clip.dialogueText;
  }

  const normalizedTags = dedupeStrings(tags);

  return {
    ...clip,
    id: clip.id,
    videoId,
    cloudinaryId: canonicalCloudinaryId,
    start: Number(start.toFixed(3)),
    end: Number(safeEnd.toFixed(3)),
    duration: durationSeconds,
    startFrame: hasFrameData ? startFrame : undefined,
    endFrameExclusive: hasFrameData ? endFrameExclusive : undefined,
    durationFrames: durationFrames > 0 ? durationFrames : undefined,
    fps,
    durationBucket: bucket,
    cutFreeVerified: Boolean(clip.cutFreeVerified),
    tags: normalizedTags,
    songAssociations,
    notes: typeof clip.notes === "string" ? clip.notes : clip.notes ? String(clip.notes) : "",
    dialogue,
    annotationSources,
  };
};

const sortClipsChronologically = (clips, manifestIndex) => {
  if (!manifestIndex?.size) {
    return [...clips];
  }
  return [...clips].sort((a, b) => {
    const partA = manifestIndex.get(getCloudinaryIdForClip(a))?.order ?? Number.POSITIVE_INFINITY;
    const partB = manifestIndex.get(getCloudinaryIdForClip(b))?.order ?? Number.POSITIVE_INFINITY;
    if (partA !== partB) {
      return partA - partB;
    }
    return (a.start ?? 0) - (b.start ?? 0);
  });
};

const buildDerivedData = (clips, durationBuckets) => {
  const bucketEntries = {};
  const tagBuckets = {};
  const distribution = {
    byVideo: {},
    byCharacter: {},
    byType: {},
    byBucket: {},
    byTag: {},
  };

  clips.forEach((clip, index) => {
    const bucket = clip.durationBucket || resolveDurationBucket(clip.duration || 0, durationBuckets);
    if (!bucketEntries[bucket]) {
      bucketEntries[bucket] = [];
    }
    bucketEntries[bucket].push(index);

    const videoKey = getCloudinaryIdForClip(clip) || clip.videoId || "unknown";
    distribution.byVideo[videoKey] = (distribution.byVideo[videoKey] || 0) + 1;
    if (clip.character) {
      distribution.byCharacter[clip.character] = (distribution.byCharacter[clip.character] || 0) + 1;
    }
    if (clip.sceneType) {
      distribution.byType[clip.sceneType] = (distribution.byType[clip.sceneType] || 0) + 1;
    }
    distribution.byBucket[bucket] = (distribution.byBucket[bucket] || 0) + 1;

    clip.tags?.forEach((tag) => {
      if (!tagBuckets[tag]) {
        tagBuckets[tag] = [];
      }
      tagBuckets[tag].push(index);
      distribution.byTag[tag] = (distribution.byTag[tag] || 0) + 1;
    });
  });

  Object.keys(durationBuckets || {}).forEach((bucket) => {
    if (!bucketEntries[bucket]) {
      bucketEntries[bucket] = [];
    }
  });

  return { bucketEntries, tagBuckets, distribution };
};

const calculateAbsoluteSeconds = (clip, manifestIndex) => {
  const part = manifestIndex.get(getCloudinaryIdForClip(clip));
  if (!part) return clip.start || 0;
  return (part.globalStartSeconds || 0) + (clip.start || 0);
};

const analyzeSourceConflicts = (entries, tolerance = DEFAULT_DUPLICATE_TOLERANCE) => {
  const duplicates = [];
  const overlaps = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      const startDelta = Math.abs((a.clip.start || 0) - (b.clip.start || 0));
      const endDelta = Math.abs((a.clip.end || 0) - (b.clip.end || 0));
      const overlap =
        Math.min(a.clip.end || 0, b.clip.end || 0) - Math.max(a.clip.start || 0, b.clip.start || 0);
      if (startDelta < tolerance && endDelta < tolerance) {
        duplicates.push([a.clip.id, b.clip.id]);
      } else if (overlap > DEFAULT_OVERLAP_TOLERANCE) {
        overlaps.push({
          ids: [a.clip.id, b.clip.id],
          overlapSeconds: overlap,
        });
      }
    }
  }
  return { duplicates, overlaps };
};

export const analyzeClipStatuses = (clips, { manifestIndex, durationBuckets }) => {
  const clipMeta = {};
  const warnings = {
    duplicates: [],
    overlaps: [],
    outOfBounds: [],
    dialogueCoverage: [],
    bucketMismatches: [],
  };

  const sourceMap = new Map();

  clips.forEach((clip) => {
    const canonical = getCloudinaryIdForClip(clip);
    if (!canonical) return;
    if (!sourceMap.has(canonical)) {
      sourceMap.set(canonical, []);
    }
    sourceMap.get(canonical).push({ clip });
  });

  sourceMap.forEach((entries) => {
    entries.sort((a, b) => (a.clip.start || 0) - (b.clip.start || 0));
    const { duplicates, overlaps } = analyzeSourceConflicts(entries);
    warnings.duplicates.push(...duplicates);
    warnings.overlaps.push(...overlaps);
  });

  clips.forEach((clip) => {
    const canonical = getCloudinaryIdForClip(clip);
    const manifestPart = manifestIndex.get(canonical);
    const start = clip.start || 0;
    const end = clip.end || start;
    const duration = clip.duration || Math.max(0, end - start);
    const absSeconds = calculateAbsoluteSeconds(clip, manifestIndex);
    const localTimecode = formatTimecode(start);
    const movieTimecode = formatTimecode(absSeconds);
    const statuses = {
      timeline: "ok",
      dialogue: "ok",
      bucket: "ok",
    };
    const clipWarnings = [];

    if (!manifestPart) {
      statuses.timeline = "unknown";
      clipWarnings.push("Missing manifest mapping");
    } else if (start < 0 || end > manifestPart.durationSeconds + DEFAULT_OVERLAP_TOLERANCE) {
      statuses.timeline = "out_of_bounds";
      clipWarnings.push("Timing exceeds manifest duration");
      warnings.outOfBounds.push({
        clipId: clip.id,
        reason: `Exceeds ${manifestPart.label}`,
      });
    }

    const expectedBucket = resolveDurationBucket(duration, durationBuckets, clip.durationBucket);
    if (clip.durationBucket !== expectedBucket) {
      statuses.bucket = "mismatch";
      warnings.bucketMismatches.push({ clipId: clip.id, expected: expectedBucket, actual: clip.durationBucket });
      clipWarnings.push(`Bucket mismatch (${clip.durationBucket || "unknown"} => ${expectedBucket})`);
    }

    const hasDialogueTag = clip.tags?.includes("dialogue");
    const hasDialogueMeta = Boolean(clip.dialogue);
    if (hasDialogueTag && !hasDialogueMeta) {
      statuses.dialogue = "missing";
      warnings.dialogueCoverage.push({ clipId: clip.id, reason: "Dialogue tag without transcript" });
      clipWarnings.push("Dialogue tag missing transcript metadata");
    }

    clipMeta[clip.id] = {
      id: clip.id,
      canonicalCloudinaryId: canonical,
      manifestPart,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: duration,
      absoluteSeconds: absSeconds,
      timecode: localTimecode,
      movieTimecode,
      statuses,
      warnings: clipWarnings,
    };
  });

  return { clipMeta, warnings };
};

export const rebuildClipPool = ({ basePool, clips, manifestIndex }) => {
  const durationBuckets = basePool.durationBuckets || null;
  const sortedClips = sortClipsChronologically(clips, manifestIndex);
  const derived = buildDerivedData(sortedClips, durationBuckets);
  return {
    ...basePool,
    generatedAt: new Date().toISOString(),
    totalClips: sortedClips.length,
    clips: sortedClips,
    moments: basePool.moments || [],
    buckets: derived.bucketEntries,
    distribution: {
      ...(basePool.distribution || {}),
      ...derived.distribution,
    },
    tagBuckets: derived.tagBuckets,
  };
};

export const computePoolSummary = ({ pool, manifestIndex }) => {
  const clips = pool?.clips || [];
  const durationBuckets = pool?.durationBuckets;
  const { clipMeta, warnings } = analyzeClipStatuses(clips, {
    manifestIndex,
    durationBuckets,
  });
  return {
    clipMeta,
    warnings,
    stats: {
      total: clips.length,
      byType: pool?.distribution?.byType || {},
      byBucket: pool?.distribution?.byBucket || {},
      byTag: pool?.distribution?.byTag || {},
      byCharacter: pool?.distribution?.byCharacter || {},
    },
  };
};

export const generateClipId = (clips) => {
  const numericIds = clips
    .map((clip) => {
      const match = /clip-(\d+)/i.exec(clip.id || "");
      return match ? Number(match[1]) : null;
    })
    .filter((value) => typeof value === "number");
  const maxValue = numericIds.length ? Math.max(...numericIds) : 0;
  return `clip-${String(maxValue + 1).padStart(3, "0")}`;
};

