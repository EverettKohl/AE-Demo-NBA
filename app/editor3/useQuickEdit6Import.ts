"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuickEdit6ImportPayload, QuickEdit6ImportPayload as QE6Payload } from "./quickEdit6Adapter";
import { buildQuickEdit6RveProject } from "./quickEdit6Adapter";

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

const hasSoundOverlay = (payload: QuickEdit6ImportPayload | null) =>
  Boolean(payload?.overlays?.some((o: any) => o?.type === "sound" || o?.type === "SOUND" || o?.type === 6));

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

const fetchWithTimeout = async (
  url: string,
  { timeoutMs = 15000, signal }: { timeoutMs?: number; signal?: AbortSignal }
) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    const res = await fetch(url, { cache: "force-cache", signal: controller.signal });
    if (res.ok) {
      // Fully read the body so the response is cached before playback.
      await res.arrayBuffer();
    }
  } catch {
    // Swallow errors; prefetch best-effort.
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
};

const prefetchUrls = async (
  urls: string[],
  { concurrency = 8, signal }: { concurrency?: number; signal?: AbortSignal }
) => {
  if (!urls.length) return;
  let index = 0;
  const worker = async () => {
    while (index < urls.length) {
      const current = urls[index];
      index += 1;
      if (signal?.aborted) return;
      await fetchWithTimeout(current, { timeoutMs: 20000, signal });
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
};

export const prefetchImportAssets = async (payload: QE6Payload | null, signal?: AbortSignal) => {
  const urls = collectMediaUrls(payload);
  await prefetchUrls(urls, { concurrency: 6, signal });
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
} {
  const [project, setProject] = useState<QuickEdit6ImportPayload | null>(null);
  const [loading, setLoading] = useState(true);

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
            await prefetchImportAssets(normalized, controller.signal);
            if (controller.signal.aborted || cancelled) return;
            if (typeof window !== "undefined") {
              try {
                const payloadStr = JSON.stringify(normalized);
                window.sessionStorage.setItem(`qe6-import-${key}`, payloadStr);
                window.localStorage.setItem(`qe6-import-${key}`, payloadStr);
              } catch {
                /* ignore storage errors */
              }
            }
            setProject(normalized);
            setLoading(false);
            return;
          }
          if (data?.plan) {
            const rebuilt = buildQuickEdit6RveProject({
              plan: data.plan,
              jobId: data.jobId || key,
              renderUrl: data.captionedVideoUrl || data.baseVideoUrl || data.videoUrl || null,
              songUrl: data.plan?.songFormat?.source || `/songs/${data.plan?.songSlug || key}.mp3`,
            });
            const normalized = appendJobToken(normalizeSoundSrcs(rebuilt) as QE6Payload);
            await prefetchImportAssets(normalized, controller.signal);
            if (controller.signal.aborted || cancelled) return;
            if (typeof window !== "undefined") {
              try {
                const payloadStr = JSON.stringify(normalized);
                window.sessionStorage.setItem(`qe6-import-${key}`, payloadStr);
                window.localStorage.setItem(`qe6-import-${key}`, payloadStr);
              } catch {
                /* ignore storage errors */
              }
            }
            setProject(normalized);
            setLoading(false);
            return;
          }
        }
        // fallback to stored payload if server unavailable
        const parsed = readStoredImport(key);
        if (parsed) {
          const normalized = normalizeSoundSrcs(parsed);
          await prefetchImportAssets(normalized, controller.signal);
          if (controller.signal.aborted || cancelled) return;
          setProject(normalized);
        }
      } catch (err) {
        console.warn("[useQuickEdit6Import] Failed to load import", err);
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
    }),
    [project, loading]
  );
}
