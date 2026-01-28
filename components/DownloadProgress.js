import React, { createContext, useContext, useState, useCallback } from "react";
import clsx from "clsx";

const DownloadContext = createContext(null);

export const useDownloadProgress = () => {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error("useDownloadProgress must be used within DownloadProvider");
  }
  return context;
};

export const DownloadProvider = ({ children }) => {
  const [downloads, setDownloads] = useState({});

  const startDownload = useCallback((id, filename) => {
    setDownloads((prev) => ({
      ...prev,
      [id]: {
        id,
        filename,
        progress: 0,
        status: "downloading",
        error: null,
      },
    }));
  }, []);

  const updateProgress = useCallback((id, progress) => {
    setDownloads((prev) => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          progress: Math.min(100, Math.max(0, progress)),
        },
      };
    });
  }, []);

  const completeDownload = useCallback((id) => {
    setDownloads((prev) => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          progress: 100,
          status: "completed",
        },
      };
    });
  }, []);

  const failDownload = useCallback((id, error) => {
    setDownloads((prev) => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          status: "error",
          error: error?.message || "Download failed",
        },
      };
    });
  }, []);

  const removeDownload = useCallback((id) => {
    setDownloads((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return (
    <DownloadContext.Provider
      value={{
        downloads,
        startDownload,
        updateProgress,
        completeDownload,
        failDownload,
        removeDownload,
      }}
    >
      {children}
      <DownloadProgressList />
    </DownloadContext.Provider>
  );
};

const DownloadProgressList = () => {
  const { downloads, removeDownload } = useDownloadProgress();
  const downloadArray = Object.values(downloads);

  if (downloadArray.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {downloadArray.map((download) => (
        <div key={download.id} className="pointer-events-auto">
          <DownloadProgressItem download={download} onRemove={removeDownload} />
        </div>
      ))}
    </div>
  );
};

const DownloadProgressItem = ({ download, onRemove }) => {
  const { id, filename, progress, status, error } = download;

  const getStatusIcon = () => {
    if (status === "completed") {
      return (
        <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    if (status === "error") {
      return (
        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    }
    return <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />;
  };

  const getStatusColor = () => {
    if (status === "completed") return "bg-emerald-500";
    if (status === "error") return "bg-red-500";
    return "bg-indigo-500";
  };

  return (
    <div
      className={clsx(
        "bg-gray-900/95 border rounded-lg shadow-2xl p-4 backdrop-blur-md animate-in slide-in-from-bottom-2",
        status === "error" ? "border-red-500/50" : "border-gray-700"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{getStatusIcon()}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-white truncate" title={filename}>
              {filename}
            </p>
            <button
              onClick={() => onRemove(id)}
              className="flex-shrink-0 text-slate-400 hover:text-white transition-colors ml-2 p-1 rounded hover:bg-gray-800"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {status === "downloading" && (
            <>
              <div className="w-full bg-gray-800 rounded-full h-2.5 mb-2 overflow-hidden">
                <div
                  className={clsx("h-full rounded-full transition-all duration-200 ease-out", getStatusColor())}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-medium">{Math.round(progress)}%</span>
                <span>Downloading...</span>
              </div>
            </>
          )}

          {status === "completed" && <div className="text-xs text-emerald-400 font-medium">✓ Download complete</div>}

          {status === "error" && <div className="text-xs text-red-400 font-medium">✗ {error || "Download failed"}</div>}
        </div>
      </div>
    </div>
  );
};

export default DownloadProgressList;
