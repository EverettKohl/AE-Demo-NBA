import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const SLOTS_ROOT = path.join(process.cwd(), "data", "instant-editor");
export const DURATION_EPSILON = 1e-3;

export type SlotCandidate = {
  videoId?: string | null;
  indexId?: string | null;
  cloudinaryId?: string | null;
  start: number;
  end: number;
  durationSeconds: number;
  tags?: string[] | null;
  intents?: string[] | null;
  bucket?: string | null;
  seed?: number;
};

export type SlotSegment = {
  slot: number;
  targetDuration: number;
  candidates: SlotCandidate[];
  beatMetadata?: {
    intent?: string | null;
    clipSlot?: {
      clipVolume?: number | null;
      musicVolume?: number | null;
      pauseMusic?: boolean;
    } | null;
    beatWindowSeconds?: number | null;
    rapidRangeIndex?: number | null;
    isRapidRange?: boolean;
  } | null;
  beatWindowSeconds?: number | null;
};

export type SlotFileHeader = {
  generatedAt: string;
  runs: number;
  seedsUsed: number[];
  formatHash: string | null;
  fps: number;
  songSlug?: string | null;
};

export type SlotFile = {
  header: SlotFileHeader;
  segments: SlotSegment[];
};

export type DurationCoverage = {
  key: string;
  target: number;
  candidateCount: number;
  slotCount: number;
};

const countDecimals = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  const str = String(value);
  const dot = str.indexOf(".");
  return dot === -1 ? 0 : str.length - dot - 1;
};

export const durationKey = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  const decimals = Math.min(Math.max(countDecimals(safe), 0), 6);
  return decimals > 0 ? safe.toFixed(decimals) : String(safe);
};

export const ensureSlotsDir = async (songSlug: string) => {
  const dir = path.join(SLOTS_ROOT, songSlug);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
};

export const slotsPath = (songSlug: string) => path.join(SLOTS_ROOT, songSlug, "slots.json");

export const computeFormatHash = (format: any) => {
  const hash = crypto.createHash("sha1");
  hash.update(JSON.stringify(format || {}));
  return hash.digest("hex");
};

export const readSlotsFile = async (songSlug: string): Promise<SlotFile | null> => {
  const filePath = slotsPath(songSlug);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as SlotFile;
  } catch {
    return null;
  }
};

export const writeSlotsFile = async (songSlug: string, data: SlotFile) => {
  const dir = await ensureSlotsDir(songSlug);
  const filePath = path.join(dir, "slots.json");
  const payload = {
    header: data.header,
    segments: Array.isArray(data.segments) ? data.segments : [],
  };
  await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
};

export const buildCoverage = (segments: SlotSegment[]): Record<string, DurationCoverage> => {
  const coverage: Record<string, DurationCoverage> = {};
  (segments || []).forEach((seg) => {
    const key = durationKey(seg.targetDuration);
    if (!coverage[key]) {
      coverage[key] = { key, target: seg.targetDuration, candidateCount: 0, slotCount: 0 };
    }
    coverage[key].slotCount += 1;
    coverage[key].candidateCount += Array.isArray(seg.candidates) ? seg.candidates.length : 0;
  });
  return coverage;
};

export const dedupeCandidates = (candidates: SlotCandidate[]) => {
  const seen = new Set<string>();
  const deduped: SlotCandidate[] = [];
  for (const cand of candidates || []) {
    const key = [
      cand.videoId || cand.indexId || cand.cloudinaryId || "unknown",
      (cand.start ?? 0).toFixed(3),
      (cand.end ?? cand.start ?? 0).toFixed(3),
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cand);
  }
  return deduped;
};

export const summarizeSlots = (slots: SlotFile | null) => {
  if (!slots) {
    return {
      header: null,
      segments: [],
      coverage: {},
    };
  }
  const segments = Array.isArray(slots.segments) ? slots.segments : [];
  return {
    header: slots.header,
    segments,
    coverage: buildCoverage(segments),
  };
};
