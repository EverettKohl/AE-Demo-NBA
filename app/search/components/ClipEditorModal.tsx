"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import HlsClipPlayer from "./HlsClipPlayer";
import { buildCloudinaryRangeUrl } from "../utils/cloudinaryRange";
import { formatSeconds, validateClipRange, clampSeconds, roundSeconds } from "../utils/time";
import { trimClipToBlob } from "../utils/ffmpegClipper";
import { useDownloadProgress } from "./DownloadProgressProvider";

export type ClipEditorModalProps = {
  open: boolean;
  title?: string;
  hlsUrl?: string | null;
  mp4Url?: string | null;
  publicId?: string | null;
  cloudName?: string | null;
  initialStart: number;
  initialEnd: number;
  videoDuration?: number | null;
  onClose: () => void;
};

const MAX_DURATION = 180;

const ClipEditorModal: React.FC<ClipEditorModalProps> = ({
  open,
  title = "Edit & Download",
  hlsUrl,
  mp4Url,
  publicId,
  cloudName,
  initialStart,
  initialEnd,
  videoDuration,
  onClose,
}) => {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [playhead, setPlayhead] = useState(initialStart);
  const [isUserSeeking, setIsUserSeeking] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { startDownload, updateProgress, completeDownload, failDownload } = useDownloadProgress();

  useEffect(() => {
    if (open) {
      setStart(initialStart);
      setEnd(initialEnd);
      setError(null);
      setPlaying(true);
      setPlayhead(initialStart);
      setIsUserSeeking(false);
    }
  }, [open, initialStart, initialEnd]);

  const duration = useMemo(() => end - start, [start, end]);
  const maxEnd = videoDuration ?? Math.max(initialEnd, initialStart + 1);

  // Preview window: load +/- 90s around the clip where possible
  const previewStart = useMemo(() => Math.max(0, start - 90), [start]);
  const previewEnd = useMemo(() => {
    const tentative = end + 90;
    if (videoDuration) return Math.min(videoDuration, tentative);
    return tentative;
  }, [end, videoDuration]);

  // Keyboard nudges
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setStart((prev) => Math.max(0, roundSeconds(prev - 0.25)));
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setStart((prev) => roundSeconds(prev + 0.25));
        }
      }
      if (e.altKey) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setEnd((prev) => Math.max(start + 0.1, roundSeconds(prev - 0.25)));
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setEnd((prev) => roundSeconds(Math.min(maxEnd, prev + 0.25)));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, maxEnd, start]);

  useEffect(() => {
    const validation = validateClipRange(start, end, { maxDuration: MAX_DURATION });
    setError(validation.ok ? null : validation.message);
  }, [start, end]);

  if (!open) return null;

  const handleStartChange = (value: number) => {
    const next = clampSeconds(value, 0, Math.max(0, end - 0.1));
    setStart(next);
    if (next >= end) setEnd(next + 0.1);
  };

  const handleEndChange = (value: number) => {
    const next = clampSeconds(value, start + 0.1, maxEnd || Infinity);
    setEnd(next);
  };

  const handleDownload = async () => {
    const validation = validateClipRange(start, end, { maxDuration: MAX_DURATION });
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    const filename = `clip_${Math.floor(start)}s-${Math.floor(end)}s.mp4`;
    const downloadId = `${filename}-${Date.now()}`;

    try {
      setIsDownloading(true);
      startDownload(downloadId, filename);

      // Try deterministic Cloudinary URL first
      const cloudUrl = buildCloudinaryRangeUrl({
        cloudName,
        publicId,
        start,
        end,
        maxDuration: MAX_DURATION,
      });

      if (cloudUrl) {
        updateProgress(downloadId, 15);
        const res = await fetch(cloudUrl);
        if (!res.ok) throw new Error(`Cloudinary request failed (${res.status})`);
        const blob = await res.blob();
        triggerBrowserDownload(blob, filename);
        completeDownload(downloadId);
        return;
      }

      // FFmpeg fallback (HLS preferred)
      const sourceUrl = hlsUrl || mp4Url;
      if (!sourceUrl) throw new Error("No playable source URL available for trimming.");

      const { blob } = await trimClipToBlob({
        sourceUrl,
        start,
        end,
        filename,
        onProgress: (p) => updateProgress(downloadId, p),
      });
      triggerBrowserDownload(blob, filename);
      completeDownload(downloadId);
    } catch (err) {
      failDownload(downloadId, err instanceof Error ? err : String(err));
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur">
      <div
        ref={containerRef}
        className="relative flex w-full max-w-6xl flex-col gap-5 rounded-2xl border border-gray-800 bg-gray-950 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-400">Clip Editor</p>
            <h3 className="text-xl font-bold text-white">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 transition hover:bg-gray-800 hover:text-white"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex justify-center">
            <div className="aspect-video w-full max-w-5xl overflow-hidden rounded-2xl border border-gray-800 bg-[#0d1117] shadow-inner">
              <HlsClipPlayer
                hlsUrl={hlsUrl ?? undefined}
                mp4Url={mp4Url ?? undefined}
                poster={undefined}
                startTime={previewStart}
                endTime={previewEnd}
                stopTime={previewEnd}
                seekTime={playhead}
                playing={playing}
                muted={false}
                onRequestPlay={() => setPlaying(true)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(t) => {
                  if (!isUserSeeking) {
                    setPlayhead(t);
                  }
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-gray-800/80 bg-gray-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-600 text-white shadow hover:bg-indigo-700 transition"
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="font-semibold text-white">{formatSeconds(playhead)}</span>
                  <span className="text-slate-500">/</span>
                  <span className="text-slate-400">{formatSeconds(previewEnd - previewStart)}</span>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Clip {formatSeconds(start)}–{formatSeconds(end)} (max 3:00) • Window {formatSeconds(previewStart)}–{formatSeconds(previewEnd)}
              </div>
            </div>

            <Timeline
              playhead={playhead}
              setPlayhead={(val) => {
                setPlayhead(val);
                setPlaying(true);
              }}
              setUserSeeking={setIsUserSeeking}
              windowStart={previewStart}
              windowEnd={previewEnd}
              clipStart={start}
              clipEnd={end}
              onChangeStart={handleStartChange}
              onChangeEnd={handleEndChange}
              onScrubStart={() => setPlaying(false)}
              setPlaying={setPlaying}
            />

            <div className="grid grid-cols-2 gap-3">
              <LabeledInput
                label="Start (s)"
                value={start}
                min={0}
                max={Math.max(0, end - 0.1)}
                step={0.1}
                onChange={(val) => handleStartChange(Number(val))}
              />
              <LabeledInput
                label="End (s)"
                value={end}
                min={start + 0.1}
                max={maxEnd || undefined}
                step={0.1}
                onChange={(val) => handleEndChange(Number(val))}
              />
            </div>

            {error && <div className="rounded-md border border-red-500/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  onClose();
                }}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading || Boolean(error)}
                className={clsx(
                  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition",
                  "hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                {isDownloading ? "Preparing..." : "Download Clip"}
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Tip: Cmd/Ctrl + arrows nudges start, Alt + arrows nudges end. HLS is preferred; MP4 fallback will be used if HLS is unavailable.
        </p>
      </div>
    </div>
  );
};

const LabeledInput = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) => (
  <label className="flex flex-col gap-1 text-sm text-slate-200">
    {label}
    <input
      type="number"
      step={step ?? 0.1}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
    />
  </label>
);

const Timeline = ({
  playhead,
  setPlayhead,
  setUserSeeking,
  windowStart,
  windowEnd,
  clipStart,
  clipEnd,
  onChangeStart,
  onChangeEnd,
  onScrubStart,
  setPlaying,
}: {
  playhead: number;
  setPlayhead: (value: number) => void;
  setUserSeeking: (val: boolean) => void;
  windowStart: number;
  windowEnd: number;
  clipStart: number;
  clipEnd: number;
  onChangeStart: (value: number) => void;
  onChangeEnd: (value: number) => void;
  onScrubStart: () => void;
  setPlaying: (val: boolean) => void;
}) => {
  const duration = Math.max(windowEnd - windowStart, 1);
  const startPct = Math.max(0, Math.min(100, ((clipStart - windowStart) / duration) * 100));
  const endPct = Math.max(startPct, Math.min(100, ((clipEnd - windowStart) / duration) * 100));
  const playheadPct = Math.max(0, Math.min(100, ((playhead - windowStart) / duration) * 100));

  return (
    <div className="space-y-3">
      <div className="relative h-14 rounded-lg bg-gray-900/80 px-3 py-3 shadow-inner border border-gray-800/60">
        <div className="relative h-2 rounded-full bg-gray-800/80">
          <div
            className="absolute left-0 top-0 h-2 rounded-full bg-linear-to-r from-amber-400 to-amber-500"
            style={{ left: `${startPct}%`, width: `${Math.max(2, endPct - startPct)}%` }}
          />
          <div
            className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-white shadow-lg"
            style={{ left: `${playheadPct}%` }}
          />
          <Handle percent={startPct} label="Start" onMouseDown={onScrubStart} />
          <Handle percent={endPct} label="End" onMouseDown={onScrubStart} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
        <span>Window: {formatSeconds(windowStart)}</span>
        <span className="text-center">Playhead: {formatSeconds(playhead)}</span>
        <span className="text-right">Window end: {formatSeconds(windowEnd)}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs text-slate-500">
        <input
          type="range"
          min={windowStart}
          max={windowEnd}
          step={0.1}
          value={playhead}
          onMouseDown={onScrubStart}
          onChange={(e) => {
            const val = Number(e.target.value);
            setPlayhead(val);
          }}
          onMouseUp={() => {
            setPlaying(true);
          }}
          className="w-full accent-amber-300"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="range"
            min={windowStart}
            max={windowEnd}
            step={0.1}
            value={clipStart}
            onMouseDown={onScrubStart}
            onChange={(e) => onChangeStart(Number(e.target.value))}
            className="w-full accent-indigo-400"
          />
          <input
            type="range"
            min={windowStart}
            max={windowEnd}
            step={0.1}
            value={clipEnd}
            onMouseDown={onScrubStart}
            onChange={(e) => onChangeEnd(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>
      </div>
    </div>
  );
};

const Handle = ({ percent, label, onMouseDown }: { percent: number; label: string; onMouseDown: () => void }) => (
  <div
    className="absolute -top-1 h-4 w-4 -translate-x-1/2 cursor-pointer rounded-full border border-white/70 bg-white shadow-lg transition hover:scale-110"
    style={{ left: `${percent}%` }}
    title={label}
    onMouseDown={onMouseDown}
  />
);

const triggerBrowserDownload = (blob: Blob, filename: string) => {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
};

export default ClipEditorModal;

