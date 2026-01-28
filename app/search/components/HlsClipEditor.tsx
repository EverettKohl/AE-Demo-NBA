"use client";

import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import HlsPlayer from "./HlsPlayer";
import { ClipTimeline } from "./ClipTimeline";
import { clampSeconds, formatSeconds, roundSeconds, validateClipRange } from "../utils/time";
import { useDownloadProgress } from "./DownloadProgressProvider";
import { processVideoClip } from "@/utils/videoProcesso.js";

type Props = {
  open: boolean;
  onClose: () => void;
  hlsUrl: string;
  start: number;
  end: number;
  videoDuration?: number | null;
};

const MAX_DURATION = 180;

export const HlsClipEditor: React.FC<Props> = ({ open, onClose, hlsUrl, start, end, videoDuration }) => {
  const [clipStart, setClipStart] = useState(start);
  const [clipEnd, setClipEnd] = useState(end);
  const [playhead, setPlayhead] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const { startDownload, updateProgress, completeDownload, failDownload } = useDownloadProgress();
  const [seekTarget, setSeekTarget] = useState<number | null>(start);
  const [enforceSelectionStop, setEnforceSelectionStop] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClipStart(start);
    setClipEnd(end);
    setPlayhead(start);
    setPlaying(false);
  }, [open, start, end]);

  // Spacebar play/pause
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handler, { passive: false });
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const [windowStart, setWindowStart] = useState(() => Math.max(0, start - 5));
  const [windowEnd, setWindowEnd] = useState(() => {
    const tentative = end + 5;
    if (videoDuration) return Math.min(videoDuration, tentative);
    return tentative;
  });

  useEffect(() => {
    if (!open) return;
    const ws = Math.max(0, start - 5);
    const we = (() => {
      const tentative = end + 5;
      if (videoDuration) return Math.min(videoDuration, tentative);
      return tentative;
    })();
    setWindowStart(ws);
    setWindowEnd(we);
  }, [open, start, end, videoDuration]);

  useEffect(() => {
    const v = validateClipRange(clipStart, clipEnd, { maxDuration: MAX_DURATION });
    setError(v.ok ? null : v.message);
  }, [clipStart, clipEnd]);

  if (!open) return null;

  const onDownload = async () => {
    const validation = validateClipRange(clipStart, clipEnd, { maxDuration: MAX_DURATION });
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    const filename = `clip_${Math.floor(clipStart)}s-${Math.floor(clipEnd)}s.mp4`;
    const downloadId = `${filename}-${Date.now()}`;
    startDownload(downloadId, filename);
    setIsDownloading(true);
    try {
      if (typeof SharedArrayBuffer === "undefined") {
        throw new Error("Cannot trim HLS in this context (SharedArrayBuffer unavailable). Please retry over HTTPS/secure context.");
      }
      const blob = await processVideoClip(hlsUrl, clipStart, clipEnd, (p) => updateProgress(downloadId, p));
      triggerDownload(blob, filename);
      completeDownload(downloadId);
    } catch (err) {
      failDownload(downloadId, err instanceof Error ? err : String(err));
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <div className="flex h-full flex-col bg-gray-950">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setPlaying(false);
                onClose();
              }}
              className="flex items-center gap-2 text-slate-300 transition hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Back</span>
            </button>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-white">HLS Clip Editor</h1>
              <p className="mt-0.5 text-xs text-slate-400">Play and trim from the HLS stream</p>
            </div>
            <div className="w-24" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-center justify-center bg-black px-4 py-3">
            <div className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-gray-800 bg-black" style={{ aspectRatio: "16 / 9" }}>
              <HlsPlayer
                hlsUrl={hlsUrl}
                startTime={clipStart}
                endTime={clipEnd}
                playing={playing}
                seekTime={seekTarget}
                stopAtEnd={enforceSelectionStop}
                muted={false}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(t) => setPlayhead(t)}
              />
            </div>
          </div>

          <div className="border-t border-gray-800 bg-gray-900 px-6 py-5">
            <div className="mx-auto max-w-5xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <div className="flex items-center gap-2 text-sm text-white">
                  <button
                  onClick={() => {
                    setEnforceSelectionStop(false);
                    setPlaying((p) => !p);
                  }}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-500"
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    {playing ? (
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                      </svg>
                    ) : (
                      <svg className="ml-0.5 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  <button
                  onClick={() => {
                    setPlayhead(clipStart);
                    setSeekTarget(clipStart);
                    setEnforceSelectionStop(true);
                    setPlaying(true);
                  }}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-500"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                    Start
                  </button>
                  <div className="text-xs text-slate-400">
                    Playhead <span className="ml-1 font-semibold text-white">{formatSeconds(playhead)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>Clip {formatSeconds(clipStart)}–{formatSeconds(clipEnd)}</span>
                  <span>Window {formatSeconds(windowStart)}–{formatSeconds(windowEnd)}</span>
                </div>
              </div>

              <ClipTimeline
                playhead={playhead}
                setPlayhead={(v) => {
                  setPlayhead(v);
                  setSeekTarget(v);
                  setEnforceSelectionStop(false);
                  setPlaying(true);
                }}
                windowStart={windowStart}
                windowEnd={windowEnd}
                clipStart={clipStart}
                clipEnd={clipEnd}
                onChangeStart={(v) => setClipStart(clampSeconds(v, 0, clipEnd - 0.1))}
                onChangeEnd={(v) => setClipEnd(clampSeconds(v, clipStart + 0.1, windowEnd))}
                onScrubStart={() => setPlaying(false)}
                onScrubEnd={() => setPlaying(true)}
                onTrackClick={(t) => {
                  setPlayhead(t);
                  setSeekTarget(t);
                  setEnforceSelectionStop(false);
                  setPlaying(true);
                }}
              />

              <div className="grid grid-cols-2 gap-3">
                <LabeledInput
                  label="Start (s)"
                  value={clipStart}
                  min={0}
                  max={Math.max(0, clipEnd - 0.1)}
                  step={0.1}
                  onChange={(val) => setClipStart(roundSeconds(val))}
                />
                <LabeledInput
                  label="End (s)"
                  value={clipEnd}
                  min={clipStart + 0.1}
                  max={windowEnd}
                  step={0.1}
                  onChange={(val) => setClipEnd(roundSeconds(val))}
                />
              </div>

              {error && <div className="rounded-md border border-red-500/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}

              <div className="flex items-center justify-between gap-3">
                <div className="px-4 py-2 rounded-lg border border-gray-700 bg-gray-800/50 text-sm text-white">
                  Duration: <span className="font-semibold">{formatSeconds(clipEnd - clipStart)}</span>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setPlaying(false);
                      onClose();
                    }}
                    className="rounded-lg border border-gray-700 px-5 py-2 text-sm font-medium text-slate-200 transition hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onDownload}
                    disabled={isDownloading || Boolean(error)}
                    className={clsx(
                      "rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-500",
                      "disabled:cursor-not-allowed disabled:opacity-60"
                    )}
                  >
                    {isDownloading ? "Preparing..." : "Download"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
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
      value={value}
      min={min}
      max={max}
      step={step ?? 0.1}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
    />
  </label>
);

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
};

