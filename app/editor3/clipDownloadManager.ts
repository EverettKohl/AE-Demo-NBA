export type DownloadResult = {
  id: string;
  objectUrl: string;
  bytes: number;
  originalUrl: string;
};

const BYTES_PER_GB = 1024 * 1024 * 1024;
const DEFAULT_CAP_BYTES = 2 * BYTES_PER_GB; // 2GB hard cap
const DEFAULT_CONCURRENCY = 4;

type Entry = {
  id: string;
  objectUrl: string;
  bytes: number;
  originalUrl: string;
};

class ClipDownloadManager {
  private entries = new Map<string, Entry>();
  private totalBytes = 0;
  private capBytes: number;

  /**
   * Basic MP4/MOV file signature check. Some Cloudinary downloads come back as
   * application/octet-stream; in that case we still want to accept them if the
   * bytes look like a real MP4 and force the blob type to video/mp4.
   */
  private looksLikeMp4(buffer: ArrayBuffer) {
    if (buffer.byteLength < 12) return false;
    const bytes = new Uint8Array(buffer);
    const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]); // usually "ftyp"
    if (brand !== "ftyp") return false;
    const major = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    const knownBrands = ["isom", "iso2", "mp41", "mp42", "dash", "msnv", "avc1", "m4v "];
    return knownBrands.includes(major) || major.startsWith("mp4");
  }

  constructor(capBytes: number = DEFAULT_CAP_BYTES) {
    this.capBytes = capBytes;
  }

  get usageBytes() {
    return this.totalBytes;
  }

  get capacityBytes() {
    return this.capBytes;
  }

  getUsage() {
    return { usedBytes: this.totalBytes, capacityBytes: this.capBytes };
  }

  clearAll() {
    for (const entry of this.entries.values()) {
      URL.revokeObjectURL(entry.objectUrl);
    }
    this.entries.clear();
    this.totalBytes = 0;
  }

  revoke(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.objectUrl);
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
    this.entries.delete(id);
  }

  async downloadMany(
    items: { id: string; url: string; signal?: AbortSignal }[],
    { concurrency = DEFAULT_CONCURRENCY }: { concurrency?: number } = {}
  ): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];
    let idx = 0;
    const worker = async () => {
      while (idx < items.length) {
        const current = items[idx];
        idx += 1;
        if (current?.signal?.aborted) return;
        const res = await this.download(current.id, current.url, current.signal);
        results.push(res);
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  async download(id: string, url: string, signal?: AbortSignal): Promise<DownloadResult> {
    if (!url) {
      throw new Error("Missing URL for download");
    }
    // If already downloaded for this id, return existing entry.
    const existing = this.entries.get(id);
    if (existing) {
      return { ...existing };
    }

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        }
      });

    const maxAttempts = 12;
    let attempt = 0;
    let lastStatus: number | null = null;
    let res: Response | null = null;

    while (attempt < maxAttempts) {
      if (signal?.aborted) {
        throw new Error("Download aborted");
      }
      attempt += 1;
      try {
        res = await fetch(url, { signal });
        lastStatus = res.status;
        if (res.ok) {
          break;
        }
        if ((res.status === 423 || res.status === 404) && attempt < maxAttempts) {
          const delay = Math.min(4000, 500 * Math.pow(2, attempt - 1));
          // Optionally log the retry to aid debugging of Cloudinary warmup.
          console.warn(`[ClipDownloadManager] Retry ${attempt}/${maxAttempts} after ${res.status} for ${url}`);
          await sleep(delay);
          continue;
        }
        throw new Error(`Failed to download media (${res.status})`);
      } catch (err: any) {
        // If fetch threw due to abort, surface immediately.
        if (signal?.aborted) {
          throw new Error("Download aborted");
        }
        // Network errors: retry with backoff up to maxAttempts.
        if (attempt < maxAttempts) {
          const delay = Math.min(4000, 500 * Math.pow(2, attempt - 1));
          console.warn(`[ClipDownloadManager] Retry ${attempt}/${maxAttempts} after error for ${url}: ${err?.message || err}`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    if (!res || !res.ok) {
      throw new Error(`Failed to download media (${lastStatus ?? "unknown"})`);
    }

    const headerContentType = res.headers.get("content-type") || "";
    let blob = await res.blob();
    let blobType = (blob.type || headerContentType || "").toLowerCase();

    // If the response is mislabeled (e.g., application/octet-stream) but bytes
    // look like MP4, coerce the blob type so downstream video playback succeeds.
    if (!blobType.startsWith("video/")) {
      try {
        const buffer = await blob.arrayBuffer();
        if (this.looksLikeMp4(buffer)) {
          blob = new Blob([buffer], { type: "video/mp4" });
          blobType = "video/mp4";
        }
      } catch {
        /* ignore sniff errors; fall back to existing type */
      }
    }

    const blobSize = blob.size;
    console.info(
      `[ClipDownloadManager] Success ${lastStatus} for ${url} (size=${blobSize}, type=${blobType || "unknown"})`
    );
    if (!blobSize || blobSize <= 0) {
      throw new Error("Downloaded media is empty (0 bytes)");
    }
    const incoming = blob.size;
    if (this.totalBytes + incoming > this.capBytes) {
      throw new Error("Storage limit reached (2GB cap)");
    }

    const objectUrl = URL.createObjectURL(blob);
    const entry: Entry = {
      id,
      objectUrl,
      bytes: incoming,
      originalUrl: url,
    };
    this.entries.set(id, entry);
    this.totalBytes += incoming;
    return { ...entry };
  }
}

let singleton: ClipDownloadManager | null = null;

export const getClipDownloadManager = () => {
  if (!singleton) {
    singleton = new ClipDownloadManager();
    // Clear on hot-reload.
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => singleton?.clearAll());
    }
  }
  return singleton;
};

export const getDownloadUsage = () => {
  const mgr = getClipDownloadManager();
  return mgr.getUsage();
};
