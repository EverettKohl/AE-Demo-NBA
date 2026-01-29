import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { getClipUrl } from "@/utils/cloudinary";
import { durationKey } from "./slotCurator";

export type MaterializedClip = {
  slot: number;
  candidateId: string;
  cloudinaryId: string | null;
  start: number;
  end: number;
  durationSeconds: number;
  bucket: string;
  localPath: string; // absolute
  publicPath: string; // /instant-clips/...
  size: number;
};

export type ClipIndex = {
  songSlug: string;
  generatedAt: string;
  fps: number;
  entries: MaterializedClip[];
};

const PUBLIC_CLIP_ROOT = path.join(process.cwd(), "public", "instant-clips");
const DATA_CLIP_ROOT = path.join(process.cwd(), "data", "instant-clips");
const SHARED_INDEX_PATH = path.join(DATA_CLIP_ROOT, "index.json");

const ensureDir = async (dirPath: string) => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");

export const buildCandidateKey = (candidate: {
  cloudinaryId?: string | null;
  videoId?: string | null;
  indexId?: string | null;
  start?: number;
  end?: number;
}) => {
  const id = candidate.cloudinaryId || candidate.videoId || candidate.indexId || "cand";
  const startMs = Math.round((candidate.start ?? 0) * 1000);
  const endMs = Math.round((candidate.end ?? 0) * 1000);
  return `${sanitize(String(id))}-${startMs}ms-${endMs}ms`;
};

const downloadToFile = async (url: string, destPath: string, signal?: AbortSignal) => {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to download clip (${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error(`Downloaded file is empty: ${url}`);
  await ensureDir(path.dirname(destPath));
  await fsp.writeFile(destPath, buf);
  return buf.length;
};

const loadSharedIndex = async (): Promise<ClipIndex> => {
  if (!fs.existsSync(SHARED_INDEX_PATH)) {
    return { songSlug: "shared", generatedAt: new Date().toISOString(), fps: 0, entries: [] };
  }
  try {
    const raw = await fsp.readFile(SHARED_INDEX_PATH, "utf8");
    return JSON.parse(raw) as ClipIndex;
  } catch {
    return { songSlug: "shared", generatedAt: new Date().toISOString(), fps: 0, entries: [] };
  }
};

const saveSharedIndex = async (index: ClipIndex) => {
  await ensureDir(DATA_CLIP_ROOT);
  const payload = {
    ...index,
    generatedAt: new Date().toISOString(),
    songSlug: "shared",
  };
  await fsp.writeFile(SHARED_INDEX_PATH, JSON.stringify(payload, null, 2), "utf8");
};

const findMatchingInIndex = (index: ClipIndex | null, candidateKey: string) => {
  if (!index?.entries?.length) return null;
  return index.entries.find((entry) => entry.candidateId === candidateKey) || null;
};

export const materializeSlotsToLocal = async ({
  songSlug,
  slots,
  fps,
  signal,
  missingOnly = false,
}: {
  songSlug: string;
  slots: any;
  fps: number;
  signal?: AbortSignal;
  missingOnly?: boolean;
}): Promise<ClipIndex> => {
  if (!Array.isArray(slots?.segments)) {
    throw new Error("slots payload missing segments");
  }
  const sharedIndex = await loadSharedIndex();
  const entries: MaterializedClip[] = [];

  const ensureExistingFile = async (absPath: string) => {
    try {
      const stat = await fsp.stat(absPath);
      return stat.size > 0;
    } catch {
      return false;
    }
  };

  for (const segment of slots.segments) {
    const slot = segment?.slot ?? 0;
    const bucket = durationKey(segment?.targetDuration ?? 0);
    for (const candidate of segment?.candidates || []) {
      const candDuration =
        typeof candidate.durationSeconds === "number"
          ? candidate.durationSeconds
          : Math.max(0, (candidate.end ?? 0) - (candidate.start ?? 0));
      const candBucket = durationKey(candDuration || segment?.targetDuration || 0);
      const durationKeyDir = candBucket || bucket || "unknown";
      const candidateKey = buildCandidateKey(candidate);
      // Shared storage path (duration-keyed)
      const relDir = path.join("instant-clips", durationKeyDir);
      const relFile = path.join(relDir, `${candidateKey}.mp4`);
      const publicPath = `/${relFile.replace(/\\/g, "/")}`;
      const absPath = path.join(PUBLIC_CLIP_ROOT, durationKeyDir, `${candidateKey}.mp4`);

      const sharedMatch = findMatchingInIndex(sharedIndex, candidateKey);
      const perSongIndexPath = path.join(DATA_CLIP_ROOT, songSlug, "index.json");
      let size = 0;

      const maybeReuse = async () => {
        if (sharedMatch && (await ensureExistingFile(sharedMatch.localPath))) {
          return {
            localPath: sharedMatch.localPath,
            publicPath: sharedMatch.publicPath,
            size: sharedMatch.size,
          };
        }
        if (fs.existsSync(absPath) && (await ensureExistingFile(absPath))) {
          const stat = await fsp.stat(absPath);
          return { localPath: absPath, publicPath, size: stat.size };
        }
        return null;
      };

      const reused = await maybeReuse();
      if (reused) {
        size = reused.size;
      } else {
        if (missingOnly) {
          continue;
        }
        const cloudId = candidate.cloudinaryId || candidate.videoId || null;
        if (!cloudId) {
          continue;
        }
        const start = candidate.start ?? 0;
        const end = candidate.end ?? start + candDuration;
        const url = getClipUrl(cloudId, start, end, { fps });
        size = await downloadToFile(url, absPath, signal);
      }

      const entry: MaterializedClip = {
        slot,
        candidateId: candidateKey,
        cloudinaryId: candidate.cloudinaryId || candidate.videoId || candidate.indexId || null,
        start: candidate.start ?? 0,
        end: candidate.end ?? candidate.start ?? 0,
        durationSeconds: candDuration,
        bucket: candBucket,
        localPath: reused?.localPath || absPath,
        publicPath: reused?.publicPath || publicPath,
        size,
      };

      entries.push(entry);

      // Persist in shared index
      const sharedExists = findMatchingInIndex(sharedIndex, candidateKey);
      if (!sharedExists) {
        sharedIndex.entries.push({
          songSlug: "shared",
          generatedAt: new Date().toISOString(),
          fps,
          ...entry,
        } as any);
      }

      // Ensure per-song index directory
      await ensureDir(path.dirname(perSongIndexPath));
    }
  }

  const index: ClipIndex = {
    songSlug,
    generatedAt: new Date().toISOString(),
    fps,
    entries,
  };

  const dataDir = path.join(DATA_CLIP_ROOT, songSlug);
  await ensureDir(dataDir);
  const indexPath = path.join(dataDir, "index.json");
  await fsp.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
  await saveSharedIndex(sharedIndex);
  return index;
};

export const loadClipIndex = async (songSlug: string): Promise<ClipIndex | null> => {
  const indexPath = path.join(DATA_CLIP_ROOT, songSlug, "index.json");
  if (!fs.existsSync(indexPath)) return null;
  try {
    const raw = await fsp.readFile(indexPath, "utf8");
    return JSON.parse(raw) as ClipIndex;
  } catch {
    return null;
  }
};

export const loadSharedClipIndex = async (): Promise<ClipIndex | null> => {
  return loadSharedIndex();
};

export const findMatchingLocalClip = (
  index: ClipIndex | null,
  candidate: { cloudinaryId?: string | null; videoId?: string | null; indexId?: string | null; start?: number; end?: number },
  sharedIndex?: ClipIndex | null
) => {
  const key = buildCandidateKey(candidate);
  const fromShared = sharedIndex ? findMatchingInIndex(sharedIndex, key) : null;
  if (fromShared) return fromShared as any;
  if (!index?.entries?.length) return null;
  return index.entries.find((entry) => entry.candidateId === key) || null;
};
