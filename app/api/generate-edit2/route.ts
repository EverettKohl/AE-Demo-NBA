import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { loadInstantClipPool } from "@/lib/songEdit";
import { publicSongTracks } from "@/app/editor3/reactvideoeditor/adaptors/default-audio-adaptors";

export const runtime = "nodejs";

type FormatFile = {
  meta?: { fps?: number; aspectRatio?: string | null };
  timeline?: { overlays?: any[] };
};

type ClipPool = {
  clips?: any[];
  buckets?: Record<string, number[]>;
  durationBuckets?: Record<string, { min: number; max: number }>;
};

type CutoutPoolClip = {
  id: string;
  cloudinaryId?: string;
  start?: number;
  end?: number;
  cutoutImage?: boolean;
  meta?: {
    cutoutImageMap?: {
      processedAssetId?: string;
      frame?: number;
      frameRate?: number;
      frameSeconds?: number;
      clipStartSeconds?: number;
      clipEndSeconds?: number;
      cloudinaryId?: string;
      videoId?: string;
    };
  };
};

const FORMAT_DIR = path.join(process.cwd(), "data", "format-editor3");
const CUTOUT_POOL_PATH = path.join(process.cwd(), "data", "instantClipPool2.json");
const GENERATE2_POOL_PATH = path.join(process.cwd(), "data", "AllClips2.json");
const FALLBACK_FPS = 30;
const PRIORITY_FORMAT_SLUGS = ["touch_the_sky"];
const BUCKET_SEQUENCE = [
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

const toNumber = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const frameToTime = (frames: number, fps: number) => Math.max(0, toNumber(frames, 0) / Math.max(1, fps));

const normalizeSlug = (slug: string) => slug.replace(/\.[^/.]+$/, "");

const listFormatFiles = async (): Promise<{ slug: string; name: string }[]> => {
  const files = await fs.readdir(FORMAT_DIR);
  return files
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => {
      const slug = normalizeSlug(f);
      return { slug, name: slug };
    })
    .sort((a, b) => {
      const aIdx = PRIORITY_FORMAT_SLUGS.indexOf(a.slug);
      const bIdx = PRIORITY_FORMAT_SLUGS.indexOf(b.slug);
      // Force prioritized formats to the front, preserving their listed order.
      if (aIdx !== -1 && bIdx === -1) return -1;
      if (aIdx === -1 && bIdx !== -1) return 1;
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      return a.slug.localeCompare(b.slug);
    });
};

const loadFormat = async (slug: string): Promise<FormatFile> => {
  const filename = slug.toLowerCase().endsWith(".json") ? slug : `${slug}.json`;
  const filePath = path.join(FORMAT_DIR, filename);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const loadCutoutPool = async (): Promise<{ clips: CutoutPoolClip[] }> => {
  const raw = await fs.readFile(CUTOUT_POOL_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const clips = Array.isArray(parsed?.clips) ? parsed.clips : [];
  return { clips };
};

let generate2PoolCache: ClipPool | null = null;
const loadGenerate2ClipPool = async (): Promise<ClipPool | null> => {
  if (generate2PoolCache) return generate2PoolCache;

  try {
    const raw = await fs.readFile(GENERATE2_POOL_PATH, "utf8");
    generate2PoolCache = JSON.parse(raw);
    return generate2PoolCache;
  } catch (error: any) {
    console.warn(
      `[generate-edit2] Falling back to instantClipPool.json because AllClips2.json could not be loaded: ${error?.message}`
    );
  }

  const fallbackPool = (await loadInstantClipPool()) as ClipPool | null;
  generate2PoolCache = fallbackPool;
  return fallbackPool;
};

const getDurationSeconds = (clip: any) => {
  if (!clip) return 0;
  if (typeof clip.duration === "number") return clip.duration;
  const start = typeof clip.start === "number" ? clip.start : 0;
  const end = typeof clip.end === "number" ? clip.end : start;
  return Math.max(0, end - start);
};

const resolveBucket = (durationSec: number, pool: ClipPool) => {
  if (!pool?.durationBuckets) return BUCKET_SEQUENCE[0];
  const entries = Object.entries(pool.durationBuckets);
  const found = entries.find(([, range]) => durationSec >= range.min && durationSec <= range.max);
  if (found) return found[0];
  // clamp up
  for (const [name, range] of entries) {
    if (durationSec <= range.max) return name;
  }
  return BUCKET_SEQUENCE[BUCKET_SEQUENCE.length - 1];
};

const buildClipSelector = (pool: ClipPool, chronologicalOrder: boolean, intentTag?: string | null, sharedUsed?: Set<string | number>) => {
  const clips = Array.isArray(pool?.clips) ? pool.clips : [];
  const clipDurations = clips.map(getDurationSeconds);
  const used = sharedUsed ?? new Set<number>();
  const orderedIndices = clips.map((_, idx) => idx);
  let chronoPtr = 0;

  const hasIntent = (idx: number) => {
    if (!intentTag) return true;
    const clip = clips[idx] || {};
    const tags: string[] = Array.isArray((clip as any).tags) ? (clip as any).tags : [];
    const metaTags: string[] = Array.isArray((clip as any)?.meta?.tags) ? (clip as any).meta.tags : [];
    const normalized = [...tags, ...metaTags].map((t) => `${t}`.toLowerCase());
    if (!normalized.length) return true; // Dataset lacks tags; ignore intent filter
    return normalized.includes(intentTag.toLowerCase());
  };

  const findCandidates = (durationSec: number) => {
    const bucket = resolveBucket(durationSec, pool);
    let candidates: number[] = [];
    const bucketIdx = BUCKET_SEQUENCE.indexOf(bucket);
    const bucketsToTry =
      bucketIdx >= 0 ? BUCKET_SEQUENCE.slice(bucketIdx) : [...BUCKET_SEQUENCE];
    const pushIfEligible = (idx: number) => {
      if (used.has(idx)) return;
      if ((clipDurations[idx] ?? 0) < durationSec) return;
      if (!hasIntent(idx)) return;
      candidates.push(idx);
    };
    for (const b of bucketsToTry) {
      const indices = pool?.buckets?.[b] || [];
      indices.forEach(pushIfEligible);
      if (candidates.length) break;
    }
    if (!candidates.length) {
      clips.forEach((_, idx) => {
        if (used.has(idx)) return;
        if ((clipDurations[idx] ?? 0) >= durationSec && hasIntent(idx)) candidates.push(idx);
      });
    }
    // Prefer the shortest clip that fits the duration.
    candidates = candidates.sort((a, b) => (clipDurations[a] ?? Infinity) - (clipDurations[b] ?? Infinity));
    return candidates;
  };

  const pick = (durationSec: number) => {
    const candidates = findCandidates(durationSec);
    if (!candidates.length) return null;
    let chosenIdx: number | null = null;
    if (chronologicalOrder) {
      for (let i = 0; i < orderedIndices.length; i++) {
        const idx = orderedIndices[(chronoPtr + i) % orderedIndices.length];
        if (used.has(idx)) continue;
        if ((clipDurations[idx] ?? 0) < durationSec) continue;
        if (intentTag && !hasIntent(idx)) continue;
        chosenIdx = idx;
        chronoPtr = (idx + 1) % orderedIndices.length;
        break;
      }
      if (chosenIdx === null) chosenIdx = candidates[0];
    } else {
      const rand = Math.floor(Math.random() * candidates.length);
      chosenIdx = candidates[rand] ?? candidates[0];
    }
    used.add(chosenIdx);
    return clips[chosenIdx] || null;
  };

  return pick;
};

const resolveCloudName = () =>
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || null;

const buildClipUrl = (
  clip: any,
  durationSec: number,
  opts: { forceStart?: number; cacheBust?: string } = {}
) => {
  const cloudName = resolveCloudName();
  if (!cloudName) return null;
  const start = typeof opts.forceStart === "number" ? opts.forceStart : clip.start ?? 0;
  const id = clip.cloudinaryId || clip.videoId || clip.id;
  if (!id) return null;
  const transformation = `so_${Math.max(0, start).toFixed(3)},du_${Math.max(durationSec, 0.033).toFixed(
    3
  )},f_mp4,vc_auto`;
  const base = `https://res.cloudinary.com/${cloudName}/video/upload/${transformation}/${id}.mp4`;
  if (opts.cacheBust) {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}ts=${opts.cacheBust}`;
  }
  return base;
};

const buildCutoutPair = (
  clips: CutoutPoolClip[],
  requiredDuration: number,
  cacheBust?: string
): { imageUrl: string; videoUrl: string; clipId: string; videoDuration: number } | null => {
  const cloudName = resolveCloudName();
  if (!cloudName) return null;
  const eligible = clips.filter((clip) => {
    if (!clip.cutoutImage) return false;
    const map = clip.meta?.cutoutImageMap;
    if (!map?.processedAssetId || !(map.cloudinaryId || clip.cloudinaryId)) return false;
    const start =
      typeof map.frameSeconds === "number"
        ? map.frameSeconds
        : typeof map.frame === "number" && typeof map.frameRate === "number" && map.frameRate > 0
        ? map.frame / map.frameRate
        : clip.start ?? 0;
    const end =
      map.clipEndSeconds ??
      clip.end ??
      (clip.start ?? start) + 1;
    const dur = Math.max(0, end - start);
    return dur >= requiredDuration;
  });
  if (!eligible.length) return null;
  const choice = eligible[Math.floor(Math.random() * eligible.length)];
  const map = choice.meta!.cutoutImageMap!;
  const start =
    typeof map.frameSeconds === "number"
      ? map.frameSeconds
      : typeof map.frame === "number" && typeof map.frameRate === "number" && map.frameRate > 0
      ? map.frame / map.frameRate
      : choice.start ?? 0;
  const end =
    map.clipEndSeconds ??
    choice.end ??
    (choice.start ?? start) + Math.max(requiredDuration, 1);
  const videoDuration = Math.max(requiredDuration, end - start);
  let imageUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${map.processedAssetId}.png`;
  if (cacheBust) {
    const sep = imageUrl.includes("?") ? "&" : "?";
    imageUrl = `${imageUrl}${sep}ts=${cacheBust}`;
  }
  const videoUrl = buildClipUrl(
    { cloudinaryId: map.cloudinaryId || choice.cloudinaryId || choice.id, start },
    videoDuration,
    { forceStart: start, cacheBust }
  );
  if (!videoUrl) return null;
  return { imageUrl, videoUrl, clipId: choice.id, videoDuration };
};

const normalizeTextOverlay = (overlay: any, fps: number, id: number) => {
  const durationInFrames = Math.max(1, toNumber(overlay.durationInFrames, 1));
  const pauseMusic = Boolean(overlay.pauseMusic);
  const intent = overlay.intent ?? null;
  const pauseIntent = typeof overlay.pauseIntent === "boolean" ? overlay.pauseIntent : pauseMusic;
  return {
    id,
    type: "text",
    content: overlay.content || "",
    from: toNumber(overlay.from, 0),
    durationInFrames,
    row: toNumber(overlay.row, 0),
    left: toNumber(overlay.left, 0),
    top: toNumber(overlay.top, 0),
    width: toNumber(overlay.width, 1280),
    height: toNumber(overlay.height, 720),
    rotation: toNumber(overlay.rotation, 0),
    isDragging: Boolean(overlay.isDragging),
    pauseMusic,
    intent,
    pauseIntent,
    trackMuted: Boolean(overlay.trackMuted),
    styles: {
      ...(overlay.styles || {}),
      animation: (overlay.styles || {}).animation ?? { enter: "none" },
    },
    meta: {
      ...(overlay.meta || {}),
      pauseMusic,
      intent,
      pauseIntent,
    },
    mediaSrcDuration: durationInFrames / fps,
  };
};

const normalizeVideoOverlay = ({
  overlay,
  id,
  src,
  durationInFrames,
  fps,
  content,
}: {
  overlay: any;
  id: number;
  src: string;
  durationInFrames: number;
  fps: number;
  content: string;
}) => ({
  id,
  type: "video",
  content,
  src,
  from: toNumber(overlay.from, 0),
  durationInFrames,
  row: toNumber(overlay.row, 0),
  left: toNumber(overlay.left, 0),
  top: toNumber(overlay.top, 0),
  width: toNumber(overlay.width, 1280),
  height: toNumber(overlay.height, 720),
  rotation: toNumber(overlay.rotation, 0),
  isDragging: Boolean(overlay.isDragging),
  pauseMusic: Boolean(overlay.pauseMusic),
  intent: overlay.intent ?? null,
  pauseIntent: typeof overlay.pauseIntent === "boolean" ? overlay.pauseIntent : Boolean(overlay.pauseMusic),
  trackMuted: Boolean(overlay.trackMuted),
  videoStartTime: 0,
  mediaSrcDuration: durationInFrames / fps,
  styles: {
    objectFit: overlay.styles?.objectFit ?? "cover",
    objectPosition: overlay.styles?.objectPosition ?? "center center",
    volume: overlay.styles?.volume ?? 1,
    animation: overlay.styles?.animation ?? { enter: "none", exit: "none" },
    opacity: overlay.styles?.opacity ?? 1,
  },
  meta: { ...(overlay.meta || {}), variant: overlay.variant || null, shape: overlay.shape || null },
});

const normalizeImageOverlay = ({
  overlay,
  id,
  src,
  durationInFrames,
}: {
  overlay: any;
  id: number;
  src: string;
  durationInFrames: number;
}) => ({
  id,
  type: "image",
  content: src,
  src,
  from: toNumber(overlay.from, 0),
  durationInFrames,
  row: toNumber(overlay.row, 0),
  left: toNumber(overlay.left, 0),
  top: toNumber(overlay.top, 0),
  width: toNumber(overlay.width, 1280),
  height: toNumber(overlay.height, 720),
  rotation: toNumber(overlay.rotation, 0),
  isDragging: Boolean(overlay.isDragging),
  pauseMusic: Boolean(overlay.pauseMusic),
  intent: overlay.intent ?? null,
  pauseIntent: typeof overlay.pauseIntent === "boolean" ? overlay.pauseIntent : Boolean(overlay.pauseMusic),
  trackMuted: Boolean(overlay.trackMuted),
  styles: {
    ...(overlay.styles || {}),
    // For cutout images, avoid clipping to shapes—drop clipPath/pattern sizing.
    ...(overlay.type === "cutout" && overlay.variant === "image"
      ? { clipPath: undefined, patternSize: undefined, patternColor: undefined }
      : {}),
    objectFit: overlay.styles?.objectFit ?? "cover",
    animation: overlay.styles?.animation ?? { enter: "none", exit: "none" },
  },
  meta: {
    ...(overlay.meta || {}),
    variant: overlay.variant || null,
    shape: overlay.shape || null,
    pauseMusic: Boolean(overlay.pauseMusic),
    intent: overlay.intent ?? null,
    pauseIntent: typeof overlay.pauseIntent === "boolean" ? overlay.pauseIntent : Boolean(overlay.pauseMusic),
  },
});

const resolveSongForFormat = (slug: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(slug);
  const match =
    publicSongTracks.find((track) => {
      const base = norm(track.id.replace(/\.[^/.]+$/, ""));
      return target.includes(base) || base.includes(target);
    }) || publicSongTracks[0] || null;
  return match;
};

const buildGenerateEdit2Project = async ({
  format,
  formatSlug,
  chronologicalOrder,
}: {
  format: FormatFile;
  formatSlug: string;
  chronologicalOrder: boolean;
}) => {
  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fps = toNumber(format?.meta?.fps, FALLBACK_FPS) || FALLBACK_FPS;
  const overlaysRaw = Array.isArray(format?.timeline?.overlays) ? format.timeline.overlays : [];
  const pool = (await loadGenerate2ClipPool()) as ClipPool | null;
  if (!pool) {
    throw new Error("Clip pool unavailable. Populate data/AllClips2.json or instantClipPool.json first.");
  }
  const cutoutPool = await loadCutoutPool();
  const globalUsedClips = new Set<number>();
  const pickClip = buildClipSelector(pool, chronologicalOrder, null, globalUsedClips);
  const leadSeconds = 1;
  const leadFrames = Math.max(0, Math.round(leadSeconds * fps));
  let nextId = 1;
  const videoOverlays: any[] = [];
  const textOverlays: any[] = [];
  const cutoutOverlays: any[] = [];
  const aspectRatio = (format?.meta?.aspectRatio as any) || "16:9";

  overlaysRaw.forEach((ov: any) => {
    if (ov?.type === "text") {
      textOverlays.push(normalizeTextOverlay(ov, fps, nextId++));
      return;
    }
    if (ov?.type === "segment-video") {
      const durationFrames = Math.max(1, toNumber(ov.durationInFrames, 1));
      const requiredSec = durationFrames / fps;
      const intentTag = (ov.intent ?? (ov.meta as any)?.intent ?? "").toString().toLowerCase() || null;
      const pickClipWithIntent = buildClipSelector(pool, chronologicalOrder, intentTag, globalUsedClips);
      const clip = pickClipWithIntent(requiredSec) || pickClip(requiredSec);
      if (!clip) {
        throw new Error(`No clip available for segment-video at from=${ov.from ?? 0}, duration=${requiredSec}s`);
      }
      const clipDurationSeconds = getDurationSeconds(clip) || requiredSec;
      const finalDurationSeconds = Math.max(requiredSec, clipDurationSeconds);
      const src = buildClipUrl(clip, finalDurationSeconds, { cacheBust });
      if (!src) {
        throw new Error(`Failed to build clip URL for segment-video clip ${clip.id || clip.videoId || "unknown"}`);
      }
      const finalDurationFrames = Math.max(1, Math.round(finalDurationSeconds * fps));
      const enrichedOverlay = {
        ...ov,
        meta: {
          ...(ov.meta || {}),
          slotDurationSeconds: requiredSec,
          clipDurationSeconds,
        },
      };
      videoOverlays.push(
        normalizeVideoOverlay({
          overlay: enrichedOverlay,
          id: nextId++,
          src,
          durationInFrames: finalDurationFrames,
          fps,
          content: clip.cloudinaryId || clip.videoId || clip.id,
        })
      );
      return;
    }
    if (ov?.type === "cutout") {
      cutoutOverlays.push({ ...ov, __id: nextId++ });
      return;
    }
    if (ov?.type === "segment-rapid" && (ov?.variant === "rapid" || ov?.variant === "segment")) {
      const startFrame = toNumber(ov.from, 0);
      const durationFrames = Math.max(1, toNumber(ov.durationInFrames, 1));
      const intervalSeconds = Number(ov.intervalSeconds) > 0 ? Number(ov.intervalSeconds) : 0.1;
      const intervalFrames = Math.max(1, Math.round(intervalSeconds * fps));
      let cursor = startFrame;
      while (cursor < startFrame + durationFrames) {
        const remaining = startFrame + durationFrames - cursor;
        const thisDurationFrames = Math.max(1, Math.min(intervalFrames, remaining));
        const requiredSec = thisDurationFrames / fps;
        const clip = pickClip(requiredSec);
        if (!clip) break;
        const src = buildClipUrl(clip, requiredSec, { cacheBust });
        if (!src) break;
        videoOverlays.push(
          normalizeVideoOverlay({
            overlay: { ...ov, from: cursor },
            id: nextId++,
            src,
            durationInFrames: thisDurationFrames,
            fps,
            content: clip.cloudinaryId || clip.videoId || clip.id,
          })
        );
        cursor += intervalFrames;
      }
      return;
    }
  });

  // Cutout shape grouping
  const cutoutShapes = new Map<string, { overlays: any[]; maxVideoSeconds: number }>();
  cutoutOverlays.forEach((ov) => {
    const shape = ov.shape || "default";
    const durationSec = Math.max(1, toNumber(ov.durationInFrames, 1)) / fps;
    const isVideo = ov.variant === "video";
    if (!cutoutShapes.has(shape)) {
      cutoutShapes.set(shape, { overlays: [], maxVideoSeconds: 0 });
    }
    const entry = cutoutShapes.get(shape)!;
    entry.overlays.push(ov);
    if (isVideo) entry.maxVideoSeconds = Math.max(entry.maxVideoSeconds, durationSec);
  });

  const cutoutPairs = new Map<string, { imageUrl: string; videoUrl: string; clipId: string }>();
  cutoutShapes.forEach((entry, shape) => {
    const pair = buildCutoutPair(cutoutPool.clips, entry.maxVideoSeconds || 1, cacheBust);
    if (pair) {
      cutoutPairs.set(shape, { imageUrl: pair.imageUrl, videoUrl: pair.videoUrl, clipId: pair.clipId });
    }
  });

  if (cutoutOverlays.length && cutoutPairs.size === 0) {
    throw new Error("Cutout assets unavailable: ensure Cloudinary is configured and cutout pool has eligible pairs.");
  }
  cutoutShapes.forEach((_, shape) => {
    if (!cutoutPairs.has(shape)) {
      throw new Error(`No eligible cutout pair found for shape "${shape}".`);
    }
  });

  cutoutOverlays.forEach((ov) => {
    const shape = ov.shape || "default";
    const pair = cutoutPairs.get(shape);
    if (!pair) return;
    const durationInFrames = Math.max(1, toNumber(ov.durationInFrames, 1));
    if (ov.variant === "image") {
      videoOverlays.push(
        normalizeImageOverlay({
          overlay: ov,
          id: ov.__id,
          src: pair.imageUrl,
          durationInFrames,
        })
      );
    } else {
      videoOverlays.push(
        normalizeVideoOverlay({
          overlay: ov,
          id: ov.__id,
          src: pair.videoUrl,
          durationInFrames,
          fps,
          content: pair.clipId,
        })
      );
    }
  });

  // Stretch timeline for pause clips: shift subsequent overlays by pause overhangs.
  const overlaysToShift = [...videoOverlays, ...textOverlays].sort(
    (a, b) => toNumber(a.from, 0) - toNumber(b.from, 0)
  );
  let shiftSeconds = 0;
  overlaysToShift.forEach((ov) => {
    const startSeconds = Math.max(0, toNumber(ov.from, 0) / fps);
    const durationSeconds = Math.max(0, toNumber(ov.durationInFrames, 1) / fps);
    const beatWindowSeconds = Math.max(
      0,
      toNumber((ov as any)?.meta?.beatWindowSeconds, toNumber((ov as any)?.meta?.slotDurationSeconds, durationSeconds)) ||
        durationSeconds
    );
    const overhangSeconds = (ov as any).pauseMusic ? Math.max(0, durationSeconds - beatWindowSeconds) : 0;
    const shiftedStart = startSeconds + shiftSeconds;
    ov.from = Math.max(0, Math.round(shiftedStart * fps));
    (ov as any).meta = {
      ...(ov as any).meta,
      beatWindowSeconds,
      slotDurationSeconds: (ov as any)?.meta?.slotDurationSeconds ?? beatWindowSeconds,
      overhangSeconds,
    };
    shiftSeconds += overhangSeconds;
  });

  const allOverlays = [...videoOverlays, ...textOverlays];
  const maxRow = allOverlays.reduce((m, o) => Math.max(m, toNumber(o.row, 0)), 0);
  const totalFrames =
    allOverlays.reduce((max, o) => Math.max(max, toNumber(o.from, 0) + toNumber(o.durationInFrames, 0)), 0) ||
    fps * 30;

  const song = resolveSongForFormat(formatSlug);
  if (song) {
    const songUrl = song.file ? `${song.file}?ts=${cacheBust}` : song.file;
    const soundRow = maxRow + 1;
    const timelineVideoSeconds = Math.max(
      frameToTime(totalFrames, fps),
      ...allOverlays
        .filter((o) => o.type !== "sound")
        .map((o) => frameToTime(toNumber(o.from, 0) + toNumber(o.durationInFrames, 0), fps))
    );
    // Ensure song duration covers the extended timeline (including pause overhangs).
    const songDurationSeconds = Math.max(
      toNumber(song.duration, 0),
      toNumber((format?.meta as any)?.durationSeconds, 0),
      timelineVideoSeconds,
      frameToTime(totalFrames, fps),
      30
    );
    const toFrames = (seconds: number) => Math.max(1, Math.round(seconds * fps));
    const toSeconds = (frames: number) => Math.max(0, frames / fps);

    // Collect pause overlays to know where to silence the song.
    const pauseOverlays = allOverlays
      .filter((ov) => Boolean((ov as any).pauseMusic))
      .map((ov) => {
        const beatTime = toSeconds(toNumber(ov.from, 0));
        const duration = toSeconds(toNumber(ov.durationInFrames, 0));
        const beatWindow = Math.max(
          0,
          toNumber((ov as any)?.meta?.beatWindowSeconds, duration) || duration
        );
        return {
          beatTime,
          duration,
          beatWindow,
        };
      })
      .sort((a, b) => a.beatTime - b.beatTime);

    const audioSlices: any[] = [];
    let audioId = nextId;
    let songPointer = 0; // seconds into the source song
    let timelineCursor = leadSeconds; // honor 1s lead-in for song start

    const pushAudioSlice = (startSeconds: number, durationSeconds: number, sourceOffsetSeconds: number) => {
      if (durationSeconds <= 0) return;
      const sliceDurationFrames = toFrames(durationSeconds);
      audioSlices.push({
        id: audioId++,
        type: "sound",
        content: song.id,
        src: songUrl,
        from: toFrames(startSeconds),
        durationInFrames: sliceDurationFrames,
        row: soundRow,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        rotation: 0,
        isDragging: false,
        startFromSound: toFrames(sourceOffsetSeconds),
        videoDurationInFrames: sliceDurationFrames,
        mediaSrcDuration: songDurationSeconds,
        styles: { volume: 1, animation: { enter: "none", exit: "none" } },
        meta: { songSlug: song.id },
      });
    };

    pauseOverlays.forEach(({ beatTime, duration, beatWindow }) => {
      // Play music up to the start of the pause clip (if needed).
      const playUntil = Math.max(0, beatTime - timelineCursor);
      if (playUntil > 0) {
        pushAudioSlice(timelineCursor, playUntil, songPointer);
        timelineCursor += playUntil;
        songPointer += playUntil;
      }

      // Play through the slot window alongside the pause clip.
      const windowPlay = Math.max(0, beatWindow);
      if (windowPlay > 0) {
        pushAudioSlice(timelineCursor, windowPlay, songPointer);
        timelineCursor += windowPlay;
        songPointer += windowPlay;
      }

      // Mute only the overhang (clip longer than slot); do not advance songPointer.
      const overhang = Math.max(0, duration - beatWindow);
      timelineCursor += overhang;
    });

    const remaining = Math.max(0, songDurationSeconds - songPointer);
    if (remaining > 0) {
      pushAudioSlice(timelineCursor, remaining, songPointer);
      timelineCursor += remaining;
      songPointer += remaining;
    }

    nextId = audioId;
    allOverlays.unshift(...audioSlices);

    // Ensure project duration covers the full audio tail.
    const lastAudioEnd = audioSlices.reduce(
      (max, overlay) => Math.max(max, toNumber(overlay.from, 0) + toNumber(overlay.durationInFrames, 0)),
      0
    );
    const lastVideoEnd = allOverlays
      .filter((o) => o.type !== "sound")
      .reduce((max, o) => Math.max(max, toNumber(o.from, 0) + toNumber(o.durationInFrames, 0)), 0);
    const durationInFrames = Math.max(totalFrames, lastAudioEnd, lastVideoEnd);

    return {
      overlays: allOverlays,
      aspectRatio,
      fps,
      durationInFrames,
      meta: {
        jobId: null,
        songSlug: formatSlug,
        projectId: format?.meta?.projectId || null,
        renderUrl: null,
        songUrl: song ? `${song.file}?ts=${cacheBust}` : null,
        warnings: [],
      },
    };
  }

  return {
    overlays: allOverlays,
    aspectRatio,
    fps,
    durationInFrames: Math.max(
      totalFrames,
      allOverlays.reduce((max, o) => Math.max(max, toNumber(o.from, 0) + toNumber(o.durationInFrames, 0)), 0)
    ),
    meta: {
      jobId: null,
      songSlug: formatSlug,
      projectId: format?.meta?.projectId || null,
      renderUrl: null,
      songUrl: song ? `${song.file}?ts=${cacheBust}` : null,
      warnings: [],
    },
  };
};

export async function GET() {
  try {
    const formats = await listFormatFiles();
    return NextResponse.json({ formats });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to list formats" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const slug = body?.formatSlug || body?.songSlug || body?.slug;
    const chronologicalOrder = Boolean(body?.chronologicalOrder);
    if (!slug) {
      return NextResponse.json({ error: "formatSlug is required" }, { status: 400 });
    }
    const format = await loadFormat(slug);
    const rveProject = await buildGenerateEdit2Project({
      format,
      formatSlug: slug,
      chronologicalOrder,
    });
    return NextResponse.json({ rveProject, jobId: null });
  } catch (err: any) {
    console.error("[generate-edit2] error", err);
    return NextResponse.json({ error: err?.message || "Failed to create edit" }, { status: 500 });
  }
}
