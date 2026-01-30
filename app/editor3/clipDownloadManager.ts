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

    const res = await fetch(url, { signal, cache: "force-cache" });
    if (!res.ok) {
      throw new Error(`Failed to download media (${res.status})`);
    }
    const blob = await res.blob();
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
