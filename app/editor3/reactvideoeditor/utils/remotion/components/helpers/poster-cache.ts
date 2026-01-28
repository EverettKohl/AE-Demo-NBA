/**
 * Lightweight poster cache for video overlays.
 * - In-memory only; never persisted to disk.
 * - Generates a poster from a decoded frame at a given time using an offscreen video+canvas.
 * - Downscales to a max dimension to keep memory/cpu reasonable.
 * - Capped concurrency to avoid hammering the browser when many clips are present.
 */

const MAX_DIMENSION = 640; // keep posters light
const MAX_CONCURRENT = 3;
const MAX_ENTRIES = 200; // simple cap to avoid unbounded growth

type PosterKey = string;

interface PosterEntry {
  promise: Promise<string | null>; // resolves to data URL or null on failure
}

const cache = new Map<PosterKey, PosterEntry>();

let inFlight = 0;
const queue: Array<() => void> = [];

const runNext = () => {
  if (inFlight >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (next) next();
};

const enqueue = (task: () => Promise<void>) => {
  return new Promise<void>((resolve) => {
    queue.push(() => {
      inFlight++;
      task()
        .catch(() => {
          /* ignore */
        })
        .finally(() => {
          inFlight--;
          runNext();
          resolve();
        });
    });
    runNext();
  });
};

const getKey = (src: string, timeSeconds: number, suffix?: string) =>
  `${src}|${Math.max(0, Math.round(timeSeconds * 1000))}|${suffix || "default"}`;

const evictIfNeeded = () => {
  if (cache.size <= MAX_ENTRIES) return;
  // naive eviction: delete oldest entries
  const keys = Array.from(cache.keys());
  const excess = cache.size - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    cache.delete(keys[i]);
  }
};

export const getPosterForVideoAt = (
  src: string,
  timeSeconds: number = 0,
  keySuffix?: string
): Promise<string | null> => {
  const key = getKey(src, timeSeconds, keySuffix);
  if (cache.has(key)) return cache.get(key)!.promise;

  const promise = new Promise<string | null>((resolve) => {
    enqueue(async () => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.src = src;

      let timeoutId: number | null = null;

      const cleanup = () => {
        if (timeoutId) window.clearTimeout(timeoutId);
        video.src = "";
      };

      const finish = (result: string | null) => {
        cleanup();
        resolve(result);
      };

      const capture = () => {
        const vw = video.videoWidth || 0;
        const vh = video.videoHeight || 0;
        if (!vw || !vh) return finish(null);

        // Downscale to keep memory low
        let targetW = vw;
        let targetH = vh;
        if (vw > vh && vw > MAX_DIMENSION) {
          targetW = MAX_DIMENSION;
          targetH = Math.round((vh / vw) * MAX_DIMENSION);
        } else if (vh >= vw && vh > MAX_DIMENSION) {
          targetH = MAX_DIMENSION;
          targetW = Math.round((vw / vh) * MAX_DIMENSION);
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);

        ctx.drawImage(video, 0, 0, targetW, targetH);
        try {
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          finish(dataUrl);
        } catch {
          finish(null);
        }
      };

      const onLoadedData = () => {
        const duration = video.duration;
        const safeTime = Number.isFinite(duration)
          ? Math.min(Math.max(0, timeSeconds), Math.max(0, duration - 0.001))
          : Math.max(0, timeSeconds);

        if (safeTime > 0) {
          try {
            video.currentTime = safeTime;
          } catch {
            // ignore seek errors
          }
        } else {
          // already at t=0
        }
      };

      const onSeeked = () => {
        // Use requestVideoFrameCallback if available to ensure a decoded frame
        const anyVideo = video as any;
        if (typeof anyVideo.requestVideoFrameCallback === "function") {
          anyVideo.requestVideoFrameCallback(() => {
            requestAnimationFrame(() => capture());
          });
        } else {
          // fallback: next animation frame
          requestAnimationFrame(() => capture());
        }
      };

      const onError = () => finish(null);

      video.addEventListener("loadeddata", onLoadedData, { once: true });
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });

      timeoutId = window.setTimeout(() => finish(null), 5000);

      // Kick off load
      video.load();
    });
  });

  cache.set(key, { promise });
  evictIfNeeded();
  return promise;
};
