import fs from "fs";
import path from "path";
import {
  VIDEO_ID_TO_CLOUDINARY,
  CLOUDINARY_TO_VIDEO_ID,
  CLOUDINARY_VARIANTS,
} from "./songEdit.js";

const MOVIE_ANNOTATION_DIR = path.join(process.cwd(), "data", "movie-annotation");
const ICONIC_DIR = path.join(MOVIE_ANNOTATION_DIR, "iconic");
const EVENTS_DIR = path.join(MOVIE_ANNOTATION_DIR, "events");
const LIKES_DIR = path.join(MOVIE_ANNOTATION_DIR, "likes");
const DISLIKES_DIR = path.join(MOVIE_ANNOTATION_DIR, "dislikes");
const CUTOUTS_DIR = path.join(MOVIE_ANNOTATION_DIR, "cutouts");
const CATALOG_PATH = path.join(MOVIE_ANNOTATION_DIR, "clips.json");

export const PART_ID_TO_CLOUDINARY = {
  "part-1-cutout": "Kill_Bill_Vol1_Part1_30FPS",
  "part-2-cutout": "Kill_Bill_Vol1_Part2_30FPS",
  "part-3-cutout": "Kill_Bill_Vol2_Part1_30FPS",
  "part-4-cutout": "Kill_Bill_Vol2_Part2_30FPS",
  "part-5-cutout": "Kill_Bill_Vol2_Part3_30FPS",
  "part-1": "Kill_Bill_Vol1_Part1_30FPS",
  "part-2": "Kill_Bill_Vol1_Part2_30FPS",
  "part-3": "Kill_Bill_Vol2_Part1_30FPS",
  "part-4": "Kill_Bill_Vol2_Part2_30FPS",
  "part-5": "Kill_Bill_Vol2_Part3_30FPS",
};

export const PART_ID_TO_CLOUDINARY_CUTOUT = {
  "part-1": "Kill_Bill_Vol1_Part1_30FPS_CUTOUT",
  "part-1-cutout": "Kill_Bill_Vol1_Part1_30FPS_CUTOUT",
  "part-2": "Kill_Bill_Vol1_Part2_30FPS_CUTOUT",
  "part-2-cutout": "Kill_Bill_Vol1_Part2_30FPS_CUTOUT",
  "part-3": "Kill_Bill_Vol2_Part1_30FPS_CUTOUT",
  "part-3-cutout": "Kill_Bill_Vol2_Part1_30FPS_CUTOUT",
  "part-4": "Kill_Bill_Vol2_Part2_30FPS_CUTOUT",
  "part-4-cutout": "Kill_Bill_Vol2_Part2_30FPS_CUTOUT",
  "part-5": "Kill_Bill_Vol2_Part3_30FPS_CUTOUT",
  "part-5-cutout": "Kill_Bill_Vol2_Part3_30FPS_CUTOUT",
};

// Canonical frame rate for the project (used as fallback).
const DEFAULT_FRAME_RATE = 30;
const MIN_RANGE_SECONDS = 0.3;
const DEFAULT_EVENT_DURATION = 0.75;
const OVERLAP_TOLERANCE = 0.05;

let annotationCache = null;

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[movieAnnotation] Failed to read ${filePath}: ${error.message}`);
    return null;
  }
};

const loadCatalogParts = () => {
  const doc = readJsonFile(CATALOG_PATH);
  return doc?.parts || [];
};

const PART_META_MAP = new Map(loadCatalogParts().map((part) => [part.id, part]));

const derivePartIdFromFilename = (filename) => filename.replace(/\.json$/i, "");

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

const frameRateForPart = (partId) =>
  PART_META_MAP.get(partId)?.frameRate || DEFAULT_FRAME_RATE;

const canonicalCloudinaryForPart = (partId, options = {}) => {
  const variantKey = normalizeVariantKey(options.variant);
  const meta = PART_META_MAP.get(partId) || {};
  const variants = meta.cloudinaryVariants || {};
  if (variants[variantKey]) return variants[variantKey];
  if (variantKey === CLOUDINARY_VARIANTS.cutout) {
    if (meta.cloudinaryCutoutId) return meta.cloudinaryCutoutId;
    if (PART_ID_TO_CLOUDINARY_CUTOUT[partId]) return PART_ID_TO_CLOUDINARY_CUTOUT[partId];
  }
  if (meta.cloudinaryId) return meta.cloudinaryId;
  return PART_ID_TO_CLOUDINARY[partId] || null;
};

const videoIdForPart = (partId, options = {}) => {
  const cloudinaryId = canonicalCloudinaryForPart(partId, options);
  if (!cloudinaryId) return null;
  return CLOUDINARY_TO_VIDEO_ID[cloudinaryId] || null;
};

const entryHasDislikeFlag = (entry) => {
  if (!entry || typeof entry !== "object") return false;
  if (entry.disliked === true || entry.isDisliked === true || entry.blocked === true) {
    return true;
  }
  const verdict = (entry.verdict || entry.vote || entry.sentiment || entry.disposition || "")
    .toString()
    .toLowerCase();
  if (verdict === "dislike" || verdict === "disliked" || verdict === "reject") {
    return true;
  }
  const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => tag?.toLowerCase()) : [];
  if (tags.some((tag) => tag === "dislike" || tag === "blocked" || tag === "reject")) {
    return true;
  }
  const reactionList = Array.isArray(entry.reactions)
    ? entry.reactions
    : Array.isArray(entry.feedback)
    ? entry.feedback
    : [];
  if (
    reactionList.some((feedback) =>
      ["dislike", "rejected", "block", "thumbsdown"].includes(
        (feedback?.vote || feedback?.verdict || feedback?.type || "").toLowerCase()
      )
    )
  ) {
    return true;
  }
  if (typeof entry.rating === "number" && entry.rating <= 1) {
    return true;
  }
  return false;
};

const secondsFromEntry = (entry, partId, prefix, fallbackDuration = DEFAULT_EVENT_DURATION) => {
  if (!entry) return null;
  const msField = `${prefix}Ms`;
  const secondsField = `${prefix}Seconds`;
  const frameField = `${prefix}Frame`;
  // Common alternative fields from likes/dislikes
  const altMsFields = ["ms", "timecodeMs", "timeMs"];
  const altSecondsFields = ["timecode", "timeSeconds", "time"];

  if (typeof entry[msField] === "number") {
    return entry[msField] / 1000;
  }
  if (typeof entry[secondsField] === "number") {
    return entry[secondsField];
  }
  for (const alt of altMsFields) {
    if (typeof entry[alt] === "number") {
      return entry[alt] / 1000;
    }
  }
  for (const alt of altSecondsFields) {
    if (typeof entry[alt] === "number") {
      return entry[alt];
    }
  }
  if (typeof entry[frameField] === "number") {
    const frameRate = frameRateForPart(partId);
    return entry[frameField] / Math.max(frameRate, 0.001);
  }
  if (prefix === "end") {
    const start = secondsFromEntry(entry, partId, "start", fallbackDuration);
    if (start == null) return null;
    return start + fallbackDuration;
  }
  return null;
};

const normalizeRange = (entry, partId, source) => {
  const startSeconds = secondsFromEntry(entry, partId, "start");
  if (!Number.isFinite(startSeconds)) {
    return null;
  }
  let endSeconds = secondsFromEntry(entry, partId, "end");
  if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    endSeconds = startSeconds + DEFAULT_EVENT_DURATION;
  }
  const safeEnd = Math.max(startSeconds + MIN_RANGE_SECONDS, endSeconds);
  const cloudinaryId = entry.cloudinaryId || canonicalCloudinaryForPart(partId);
  const videoId =
    entry.videoId ||
    CLOUDINARY_TO_VIDEO_ID[cloudinaryId] ||
    videoIdForPart(partId) ||
    null;
  return {
    id: entry.id || `${source}-${partId}-${startSeconds.toFixed(3)}`,
    source,
    partId,
    cloudinaryId: cloudinaryId || null,
    videoId,
    startSeconds,
    endSeconds: safeEnd,
    type: entry.type || entry.category || null,
    label: entry.label || entry.title || "",
    rating: typeof entry.rating === "number" ? entry.rating : null,
    characters: entry.charactersOnScreen || entry.characters || [],
    speaker: entry.speaker || null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    notes: entry.notes || "",
    verdict:
      (entry.verdict ||
        entry.vote ||
        entry.sentiment ||
        entry.disposition ||
        "").toLowerCase() || null,
    dislikeFeedback: entry.feedback || entry.reactions || entry.dislikes || null,
    isDisliked: entryHasDislikeFlag(entry),
  };
};

const loadEntriesFromDir = (dirPath, key) => {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const partId = derivePartIdFromFilename(file);
      const doc = readJsonFile(path.join(dirPath, file));
      if (!doc) return [];
      const collection = doc[key] || doc.entries || [];
      return collection
        .map((entry) => normalizeRange(entry, doc.partId || partId, key === "events" ? "event" : "iconic"))
        .filter(Boolean);
    });
};

const normalizeLikeEntry = (entry, partId) => {
  const startSeconds =
    secondsFromEntry(entry, partId, "start") ??
    secondsFromEntry(entry, partId, "time", DEFAULT_EVENT_DURATION);
  const endSeconds =
    secondsFromEntry(entry, partId, "end") ??
    ((startSeconds ?? 0) + DEFAULT_EVENT_DURATION);
  const safeStart = Number.isFinite(startSeconds) ? startSeconds : 0;
  const safeEnd = Math.max(safeStart + MIN_RANGE_SECONDS, Number.isFinite(endSeconds) ? endSeconds : safeStart + DEFAULT_EVENT_DURATION);
  return {
    id: entry.id || `like-${partId}-${startSeconds.toFixed(3)}`,
    source: "like",
    partId,
    cloudinaryId: entry.cloudinaryId || canonicalCloudinaryForPart(partId),
    videoId: entry.videoId || videoIdForPart(partId),
    startSeconds: safeStart,
    endSeconds: safeEnd,
    rating: typeof entry.rating === "number" ? entry.rating : null,
    characters: Array.isArray(entry.characters) ? entry.characters : [],
    tags: [
      ...(Array.isArray(entry.emotions) ? entry.emotions : []),
      ...(Array.isArray(entry.purposes) ? entry.purposes : []),
      ...(Array.isArray(entry.tags) ? entry.tags : []),
    ].filter(Boolean),
    label: entry.label || entry.reason || "Like",
    type: entry.reason || null,
    verdict: null,
    isDisliked: false,
  };
};

const normalizeDislikeEntry = (entry, partId) => {
  const startSeconds =
    secondsFromEntry(entry, partId, "start") ??
    secondsFromEntry(entry, partId, "time", DEFAULT_EVENT_DURATION);
  const endSeconds =
    secondsFromEntry(entry, partId, "end") ??
    ((startSeconds ?? 0) + (entry.kind === "range" ? DEFAULT_EVENT_DURATION : DEFAULT_EVENT_DURATION));
  const safeStart = Number.isFinite(startSeconds) ? startSeconds : 0;
  const safeEnd = Math.max(safeStart + MIN_RANGE_SECONDS, Number.isFinite(endSeconds) ? endSeconds : safeStart + DEFAULT_EVENT_DURATION);
  return {
    id: entry.id || `dislike-${partId}-${startSeconds.toFixed(3)}`,
    source: "dislike",
    partId,
    cloudinaryId: entry.cloudinaryId || canonicalCloudinaryForPart(partId),
    videoId: entry.videoId || videoIdForPart(partId),
    startSeconds: safeStart,
    endSeconds: safeEnd,
    label: entry.label || entry.reason || "Dislike",
    type: entry.reason || "dislike",
    rating: entry.rating || null,
    characters: Array.isArray(entry.characters) ? entry.characters : [],
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    verdict: "dislike",
    isDisliked: true,
  };
};

const loadLikes = () => {
  if (!fs.existsSync(LIKES_DIR)) return [];
  return fs
    .readdirSync(LIKES_DIR)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const doc = readJsonFile(path.join(LIKES_DIR, file));
      if (!doc) return [];
      const partId = doc.partId || derivePartIdFromFilename(file);
      const entries = Array.isArray(doc.entries) ? doc.entries : [];
      return entries.map((entry) => normalizeLikeEntry(entry, partId)).filter(Boolean);
    });
};

const loadDislikes = () => {
  if (!fs.existsSync(DISLIKES_DIR)) return [];
  return fs
    .readdirSync(DISLIKES_DIR)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const doc = readJsonFile(path.join(DISLIKES_DIR, file));
      if (!doc) return [];
      const partId = doc.partId || derivePartIdFromFilename(file);
      const entries = Array.isArray(doc.entries) ? doc.entries : [];
      return entries.map((entry) => normalizeDislikeEntry(entry, partId)).filter(Boolean);
    });
};

const loadCutouts = () => {
  if (!fs.existsSync(CUTOUTS_DIR)) return [];
  return fs
    .readdirSync(CUTOUTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const doc = readJsonFile(path.join(CUTOUTS_DIR, file));
      if (!doc) return [];
      const partId = doc.partId || derivePartIdFromFilename(file);
      const entries = Array.isArray(doc.entries) ? doc.entries : [];
      return entries
        .map((entry) => {
          const frameRate = frameRateForPart(partId);
          const startSeconds =
            secondsFromEntry(entry, partId, "start") ??
            (typeof entry.clipStartSeconds === "number" ? entry.clipStartSeconds : null) ??
            (typeof entry.frame === "number" ? entry.frame / Math.max(frameRate, 0.001) : null);
          const endSeconds =
            secondsFromEntry(entry, partId, "end") ??
            (typeof entry.clipEndSeconds === "number" ? entry.clipEndSeconds : null) ??
            (typeof entry.frameEnd === "number" ? entry.frameEnd / Math.max(frameRate, 0.001) : null) ??
            ((startSeconds ?? 0) + DEFAULT_EVENT_DURATION);
          if (!Number.isFinite(startSeconds)) return null;
          const safeEnd = Math.max(
            (Number.isFinite(endSeconds) ? endSeconds : startSeconds + DEFAULT_EVENT_DURATION),
            startSeconds + MIN_RANGE_SECONDS
          );
          const cloudinaryId = entry.cloudinaryId || canonicalCloudinaryForPart(partId);
          return {
            id: entry.id || `cutout-${partId}-${startSeconds.toFixed(3)}`,
            source: "cutout",
            partId,
            cloudinaryId,
            videoId: entry.videoId || videoIdForPart(partId),
            startSeconds,
            endSeconds: safeEnd,
            tags: ["cutout", ...(Array.isArray(entry.tags) ? entry.tags : [])],
            isDisliked: false,
          };
        })
        .filter(Boolean);
    });
};

const buildGuidance = () => {
  const highlights = [
    ...loadEntriesFromDir(ICONIC_DIR, "entries"),
    ...loadEntriesFromDir(EVENTS_DIR, "events"),
    ...loadLikes(),
    ...loadCutouts(),
  ].filter((entry) => entry && entry.videoId);

  const dislikedRanges = [
    ...highlights
      .filter((entry) => entry.isDisliked)
      .map((entry) => ({
        id: `dislike-${entry.id}`,
        videoId: entry.videoId,
        cloudinaryId: entry.cloudinaryId,
        startSeconds: entry.startSeconds,
        endSeconds: entry.endSeconds,
        label: entry.label || entry.type || "disliked",
        source: entry.source,
      })),
    ...loadDislikes().map((entry) => ({
      id: entry.id,
      videoId: entry.videoId,
      cloudinaryId: entry.cloudinaryId,
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      label: entry.label || entry.type || "disliked",
      source: entry.source,
    })),
  ];

  return {
    highlights,
    dislikedRanges,
  };
};

export const loadMovieAnnotationGuidance = ({ forceReload = false } = {}) => {
  if (!annotationCache || forceReload) {
    annotationCache = buildGuidance();
  }
  return annotationCache;
};

const rangesOverlap = (aStart, aEnd, bStart, bEnd, tolerance = OVERLAP_TOLERANCE) => {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > tolerance;
};

export const findAnnotationOverlaps = (
  videoId,
  startSeconds,
  endSeconds,
  guidance = loadMovieAnnotationGuidance()
) => {
  if (!videoId || !guidance?.highlights?.length) {
    return [];
  }
  return guidance.highlights.filter(
    (entry) =>
      entry.videoId === videoId &&
      rangesOverlap(entry.startSeconds, entry.endSeconds, startSeconds, endSeconds)
  );
};

export const clipOverlapsDisliked = (
  videoId,
  startSeconds,
  endSeconds,
  guidance = loadMovieAnnotationGuidance()
) => {
  if (!videoId || !guidance?.dislikedRanges?.length) {
    return null;
  }
  return (
    guidance.dislikedRanges.find(
      (range) =>
        range.videoId === videoId &&
        rangesOverlap(range.startSeconds, range.endSeconds, startSeconds, endSeconds)
    ) || null
  );
};

