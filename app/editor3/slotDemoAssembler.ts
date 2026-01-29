import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { buildGenerateEditRveProject } from "@/lib/generateEditAdapter";
import { buildGenerateEditSegments, loadGenerateEditFormat } from "@/lib/generateEdit";
import {
  DURATION_EPSILON,
  SlotCandidate,
  SlotFile,
  SlotSegment,
  computeFormatHash,
  durationKey,
  readSlotsFile,
} from "@/lib/slotCurator";
import { findMatchingLocalClip, loadClipIndex, loadSharedClipIndex } from "@/lib/localClipStore";

const EDITOR_IMPORTS_DIR = path.join(process.cwd(), "data", "editor-imports");

const mulberry32 = (seed: number) => {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const timestampId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeNumber = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const ensureDir = async (dirPath: string) => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const chooseCandidate = (rng: () => number, candidates: SlotCandidate[], lastId: string | null) => {
  if (!candidates.length) return null;
  const filtered =
    lastId === null
      ? candidates
      : candidates.filter((cand) => {
          const id = cand.videoId || cand.indexId || cand.cloudinaryId || null;
          return id ? id !== lastId : true;
        });
  const pool = filtered.length ? filtered : candidates;
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.max(0, Math.min(idx, pool.length - 1))];
};

const sanitizeCandidatesForSlot = (segment: SlotSegment) =>
  (segment?.candidates || []).filter(
    (cand) => Math.abs(normalizeNumber(cand.durationSeconds, 0) - segment.targetDuration) <= DURATION_EPSILON
  );

export async function assembleSlotPlan({
  songSlug,
  seed,
}: {
  songSlug: string;
  seed?: number;
}): Promise<{
  plan: any;
  slots: SlotFile;
  placements: { slot: number; candidate: SlotCandidate; targetDuration: number }[];
  fps: number;
  durationSeconds: number;
  warnings: string[];
}> {
  const slots = await readSlotsFile(songSlug);
  if (!slots) {
    throw new Error(`Slots not found for song "${songSlug}". Rebuild slots first.`);
  }
  const format = loadGenerateEditFormat(songSlug);
  const baseSegments = buildGenerateEditSegments(format)?.segments || [];
  const rng = mulberry32(seed ?? Date.now());
  const warnings: string[] = [];

  if (slots.header?.formatHash) {
    const currentHash = computeFormatHash(format);
    const storedHash = slots.header.formatHash;
    if (storedHash && currentHash && storedHash !== currentHash) {
      warnings.push("Format hash mismatch; consider rebuilding slots.");
    }
  }

  let cursorSeconds = 0;
  let lastId: string | null = null;
  const placements: { slot: number; candidate: SlotCandidate; targetDuration: number }[] = [];
  const planSegments: any[] = [];

  const localIndex = await loadClipIndex(songSlug);
  const sharedIndex = await loadSharedClipIndex();
  if (!localIndex && !sharedIndex) {
    throw new Error(`Local clip index not found for "${songSlug}". Run materialization first.`);
  }

  const deriveBeatMeta = (slotIdx: number) => {
    const source = baseSegments[slotIdx] as any;
    if (!source) return null;
    const beatMeta = source?.beatMetadata || null;
    const beatWindowSeconds = normalizeNumber(
      beatMeta?.beatWindowSeconds ?? source?.beatWindowSeconds ?? source?.durationSeconds,
      normalizeNumber(source?.durationSeconds, 0)
    );
    const rapidRangeIndex = Number.isInteger(source?.rapidRangeIndex) ? source.rapidRangeIndex : null;
    const isRapidRange = Boolean(source?.type === "rapid" || source?.rapidClipSlot);
    return {
      intent: beatMeta?.intent ?? null,
      clipSlot: beatMeta?.clipSlot
        ? {
            clipVolume: beatMeta.clipSlot.clipVolume ?? null,
            musicVolume: beatMeta.clipSlot.musicVolume ?? null,
            pauseMusic: Boolean(beatMeta.clipSlot.pauseMusic),
          }
        : null,
      beatWindowSeconds,
      rapidRangeIndex,
      isRapidRange,
    };
  };

  slots.segments.forEach((segment) => {
    const validCandidates = sanitizeCandidatesForSlot(segment);
    if (!validCandidates.length) {
      throw new Error(
        `Slot ${segment.slot} (${durationKey(segment.targetDuration)}s) has no duration-matching candidates.`
      );
    }
    const pick = chooseCandidate(rng, validCandidates, lastId);
    if (!pick) {
      throw new Error(`Slot ${segment.slot} failed to select a candidate.`);
    }
    const startSeconds = cursorSeconds;
    const endSeconds = startSeconds + segment.targetDuration;
    const assetStart = normalizeNumber(pick.start, 0);
    const assetEnd = normalizeNumber(pick.end, assetStart + segment.targetDuration);

    const localMatch = findMatchingLocalClip(localIndex, {
      cloudinaryId: pick.cloudinaryId,
      videoId: pick.videoId,
      indexId: pick.indexId,
      start: pick.start,
      end: pick.end,
    }, sharedIndex);
    if (!localMatch) {
      throw new Error(
        `Local clip missing for slot ${segment.slot} (${durationKey(segment.targetDuration)}s). Materialize clips first.`
      );
    }

    const slotBeatMeta = (segment as any)?.beatMetadata || null;
    const derivedBeatMeta = deriveBeatMeta(segment.slot);
    const chosenBeatMeta = slotBeatMeta || derivedBeatMeta;
    const beatWindowSeconds = normalizeNumber(
      chosenBeatMeta?.beatWindowSeconds ?? slotBeatMeta?.beatWindowSeconds ?? segment.targetDuration,
      segment.targetDuration
    );
    const clipSlot = chosenBeatMeta?.clipSlot || slotBeatMeta?.clipSlot || derivedBeatMeta?.clipSlot || null;
    const clipVolume = normalizeNumber(clipSlot?.clipVolume, 1);
    const pauseMusic = Boolean(clipSlot?.pauseMusic);
    const intent = chosenBeatMeta?.intent ?? null;
    const isRapidRange = Boolean(chosenBeatMeta?.isRapidRange || chosenBeatMeta?.rapidRangeIndex !== null);

    placements.push({ slot: segment.slot, candidate: pick, targetDuration: segment.targetDuration });
    planSegments.push({
      index: segment.slot,
      startSeconds,
      endSeconds,
      durationSeconds: segment.targetDuration,
      frameCount: undefined,
      asset: {
        indexId: pick.indexId ?? null,
        videoId: pick.videoId ?? null,
        cloudinaryId: pick.cloudinaryId ?? null,
        start: assetStart,
        end: assetEnd,
        duration: segment.targetDuration,
        availableDuration: pick.durationSeconds ?? segment.targetDuration,
        sourcePoolIndex: null,
        localPath: localMatch?.publicPath || null,
      },
      beatMetadata: {
        intent,
        clipSlot: clipSlot
          ? {
              clipVolume,
              musicVolume: clipSlot.musicVolume ?? null,
              pauseMusic,
            }
          : {
              clipVolume,
              musicVolume: null,
              pauseMusic,
            },
        beatWindowSeconds,
        rapidRangeIndex: chosenBeatMeta?.rapidRangeIndex ?? null,
        isRapidRange,
      },
      beatWindowSeconds,
      isInRapidRange: isRapidRange,
    });

    cursorSeconds = endSeconds;
    lastId = pick.videoId || pick.indexId || pick.cloudinaryId || lastId;
  });

  const fps = normalizeNumber(slots.header?.fps, normalizeNumber(format?.meta?.targetFps, 30)) || 30;
  const totalFrames = Math.max(1, Math.round(cursorSeconds * fps));

  const plan = {
    songSlug,
    useLocalClips: true,
    songFormat: {
      source: (() => {
        const localSong = path.join(process.cwd(), "public", "songs", `${songSlug}.mp3`);
        if (fs.existsSync(localSong)) return `/songs/${songSlug}.mp3`;
        return (format as any)?.source;
      })(),
      meta: (format as any)?.meta || {},
    },
    fps,
    totalFrames,
    segments: planSegments,
  };

  return {
    plan,
    slots,
    placements,
    fps,
    durationSeconds: cursorSeconds,
    warnings,
  };
}

export async function writeSlotPlanImport({
  songSlug,
  plan,
  fps,
  jobId,
}: {
  songSlug: string;
  plan: any;
  fps: number;
  jobId?: string;
}) {
  const id = jobId || timestampId();
  const rveProject = buildGenerateEditRveProject({ plan, jobId: id, songUrl: null });
  await ensureDir(EDITOR_IMPORTS_DIR);
  const filePath = path.join(EDITOR_IMPORTS_DIR, `${id}.json`);
  const payload = {
    jobId: id,
    createdAt: new Date().toISOString(),
    songSlug,
    videoUrl: null,
    baseVideoUrl: null,
    captionedVideoUrl: null,
    plan,
    rveProject,
    localClipUrls: [],
  };
  await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { jobId: id, filePath, rveProject };
}
