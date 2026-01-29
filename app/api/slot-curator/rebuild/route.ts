import { NextResponse } from "next/server";
import { loadInstantClipPool } from "@/lib/songEdit";
import {
  assignGenerateEditClips,
  buildGenerateEditSegments,
  loadGenerateEditFormat,
} from "@/lib/generateEdit";
import {
  DURATION_EPSILON,
  SlotCandidate,
  SlotSegment,
  computeFormatHash,
  dedupeCandidates,
  durationKey,
  readSlotsFile,
  summarizeSlots,
  writeSlotsFile,
} from "@/lib/slotCurator";
import { loadClipIndex, loadSharedClipIndex, findMatchingLocalClip } from "@/lib/localClipStore";

export const runtime = "nodejs";

const DEFAULT_RUNS = 12;
const DEFAULT_MAX_PER_SLOT = 6;
const DEFAULT_MIN_PER_DURATION = 2;

const mulberry32 = (seed: number) => {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const normalizeNumber = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const collectIntents = (clip: any) => {
  const intents = new Set<string>();
  const push = (val?: string | null) => {
    const v = (val || "").trim().toLowerCase();
    if (!v) return;
    intents.add(v);
  };
  if (clip?.sceneType) push(clip.sceneType);
  if (clip?.type) push(clip.type);
  (clip?.tags || []).forEach((tag: string) => {
    const lower = (tag || "").toLowerCase();
    if (lower.startsWith("intent:")) {
      push(lower.replace("intent:", ""));
    } else if (["visual", "dialogue", "action", "punch", "impact", "whoosh"].includes(lower)) {
      push(lower);
    }
  });
  return Array.from(intents);
};

const cloneSegments = (segments: any[]) => JSON.parse(JSON.stringify(segments || []));

const scoreCandidate = (candidate: SlotCandidate, targetDuration: number, targetIntent: string | null) => {
  const delta = Math.abs(normalizeNumber(candidate.durationSeconds, 0) - targetDuration);
  const durationScore = 1 - Math.min(delta / Math.max(targetDuration || 1, 1), 1);
  const intentScore =
    targetIntent && candidate.intents?.some((i) => (i || "").toLowerCase() === targetIntent.toLowerCase())
      ? 0.35
      : 0;
  const jitter = ((candidate.seed ?? 0) % 997) / 10_000;
  return durationScore + intentScore + jitter;
};

async function rebuildSlots(params: {
  songSlug: string;
  runs: number;
  maxPerSlot: number;
  minPerDuration: number;
}) {
  const { songSlug, runs, maxPerSlot, minPerDuration } = params;
  const format = loadGenerateEditFormat(songSlug);
  const base = buildGenerateEditSegments(format);
  const baseSegments = base.segments;
  const targetDurations = baseSegments.map((seg) => normalizeNumber(seg?.durationSeconds, 0));
  const targetIntents = baseSegments.map((seg) => (seg as any)?.beatMetadata?.intent ?? null);
  const fps = normalizeNumber(base.fps, normalizeNumber(format?.meta?.targetFps, 30)) || 30;
  const formatHash = computeFormatHash(format);

  const pool = loadInstantClipPool();
  if (!pool?.clips?.length) {
    throw new Error("Clip pool unavailable. Populate data/instantClipPool.json first.");
  }
  const poolClipMap = new Map<string, any>();
  (pool?.clips || []).forEach((clip: any) => {
    if (!clip) return;
    const id = clip.id ?? clip.clipId ?? null;
    if (id !== null && id !== undefined) {
      poolClipMap.set(String(id), clip);
    }
  });

  const segments: SlotSegment[] = targetDurations.map((duration, idx) => {
    const sourceSeg = baseSegments[idx] as any;
    const beatMeta = sourceSeg?.beatMetadata || null;
    const beatWindowSeconds = normalizeNumber(sourceSeg?.beatWindowSeconds ?? sourceSeg?.durationSeconds, duration);
    const rapidRangeIndex = Number.isInteger(sourceSeg?.rapidRangeIndex) ? sourceSeg.rapidRangeIndex : null;
    const isRapidRange = sourceSeg?.type === "rapid" || sourceSeg?.rapidClipSlot;
    return {
      slot: idx,
      targetDuration: duration,
      candidates: [],
      beatMetadata: beatMeta
        ? {
            intent: beatMeta.intent ?? null,
            clipSlot: beatMeta.clipSlot
              ? {
                  clipVolume: beatMeta.clipSlot.clipVolume ?? null,
                  musicVolume: beatMeta.clipSlot.musicVolume ?? null,
                  pauseMusic: Boolean(beatMeta.clipSlot.pauseMusic),
                }
              : null,
            beatWindowSeconds,
            rapidRangeIndex,
            isRapidRange,
          }
        : {
            intent: null,
            clipSlot: null,
            beatWindowSeconds,
            rapidRangeIndex,
            isRapidRange,
          },
      beatWindowSeconds,
    };
  });

  const seedsUsed: number[] = [];

  for (let i = 0; i < runs; i += 1) {
    const seed = Date.now() + i * 37 + Math.floor(Math.random() * 10_000);
    seedsUsed.push(seed);

    const rng = mulberry32(seed);
    const prevRandom = Math.random;
    Math.random = rng;
    try {
      const clonedSegments = cloneSegments(base.segments);
      assignGenerateEditClips({
        segments: clonedSegments,
        pool,
        options: { chronologicalOrder: false },
      });

      clonedSegments.forEach((seg: any, idx: number) => {
        const asset = seg?.asset;
        if (!asset) return;
        const targetDuration = targetDurations[idx] ?? 0;
        const durationSeconds = normalizeNumber(
          seg?.durationSeconds ?? asset?.duration ?? normalizeNumber(asset?.end, 0) - normalizeNumber(asset?.start, 0),
          0
        );
        if (Math.abs(durationSeconds - targetDuration) > DURATION_EPSILON) return;

        const poolClipId = asset?.poolClipId ?? asset?.indexId ?? asset?.videoId ?? null;
        const poolClip = poolClipId ? poolClipMap.get(String(poolClipId)) : null;
        const intents = collectIntents(poolClip);
        const candidate: SlotCandidate = {
          videoId: asset.videoId ?? null,
          indexId: asset.indexId ?? null,
          cloudinaryId: asset.cloudinaryId ?? null,
          start: normalizeNumber(asset.start, 0),
          end: normalizeNumber(asset.end, normalizeNumber(asset.start, 0) + durationSeconds),
          durationSeconds,
          tags: Array.isArray(poolClip?.tags) ? poolClip.tags : null,
          intents: intents.length ? intents : null,
          bucket: durationKey(targetDuration),
          seed,
        };
        segments[idx].candidates.push(candidate);
      });
    } finally {
      Math.random = prevRandom;
    }
  }

  const prunedSegments: SlotSegment[] = segments.map((seg, idx) => {
    const deduped = dedupeCandidates(seg.candidates).filter(
      (cand) => Math.abs(normalizeNumber(cand.durationSeconds, 0) - seg.targetDuration) <= DURATION_EPSILON
    );
    const scored = deduped
      .map((cand) => ({
        cand,
        score: scoreCandidate(cand, seg.targetDuration, targetIntents[idx] ?? null),
      }))
      .sort((a, b) => b.score - a.score)
      .map(({ cand }) => cand);
    const keep = Math.min(maxPerSlot, scored.length);
    return {
      slot: seg.slot,
      targetDuration: seg.targetDuration,
      candidates: scored.slice(0, keep),
    };
  });

  const payload = {
    header: {
      generatedAt: new Date().toISOString(),
      runs,
      seedsUsed,
      formatHash,
      fps,
      songSlug,
    },
    segments: prunedSegments,
  };

  const filePath = await writeSlotsFile(songSlug, payload);
  const coverage = summarizeSlots(payload).coverage;

  const coverageWarnings = Object.values(coverage).filter((entry) => entry.candidateCount < minPerDuration);

  // Compute missing clip bindings against current indexes (clip-map refresh)
  const songIndex = await loadClipIndex(songSlug);
  const sharedIndex = await loadSharedClipIndex();
  const missingSlots: number[] = [];
  const missingCandidates: { slot: number; candidateId: string; bucket: string }[] = [];
  payload.segments.forEach((seg) => {
    const candidates = seg?.candidates || [];
    let matched = false;
    for (const cand of candidates) {
      const hit = findMatchingLocalClip(songIndex, cand, sharedIndex);
      if (hit) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      missingSlots.push(seg.slot);
      const bucket = durationKey(seg.targetDuration ?? 0);
      candidates.forEach((cand) => {
        const key = `${durationKey(
          typeof cand.durationSeconds === "number" ? cand.durationSeconds : seg.targetDuration ?? 0
        )}:${String(cand.cloudinaryId || cand.videoId || cand.indexId || "cand")}`;
        missingCandidates.push({ slot: seg.slot, candidateId: key, bucket });
      });
    }
  });

  return {
    filePath,
    slots: payload,
    coverage,
    coverageWarnings,
    missingSlots,
    missingCandidates,
  };
}

const parseIntParam = (value: string | null, fallback: number) => {
  const n = parseInt(String(value || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const songSlug = searchParams.get("songSlug");
  if (!songSlug) {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const runs = parseIntParam(searchParams.get("runs"), DEFAULT_RUNS);
  const maxPerSlot = parseIntParam(searchParams.get("maxPerSlot"), DEFAULT_MAX_PER_SLOT);
  const minPerDuration = parseIntParam(searchParams.get("minPerDuration"), DEFAULT_MIN_PER_DURATION);

  try {
    const result = await rebuildSlots({ songSlug, runs, maxPerSlot, minPerDuration });
    return NextResponse.json({
      status: "ok",
      filePath: result.filePath,
      slots: result.slots,
      coverage: result.coverage,
      coverageWarnings: result.coverageWarnings,
      missingSlots: result.missingSlots,
      missingCandidates: result.missingCandidates,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Failed to rebuild slot candidates",
        slots: await readSlotsFile(songSlug),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // ignore body parse errors; query params will be used instead
  }

  const songSlug = body?.songSlug || params.get("songSlug");
  if (!songSlug || typeof songSlug !== "string") {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const runs = parseIntParam(body?.runs ?? params.get("runs"), DEFAULT_RUNS);
  const maxPerSlot = parseIntParam(body?.maxPerSlot ?? params.get("maxPerSlot"), DEFAULT_MAX_PER_SLOT);
  const minPerDuration = parseIntParam(body?.minPerDuration ?? params.get("minPerDuration"), DEFAULT_MIN_PER_DURATION);

  try {
    const result = await rebuildSlots({ songSlug, runs, maxPerSlot, minPerDuration });
    return NextResponse.json({
      status: "ok",
      filePath: result.filePath,
      slots: result.slots,
      coverage: result.coverage,
      coverageWarnings: result.coverageWarnings,
      missingSlots: result.missingSlots,
      missingCandidates: result.missingCandidates,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Failed to rebuild slot candidates",
        slots: await readSlotsFile(songSlug),
      },
      { status: 500 }
    );
  }
}
