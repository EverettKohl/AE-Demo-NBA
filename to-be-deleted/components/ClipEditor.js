import React, { useEffect, useMemo, useState } from "react";
import ReactPlayer from "react-player";
import HLSVideoPlayer from "@/components/HLSVideoPlayer";
import clsx from "clsx";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatTime = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "0:00";
  const whole = Math.max(0, Math.floor(value));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

/**
 * Lightweight clip editor used by search results adjust modal.
 * Provides simple start/end trimming, validation, and download/save callbacks.
 */
const ClipEditor = ({
  clip,
  videoDetail,
  previewUrl,
  initialStart = 0,
  initialEnd = 5,
  videoDuration,
  onDownload,
  onCancel,
  getCustomCloudinaryUrl, // unused here but kept for compatibility
  isPart1 = false, // unused flag for compatibility
  fixedDuration = null,
  fixedDurationTolerance = null,
  onSave = null,
  previewWindowDuration,
  previewWindowOverride,
  aspectRatio = 16 / 9,
}) => {
  const fallbackDuration =
    videoDuration ||
    videoDetail?.system_metadata?.duration ||
    videoDetail?.duration ||
    clip?.videoDetail?.system_metadata?.duration ||
    clip?.videoDetail?.duration ||
    clip?.duration ||
    180;

  const [start, setStart] = useState(Math.max(0, initialStart));
  const [end, setEnd] = useState(Math.min(fallbackDuration, Math.max(initialEnd, initialStart + 1)));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  useEffect(() => {
    setStart((prev) => clamp(prev, 0, Math.max(0, fallbackDuration - 0.1)));
    setEnd((prev) => clamp(prev, 0.1, fallbackDuration));
  }, [fallbackDuration]);

  const duration = useMemo(() => end - start, [start, end]);

  const sourceUrl =
    previewUrl ||
    clip?.clipUrl ||
    clip?.previewUrl ||
    videoDetail?.hls?.video_url ||
    clip?.videoDetail?.hls?.video_url ||
    clip?.videoDetail?.video_url ||
    clip?.videoDetail?.url ||
    null;

  const hlsUrl =
    videoDetail?.hls?.video_url ||
    clip?.videoDetail?.hls?.video_url ||
    (typeof sourceUrl === "string" && sourceUrl.includes(".m3u8") ? sourceUrl : null);

  const thumbnailUrl =
    clip?.thumbnail_url ||
    clip?.thumbnailUrl ||
    videoDetail?.thumbnail_url ||
    clip?.videoDetail?.thumbnail_url ||
    null;

  const validate = () => {
    if (start < 0) return "Start time cannot be negative";
    if (end <= start) return "End time must be greater than start";
    if (duration > 180) return "Clip length is limited to 3 minutes";
    if (duration <= 0) return "Clip duration must be positive";
    if (fixedDuration !== null) {
      const tolerance = fixedDurationTolerance ?? 0.25;
      const diff = Math.abs(duration - fixedDuration);
      if (diff > tolerance) {
        return `Clip must be ${fixedDuration}s (±${tolerance}s)`;
      }
    }
    return null;
  };

  const onChangeStart = (value) => {
    const next = clamp(Number(value) || 0, 0, end - 0.1);
    setStart(next);
    if (next >= end) {
      setEnd(next + 0.1);
    }
  };

  const onChangeEnd = (value) => {
    const next = clamp(Number(value) || 0, start + 0.1, fallbackDuration);
    setEnd(next);
  };

  const handleDownload = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (!onDownload) return;
    try {
      setLoading(true);
      setError(null);
      await onDownload(start, end);
    } catch (err) {
      setError(err?.message || "Download failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (!onSave) return;
    try {
      setLoading(true);
      setError(null);
      await onSave(start, end);
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="aspect-video w-full bg-black/80 rounded-xl overflow-hidden border border-gray-800">
        {hlsUrl ? (
          <HLSVideoPlayer
            hlsUrl={hlsUrl}
            thumbnailUrl={thumbnailUrl}
            startTime={start}
            endTime={end}
            isPlaying={isPreviewPlaying}
            muted={false}
            onPlay={() => setIsPreviewPlaying(true)}
            onPause={() => setIsPreviewPlaying(false)}
            onEnded={() => setIsPreviewPlaying(false)}
          />
        ) : sourceUrl ? (
          <ReactPlayer
            url={sourceUrl}
            controls
            playing={isPreviewPlaying}
            width="100%"
            height="100%"
            onPlay={() => setIsPreviewPlaying(true)}
            onPause={() => setIsPreviewPlaying(false)}
            onEnded={() => setIsPreviewPlaying(false)}
            config={{
              file: {
                attributes: {
                  controlsList: "nodownload",
                },
              },
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">No preview available</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-200">
          Start (s)
          <input
            type="number"
            step="0.1"
            min={0}
            max={Math.max(0, end - 0.1)}
            value={start}
            onChange={(e) => onChangeStart(e.target.value)}
            className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-200">
          End (s)
          <input
            type="number"
            step="0.1"
            min={start + 0.1}
            max={fallbackDuration}
            value={end}
            onChange={(e) => onChangeEnd(e.target.value)}
            className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100">{formatTime(start)}</span>
          <span className="text-slate-500">to</span>
          <span className="font-semibold text-slate-100">{formatTime(end)}</span>
          <span className="text-slate-500">({formatTime(duration)} total)</span>
        </div>
        <div className="text-xs text-slate-500">
          Max 3:00 • Video length {formatTime(fallbackDuration)}
          {fixedDuration !== null ? ` • Target ${fixedDuration}s` : ""}
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div>}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        {onSave && (
          <button
            type="button"
            onClick={handleSave}
            className={clsx(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              "border border-indigo-500 text-indigo-100 hover:bg-indigo-600/20"
            )}
            disabled={loading}
          >
            {loading ? "Saving..." : "Save"}
          </button>
        )}
        {onDownload && (
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Preparing..." : "Download clip"}
          </button>
        )}
      </div>
    </div>
  );
};

export default ClipEditor;
