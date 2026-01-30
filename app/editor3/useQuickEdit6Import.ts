"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuickEdit6ImportPayload, QuickEdit6ImportPayload as QE6Payload } from "./quickEdit6Adapter";
import { buildQuickEdit6RveProject } from "./quickEdit6Adapter";
import { getClipDownloadManager } from "./clipDownloadManager";
import { ingestFromBlobUrl } from "./lib/media-ingest";
import { getClipUrl } from "@/utils/cloudinary";

export const QE6_IMPORT_PARAM = "qe6Import";

const readStoredImport = (key: string): QuickEdit6ImportPayload | null => {
  if (typeof window === "undefined" || !key) return null;
  const sources = [window.sessionStorage, window.localStorage];
  for (const store of sources) {
    try {
      const raw = store.getItem(`qe6-import-${key}`);
      if (!raw) continue;
      return JSON.parse(raw) as QuickEdit6ImportPayload;
    } catch (err) {
      console.warn("[useQuickEdit6Import] Failed to parse payload", err);
    }
  }
  return null;
};

export const collectMediaUrls = (payload: QE6Payload | null): string[] => {
  if (!payload) return [];
  const urls = new Set<string>();
  (payload.overlays || []).forEach((o: any) => {
    const src = o?.src;
    if (typeof src === "string" && src.trim()) {
      urls.add(src);
    }
  });
  if (payload.meta?.renderUrl) urls.add(payload.meta.renderUrl);
  if (payload.meta?.songUrl) urls.add(payload.meta.songUrl);
  return Array.from(urls);
};

type LocalizedPayload = QE6Payload | null;

const isMobileUA = () => {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iP(hone|od|ad)/i.test(navigator.userAgent || "");
};

const maybeBuildCloudinaryUrl = (o: any) => {
  const meta = o?.meta || {};
  const cloudinaryId =
    meta.cloudinaryId ||
    meta.videoId ||
    meta.cloudinary_id ||
    meta.cloudinary_video_id ||
    meta.cloudinaryPublicId ||
    null;
  const start = typeof meta.start === "number" ? meta.start : o?.trimStart || 0;
  const end = typeof meta.end === "number" ? meta.end : o?.trimEnd || start;
  if (!cloudinaryId || end <= start) return null;
  try {
    return getClipUrl(cloudinaryId, start, end, { download: false, maxDuration: 600 });
  } catch {
    return null;
  }
};

const downloadAndLocalizeAssets = async (payload: QE6Payload | null, signal?: AbortSignal): Promise<LocalizedPayload> => {
  if (!payload) return payload;
  if (isMobileUA()) {
    throw new Error("This flow is desktop-only (2GB local clip cap).");
  }
  const mgr = getClipDownloadManager();
  const fps = ((payload as any)?.fps as number | undefined) || ((payload?.meta as any)?.fps as number | undefined) || 30;

  // Download overlays (video/audio) and swap to object URLs.
  const overlays = await Promise.all(
    (payload.overlays || []).map(async (o: any, idx: number) => {
      let src = o?.src;
      const overlayType = (o as any)?.type || "overlay";
      const overlayKind =
        overlayType === "sound" || overlayType === "SOUND" || overlayType === 6
          ? "audio"
          : overlayType === "image"
          ? "image"
          : "video";
      if (!src || typeof src !== "string") {
        const fallback = maybeBuildCloudinaryUrl(o);
        if (!fallback) return o;
        src = fallback;
      }

      const id = `${overlayType}-${idx}-${src}`;
      try {
        const { objectUrl, bytes, originalUrl } = await mgr.download(id, src, signal);
        const durationSeconds =
          (o as any)?.mediaSrcDuration ??
          ((o as any)?.durationInFrames && fps ? (o as any).durationInFrames / fps : undefined);
        const ingested = await ingestFromBlobUrl(objectUrl, {
          kind: overlayKind as any,
          durationSeconds,
          name: (o as any)?.name || (o as any)?.content || `${overlayType}-${idx}`,
          thumbnail: (o as any)?.thumbnail,
        });
        URL.revokeObjectURL(objectUrl);
        return {
          ...o,
          src: ingested.blobUrl,
          localMediaId: ingested.localMediaId as any,
          meta: {
            ...(o as any)?.meta,
            originalSrc: originalUrl,
            downloadBytes: bytes,
            localMediaId: ingested.localMediaId,
          },
        };
      } catch (err) {
        // Retry with Cloudinary URL if initial src failed and was not cloudinary-derived.
        const alt = maybeBuildCloudinaryUrl(o);
        if (alt && alt !== src) {
          const { objectUrl, bytes, originalUrl } = await mgr.download(`${overlayType}-${idx}-${alt}`, alt, signal);
          const durationSeconds =
            (o as any)?.mediaSrcDuration ??
            ((o as any)?.durationInFrames && fps ? (o as any).durationInFrames / fps : undefined);
          const ingested = await ingestFromBlobUrl(objectUrl, {
            kind: overlayKind as any,
            durationSeconds,
            name: (o as any)?.name || (o as any)?.content || `${overlayType}-${idx}`,
            thumbnail: (o as any)?.thumbnail,
          });
          URL.revokeObjectURL(objectUrl);
          return {
            ...o,
            src: ingested.blobUrl,
            localMediaId: ingested.localMediaId as any,
            meta: {
              ...(o as any)?.meta,
              originalSrc: originalUrl,
              downloadBytes: bytes,
              localMediaId: ingested.localMediaId,
            },
          };
        }
        throw err;
      }
    })
  );

  // Download song (if present) so playback never streams.
  let songUrl = payload.meta?.songUrl || null;
  if (songUrl && typeof songUrl === "string") {
    const songId = `song-${songUrl}`;
    const { objectUrl, bytes, originalUrl } = await mgr.download(songId, songUrl, signal);
    const ingestedSong = await ingestFromBlobUrl(objectUrl, {
      kind: "audio",
      name: (payload.meta as any)?.songLabel || "Song",
    });
    URL.revokeObjectURL(objectUrl);
    songUrl = ingestedSong.blobUrl;
    const meta = payload.meta ? { ...payload.meta } : {};
    (meta as any).songDownloadBytes = bytes;
    (meta as any).songOriginalUrl = originalUrl;
    (meta as any).songLocalMediaId = ingestedSong.localMediaId;
    payload = { ...payload, meta };
  }

  return { ...payload, overlays, meta: { ...(payload.meta || {}), songUrl } };
};

export const prefetchImportAssets = async (payload: QE6Payload | null, signal?: AbortSignal) => {
  return downloadAndLocalizeAssets(payload, signal);
};

const normalizeSoundSrcs = (payload: QE6Payload | null): QE6Payload | null => {
  if (!payload) return payload;
  const fallback = "/LoveMeAudio.mp3";
  const toPlayable = (src?: string | null) => {
    if (!src) return fallback;
    if (/^https?:\/\//i.test(src)) return src;
    if (typeof window !== "undefined") {
      try {
        return new URL(src.startsWith("/") ? src : `/${src}`, window.location.origin).toString();
      } catch {
        /* ignore */
      }
    }
    return src.startsWith("/") ? src : `/${src}`;
  };
  const overlays = (payload.overlays || []).map((o) => {
    const overlayType = (o as any)?.type;
    if (overlayType === "sound" || overlayType === "SOUND" || overlayType === 6) {
      const src = toPlayable((o as any).src);
      // Keep root-relative/absolute as-is; just ensure volume is set.
      return {
        ...o,
        src,
        styles: {
          ...(o as any).styles,
          volume: 1,
        },
      };
    }
    return o;
  });
  return { ...payload, overlays };
};

export function useQuickEdit6Import(paramName: string = QE6_IMPORT_PARAM): {
  project: QuickEdit6ImportPayload | null;
  loading: boolean;
  error: string | null;
} {
  const [project, setProject] = useState<QuickEdit6ImportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const controller = new AbortController();
    let cancelled = false;
    const searchParams = new URLSearchParams(window.location.search);
    const key = searchParams.get(paramName) || searchParams.get("jobId");
    if (!key) {
      setLoading(false);
      return;
    }

    const loadFresh = async () => {
      try {
        const res = await fetch(`/api/editor-imports/${encodeURIComponent(key)}`);
        if (res.ok) {
          const data = await res.json();
          const appendJobToken = (payload: QE6Payload) => {
            const jobToken = key;
            const overlays = (payload.overlays || []).map((o) => {
              const overlayType = (o as any)?.type;
              if (overlayType === "sound" || overlayType === "SOUND" || overlayType === 6) {
                const rawSrc = (o as any).src || "";
                const withToken =
                  rawSrc && typeof rawSrc === "string" && !rawSrc.includes("?") && jobToken
                    ? `${rawSrc}?job=${encodeURIComponent(jobToken)}`
                    : rawSrc;
                return { ...o, src: withToken };
              }
              return o;
            });
            return { ...payload, overlays };
          };

          if (data?.rveProject) {
            const normalized = appendJobToken(normalizeSoundSrcs(data.rveProject as QE6Payload) as QE6Payload);
            try {
              const localized = await prefetchImportAssets(normalized, controller.signal);
              if (controller.signal.aborted || cancelled) return;
              if (typeof window !== "undefined") {
                try {
                  const payloadStr = JSON.stringify(localized);
                  window.sessionStorage.setItem(`qe6-import-${key}`, payloadStr);
                  window.localStorage.setItem(`qe6-import-${key}`, payloadStr);
                } catch {
                  /* ignore storage errors */
                }
              }
              setProject(localized as any);
              setLoading(false);
              return;
            } catch (err: any) {
              setError(err?.message || "Failed to download clips (2GB limit?)");
              throw err;
            }
          }
          if (data?.plan) {
            const rebuilt = buildQuickEdit6RveProject({
              plan: data.plan,
              jobId: data.jobId || key,
              renderUrl: data.captionedVideoUrl || data.baseVideoUrl || data.videoUrl || null,
              songUrl: data.plan?.songFormat?.source || `/songs/${data.plan?.songSlug || key}.mp3`,
            });
            const normalized = appendJobToken(normalizeSoundSrcs(rebuilt) as QE6Payload);
            try {
              const localized = await prefetchImportAssets(normalized, controller.signal);
              if (controller.signal.aborted || cancelled) return;
              if (typeof window !== "undefined") {
                try {
                  const payloadStr = JSON.stringify(localized);
                  window.sessionStorage.setItem(`qe6-import-${key}`, payloadStr);
                  window.localStorage.setItem(`qe6-import-${key}`, payloadStr);
                } catch {
                  /* ignore storage errors */
                }
              }
              setProject(localized as any);
              setLoading(false);
              return;
            } catch (err: any) {
              setError(err?.message || "Failed to download clips (2GB limit?)");
              throw err;
            }
          }
        }
        // fallback to stored payload if server unavailable
        const parsed = readStoredImport(key);
        if (parsed) {
          const normalized = normalizeSoundSrcs(parsed);
          try {
            const localized = await prefetchImportAssets(normalized, controller.signal);
            if (controller.signal.aborted || cancelled) return;
            setProject(localized as any);
          } catch (err: any) {
            setError(err?.message || "Failed to download cached clips");
            throw err;
          }
        }
      } catch (err) {
        console.warn("[useQuickEdit6Import] Failed to load import", err);
        setError((err as any)?.message || "Failed to load import");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadFresh();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [paramName]);

  return useMemo(
    () => ({
      project,
      loading,
      error,
    }),
    [project, loading, error]
  );
}
