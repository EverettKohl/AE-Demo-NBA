import { NextResponse } from "next/server";
import { loadGenerateEditFormat } from "@/lib/generateEdit";
import {
  computeFormatHash,
  durationKey,
  readSlotsFile,
  summarizeSlots,
} from "@/lib/slotCurator";
import {
  buildCandidateKey,
  loadClipIndex,
  loadSharedClipIndex,
} from "@/lib/localClipStore";

export const runtime = "nodejs";

type StatusResult = {
  status: "ok" | "error";
  songSlug: string;
  format: { exists: boolean; hash: string | null };
  slots: { exists: boolean; hash: string | null; hashMatch: boolean | null };
  coverageWarnings: { duration: number; candidateCount: number; slotCount: number }[];
  availability: { missingSlots: number[]; slotCounts: Record<string, number> };
  ready: boolean;
  reasons: string[];
};

const safeLoadFormat = (songSlug: string) => {
  try {
    const format = loadGenerateEditFormat(songSlug);
    const hash = computeFormatHash(format);
    return { exists: true, format, hash };
  } catch {
    return { exists: false, format: null, hash: null };
  }
};

const buildCoverage = (slots: any, songIndex: any, sharedIndex: any) => {
  const slotsList = Array.isArray(slots?.segments) ? slots.segments : [];
  const slotAvailability: Record<number, { matched: boolean; candidates: string[] }> = {};
  const missingCandidates: { slot: number; bucket: string; candidateId: string }[] = [];
  slotsList.forEach((seg: any) => {
    const slot = Number(seg?.slot);
    if (!Number.isFinite(slot)) return;
    slotAvailability[slot] = slotAvailability[slot] || { matched: false, candidates: [] };
    const candidates = Array.isArray(seg?.candidates) ? seg.candidates : [];
    for (const cand of candidates) {
      const key = buildCandidateKey({
        cloudinaryId: cand.cloudinaryId,
        videoId: cand.videoId,
        indexId: cand.indexId,
        start: cand.start,
        end: cand.end,
      });
      slotAvailability[slot].candidates.push(key);
      const inSong = songIndex?.entries?.some((e: any) => e.candidateId === key);
      const inShared = sharedIndex?.entries?.some((e: any) => e.candidateId === key);
      if (inSong || inShared) {
        slotAvailability[slot].matched = true;
      }
    }
    if (!slotAvailability[slot].matched) {
      const firstCand = candidates[0];
      const bucket = durationKey(
        typeof firstCand?.durationSeconds === "number"
          ? firstCand.durationSeconds
          : seg?.targetDuration ?? 0
      );
      slotAvailability[slot].candidates.forEach((key) => {
        missingCandidates.push({ slot, bucket, candidateId: key });
      });
    }
  });

  const missingSlots = Object.entries(slotAvailability)
    .filter(([, info]) => !info.matched)
    .map(([slot]) => Number(slot));

  const missingBuckets = Array.from(
    new Set(missingCandidates.map((m) => m.bucket).filter(Boolean))
  );

  return { missingSlots, missingBuckets, missingCandidates };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const songSlug = searchParams.get("songSlug");
  if (!songSlug) {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const { exists: formatExists, format, hash: formatHash } = safeLoadFormat(songSlug);
  const slots = await readSlotsFile(songSlug);
  const slotsExists = Boolean(slots);
  const slotsHash = slots?.header?.formatHash || null;
  const hashMatch =
    formatExists && slotsExists && formatHash && slotsHash
      ? formatHash === slotsHash
      : null;

  const summary = slots ? summarizeSlots(slots) : null;
  const coverageWarnings =
    summary?.coverage
      ? Object.values(summary.coverage).filter(
          (entry: any) => (entry?.candidateCount ?? 0) < 1
        )
      : [];

  const clipIndex = await loadClipIndex(songSlug);
  const sharedIndex = await loadSharedClipIndex();
  const availability = buildCoverage(slots, clipIndex, sharedIndex);

  const reasons: string[] = [];
  if (!formatExists) reasons.push("Format missing");
  if (!slotsExists) reasons.push("Slots missing");
  if (hashMatch === false) reasons.push("Format changed; rebuild slots");
  if (coverageWarnings.length) reasons.push("Low slot coverage");
  if (availability.missingSlots.length) reasons.push("Missing mp4s for some slots");

  const ready =
    formatExists &&
    slotsExists &&
    hashMatch !== false &&
    !coverageWarnings.length &&
    availability.missingSlots.length === 0;

  const payload: StatusResult = {
    status: "ok",
    songSlug,
    format: { exists: formatExists, hash: formatHash },
    slots: { exists: slotsExists, hash: slotsHash, hashMatch },
    coverageWarnings: coverageWarnings.map((entry: any) => ({
      duration: entry?.target ?? 0,
      candidateCount: entry?.candidateCount ?? 0,
      slotCount: entry?.slotCount ?? 0,
    })),
    availability,
    ready,
    reasons,
  };

  return NextResponse.json(payload);
}
