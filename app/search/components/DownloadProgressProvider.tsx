"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import clsx from "clsx";

type DownloadStatus = "idle" | "downloading" | "completed" | "error";

type DownloadEntry = {
  id: string;
  filename: string;
  progress: number;
  status: DownloadStatus;
  error?: string | null;
};

type DownloadContextValue = {
  downloads: Record<string, DownloadEntry>;
  startDownload: (id: string, filename: string) => void;
  updateProgress: (id: string, progress: number) => void;
  completeDownload: (id: string) => void;
  failDownload: (id: string, error?: Error | string) => void;
  removeDownload: (id: string) => void;
};

const DownloadContext = createContext<DownloadContextValue | null>(null);

export const useDownloadProgress = () => {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error("useDownloadProgress must be used within DownloadProgressProvider");
  return ctx;
};

export const DownloadProgressProvider = ({ children }: { children: React.ReactNode }) => {
  const [downloads, setDownloads] = useState<Record<string, DownloadEntry>>({});

  const startDownload = useCallback((id: string, filename: string) => {
    setDownloads((prev) => ({
      ...prev,
      [id]: { id, filename, progress: 0, status: "downloading", error: null },
    }));
  }, []);

  const updateProgress = useCallback((id: string, progress: number) => {
    setDownloads((prev) => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: { ...prev[id], progress: Math.max(0, Math.min(100, Math.round(progress))) },
      };
    });
  }, []);

  const completeDownload = useCallback((id: string) => {
    setDownloads((prev) => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: { ...prev[id], progress: 100, status: "completed" },
      };
    });
  }, []);

  const failDownload = useCallback((id: string, error?: Error | string) => {
    setDownloads((prev) => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          status: "error",
          error: typeof error === "string" ? error : error?.message || "Download failed",
        },
      };
    });
  }, []);

  const removeDownload = useCallback((id: string) => {
    setDownloads((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ downloads, startDownload, updateProgress, completeDownload, failDownload, removeDownload }),
    [downloads, startDownload, updateProgress, completeDownload, failDownload, removeDownload]
  );

  return (
    <DownloadContext.Provider value={value}>
      {children}
      <DownloadToastList downloads={downloads} onRemove={removeDownload} />
    </DownloadContext.Provider>
  );
};

const DownloadToastList = ({
  downloads,
  onRemove,
}: {
  downloads: Record<string, DownloadEntry>;
  onRemove: (id: string) => void;
}) => {
  const entries = Object.values(downloads);
  if (!entries.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-3">
      {entries.map((entry) => (
        <div key={entry.id} className="pointer-events-auto">
          <DownloadToast entry={entry} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
};

const DownloadToast = ({ entry, onRemove }: { entry: DownloadEntry; onRemove: (id: string) => void }) => {
  const { id, filename, progress, status, error } = entry;

  const barColor =
    status === "completed" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-indigo-500";

  return (
    <div
      className={clsx(
        "rounded-lg border bg-gray-900/95 p-4 shadow-2xl backdrop-blur",
        status === "error" ? "border-red-500/60" : "border-gray-800"
      )}
    >
      <div className="flex items-start gap-3">
        <StatusIcon status={status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="truncate text-sm font-medium text-white" title={filename}>
              {filename}
            </p>
            <button
              aria-label="Dismiss"
              onClick={() => onRemove(id)}
              className="rounded p-1 text-slate-400 transition hover:bg-gray-800 hover:text-white"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {status === "downloading" && (
            <>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-800">
                <div className={clsx("h-full transition-all duration-150 ease-linear", barColor)} style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                <span>{Math.round(progress)}%</span>
                <span>Downloading…</span>
              </div>
            </>
          )}
          {status === "completed" && <p className="mt-2 text-xs font-medium text-emerald-400">✓ Download complete</p>}
          {status === "error" && <p className="mt-2 text-xs font-medium text-red-400">✗ {error || "Download failed"}</p>}
        </div>
      </div>
    </div>
  );
};

const StatusIcon = ({ status }: { status: DownloadStatus }) => {
  if (status === "completed") {
    return (
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center text-emerald-400">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center text-red-400">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  return (
    <div className="mt-0.5 h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" aria-label="Loading" />
  );
};

