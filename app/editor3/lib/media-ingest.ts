import { addMediaItem, getMediaItem, type UserMediaItem } from "@/app/reactvideoeditor/pro/utils/general/indexdb";
import { getUserId } from "@/app/reactvideoeditor/pro/utils/general/user-id";
import { generateThumbnail, getMediaDuration } from "@/app/reactvideoeditor/pro/utils/general/media-upload";

type MediaKind = "video" | "audio" | "image";

export type IngestResult = {
  localMediaId: string;
  blobUrl: string;
  bytes: number;
  durationSeconds?: number;
  thumbnail?: string | null;
  mimeType?: string;
  kind: MediaKind;
};

type CommonIngestOptions = {
  name?: string;
  kind?: MediaKind;
  durationSeconds?: number;
  thumbnail?: string | null;
  generateThumbnail?: boolean; // default true; set false to skip thumbnail work
};

const inferKind = (blob: Blob, hint?: MediaKind): MediaKind => {
  if (hint) return hint;
  const mime = blob.type || "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "video";
};

const ensureDuration = async (blob: Blob, kind: MediaKind, hint?: number) => {
  if (typeof hint === "number" && Number.isFinite(hint)) return hint;
  if (kind === "video" || kind === "audio") {
    try {
      const val = await getMediaDuration(new File([blob], "media"));
      if (Number.isFinite(val)) return val;
    } catch {
      /* ignore */
    }
  }
  return undefined;
};

const ensureThumbnail = async (blob: Blob, kind: MediaKind, hint?: string | null, shouldGenerate = true) => {
  if (typeof hint === "string") return hint;
  if (!shouldGenerate) return undefined;
  if (kind === "video" || kind === "image") {
    try {
      const thumb = await generateThumbnail(new File([blob], "thumb", { type: blob.type }));
      return thumb || undefined;
    } catch {
      /* ignore */
    }
  }
  return undefined;
};

const storeBlob = async (blob: Blob, opts: CommonIngestOptions = {}): Promise<IngestResult> => {
  const kind = inferKind(blob, opts.kind);
  const duration = await ensureDuration(blob, kind, opts.durationSeconds);
  const thumbnail = await ensureThumbnail(blob, kind, opts.thumbnail, opts.generateThumbnail ?? true);
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const userId = getUserId();
  const now = Date.now();

  const item: UserMediaItem = {
    id,
    userId,
    name: opts.name || `media-${id}`,
    type: kind,
    serverPath: "",
    size: blob.size,
    lastModified: now,
    thumbnail: thumbnail || "",
    duration: duration ?? undefined,
    createdAt: now,
    fileBlob: blob,
  };

  await addMediaItem(item);
  const blobUrl = URL.createObjectURL(blob);

  return {
    localMediaId: id,
    blobUrl,
    bytes: blob.size,
    durationSeconds: duration,
    thumbnail: thumbnail || null,
    mimeType: blob.type || undefined,
    kind,
  };
};

export const ingestFromUrl = async (
  url: string,
  opts: CommonIngestOptions = {},
  signal?: AbortSignal
): Promise<IngestResult> => {
  const res = await fetch(url, { signal, cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`Failed to download media (${res.status})`);
  }
  const blob = await res.blob();
  return storeBlob(blob, opts);
};

export const ingestFromBlobUrl = async (
  blobUrl: string,
  opts: CommonIngestOptions = {},
  signal?: AbortSignal
): Promise<IngestResult> => {
  const res = await fetch(blobUrl, { signal });
  if (!res.ok) throw new Error(`Failed to read blob URL (${res.status})`);
  const blob = await res.blob();
  return storeBlob(blob, opts);
};

export const ingestFromFile = async (file: File, opts: CommonIngestOptions = {}): Promise<IngestResult> => {
  return storeBlob(file, { ...opts, kind: inferKind(file, opts.kind), durationSeconds: opts.durationSeconds });
};

export const rehydrateMediaById = async (localMediaId?: string | null): Promise<string | null> => {
  if (!localMediaId) return null;
  const item = await getMediaItem(localMediaId);
  if (!item?.fileBlob) return null;
  return URL.createObjectURL(item.fileBlob);
};
