"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ClipTimeline } from "./ClipTimeline";
import { clampSeconds, formatSeconds, roundSeconds, validateClipRange } from "../utils/time";
import { useDownloadProgress } from "./DownloadProgressProvider";
import { getClipPreviewUrl, getClipDownloadUrl, normalizeCloudinaryPublicId, getOptimalClipUrl } from "@/utils/cloudinary";
import { processVideoClip } from "@/utils/videoProcesso.js";

type Props = {
  open: boolean;
  onClose: () => void;
  publicId?: string | null;
  mp4Url?: string | null;
  hlsUrl?: string | null;
  thumbnail?: string | null;
  start: number;
  end: number;
  videoDuration?: number | null;
  portalSelector?: string; // optional DOM selector to render inside a specific container
  playbackUrlOverride?: string | null;
  previewStartOverride?: number | null;
  previewEndOverride?: number | null;
  onAddToTimeline?: (payload: {
    blobUrl: string;
    durationSeconds: number;
    startSeconds: number;
    endSeconds: number;
    cloudinaryPublicId?: string | null;
    mainCloudinaryPublicId?: string | null;
    filename: string;
    thumbnail?: string | null;
  }) => Promise<void> | void;
};

const MAX_DURATION = 180;

export const CloudinaryClipEditor: React.FC<Props> = ({
  open,
  onClose,
  publicId,
  mp4Url,
  hlsUrl,
  thumbnail,
  start,
  end,
  videoDuration,
  portalSelector,
  playbackUrlOverride,
  previewStartOverride,
  previewEndOverride,
  onAddToTimeline,
}) => {
  const [clipStart, setClipStart] = useState(start);
  const [clipEnd, setClipEnd] = useState(end);
  const [playhead, setPlayhead] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const { startDownload, updateProgress, completeDownload, failDownload } = useDownloadProgress();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [enforceSelectionStop, setEnforceSelectionStop] = useState(false);
  const [playSelectedOnce, setPlaySelectedOnce] = useState(false);
  const togglePlay = () => {
    setEnforceSelectionStop(false);
    setPlaySelectedOnce(false);
    const el = videoRef.current;
    if (!el) {
      setPlaying((p) => !p);
      return;
    }
    if (el.paused) {
      el.play().catch(() => {});
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [playing]);

  useEffect(() => {
    if (!open) return;
    setClipStart(start);
    setClipEnd(end);
    setPlayhead(start);
    setPlaying(false);
  }, [open, start, end]);

  const normalizedId = useMemo(() => normalizeCloudinaryPublicId(publicId || ""), [publicId]);

  const optimal = useMemo(() => {
    if (!normalizedId) return null;
    try {
      return getOptimalClipUrl(normalizedId, clipStart, clipEnd);
    } catch {
      return null;
    }
  }, [normalizedId, clipStart, clipEnd]);

  const playbackUrl = useMemo(() => {
    if (playbackUrlOverride) return playbackUrlOverride;
    if (optimal?.url) return optimal.url;
    if (normalizedId) {
      try {
        return getClipPreviewUrl(normalizedId, clipStart, clipEnd);
      } catch {
        return null;
      }
    }
    if (mp4Url) return mp4Url;
    return null;
  }, [normalizedId, clipStart, clipEnd, mp4Url, optimal, playbackUrlOverride]);

  const downloadCloudinaryUrl = useMemo(() => {
    if (!normalizedId) return null;
    try {
      return getClipDownloadUrl(normalizedId, clipStart, clipEnd, { maxDuration: MAX_DURATION });
    } catch {
      return null;
    }
  }, [normalizedId, clipStart, clipEnd]);

  const previewStart = previewStartOverride ?? optimal?.previewStart ?? clipStart;
  const previewEnd = previewEndOverride ?? optimal?.previewEnd ?? clipEnd;
  const relStart = Math.max(0, clipStart - previewStart);
  const relEnd = Math.max(relStart + 0.1, clipEnd - previewStart);

  const [windowStart, setWindowStart] = useState(() => previewStart);
  const [windowEnd, setWindowEnd] = useState(() => previewEnd);

  useEffect(() => {
    if (!open) return;
    setWindowStart(previewStart);
    setWindowEnd(previewEnd);
  }, [open, previewStart, previewEnd]);

  useEffect(() => {
    const v = validateClipRange(clipStart, clipEnd, { maxDuration: MAX_DURATION });
    setError(v.ok ? null : v.message);
  }, [clipStart, clipEnd]);

  if (!open) return null;

  const seekVideo = (absoluteTime: number) => {
    if (!videoRef.current) return;
    const rel = Math.max(0, absoluteTime - previewStart);
    videoRef.current.currentTime = rel;
  };

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
    const basePublicId = normalizedId || null;
    try {
      let blob: Blob | null = null;

      // 1) Try Cloudinary deterministic range URL first (preferred, matches highlighted selection)
      if (downloadCloudinaryUrl) {
        const res = await fetch(downloadCloudinaryUrl);
        if (res.ok) {
          blob = await res.blob();
        } else if (res.status === 423) {
          throw new Error("Cloudinary is still processing this clip. Please retry in a moment.");
        } else if (res.status === 404) {
          throw new Error("Cloudinary clip not ready. Please retry.");
        } else {
          throw new Error(`Cloudinary error ${res.status}`);
        }
      }

      // 2) FFmpeg trim fallback (only when SAB available). Uses the current playback source (prefers pre-cached URL).
      if (!blob) {
        const sourceUrl = playbackUrl || mp4Url || optimal?.url || hlsUrl;
        if (!sourceUrl) throw new Error("No playable source available");

        if (typeof SharedArrayBuffer === "undefined") {
          throw new Error("Cannot trim in this context (SharedArrayBuffer unavailable). Please retry over HTTPS/secure context.");
        }

        blob = await processVideoClip(sourceUrl, clipStart, clipEnd, (p) => updateProgress(downloadId, p));
      }

      if (!blob) {
        throw new Error("Failed to produce clip blob.");
      }

      const blobUrl = URL.createObjectURL(blob);

      // Trigger a download for the user (separate URL so we don't revoke the timeline URL).
      triggerDownload(blob, filename);

      // Optionally add straight to the timeline in the editor.
      if (onAddToTimeline) {
        try {
          await onAddToTimeline({
            blobUrl,
            durationSeconds: clipEnd - clipStart,
            startSeconds: clipStart,
            endSeconds: clipEnd,
            cloudinaryPublicId: basePublicId,
            mainCloudinaryPublicId: basePublicId,
            filename,
            thumbnail,
          });
        } catch (err) {
          console.error("Failed to add clip to timeline", err);
          failDownload(
            downloadId,
            err instanceof Error ? err.message : "Downloaded, but failed to add to timeline."
          );
          setError(err instanceof Error ? err.message : "Downloaded, but failed to add to timeline.");
          return;
        }
      }

      completeDownload(downloadId);
    } catch (err) {
      failDownload(downloadId, err instanceof Error ? err : String(err));
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  // Spacebar play/pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const overlay = (
    <div
      className={
        portalSelector
          ? "absolute inset-0 z-50 bg-black/80 backdrop-blur-[1px]"
          : "fixed inset-0 z-50 bg-black/80 backdrop-blur-[1px]"
      }
    >
      <div className="flex h-full flex-col bg-gray-950">
        {/* Header */}
        <div
          className="flex items-center px-3 py-2 min-h-12 border border-[#3a404d] border-l-0 border-t-0 bg-[#2f343d] text-slate-100"
          style={{ minHeight: "48px" }}
        >
          <div className="flex w-full items-center justify-between">
            <button
              onClick={() => {
                setPlaying(false);
                onClose();
              }}
              className="flex items-center gap-2 text-slate-300 transition hover:text-white"
            >
              <svg className="h-5 w-5 transition group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Back</span>
            </button>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-white">Clip Editor</h1>
            </div>
            <div className="w-16" />
          </div>
        </div>

        {/* Main content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-1 min-h-0 items-center justify-center bg-black px-3 py-2">
            <div
              className="relative mx-auto h-full w-full max-w-4xl overflow-hidden rounded-xl border border-gray-800 bg-black"
              style={{ maxHeight: "100%" }}
            >
              {playbackUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={playbackUrl}
                    controls={false}
                    muted={false}
                    className="h-full w-full object-contain bg-black"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      v.currentTime = relStart;
                    }}
                    onTimeUpdate={(e) => {
                      const v = e.currentTarget;
                      const absTime = previewStart + v.currentTime;
                      if (enforceSelectionStop && v.currentTime >= relEnd) {
                        v.pause();
                        v.currentTime = relEnd;
                        setPlaying(false);
                        setEnforceSelectionStop(false);
                        setPlaySelectedOnce(false);
                      }
                      setPlayhead(absTime);
                    }}
                  />
                  {/* Overlay controls and compact timeline inside the player */}
                  <div className="absolute inset-x-0 bottom-0 bg-transparent backdrop-blur-0 p-1.5 text-[10px]">
                    <div className="mb-1.5 flex items-center gap-1">
                      <button
                        onClick={togglePlay}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-md transition hover:bg-indigo-500 hover:-translate-y-[1px] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                        aria-label={playing ? "Pause" : "Play"}
                      >
                        {playing ? (
                          <div className="flex items-center justify-center gap-[5px]">
                            <span className="block h-5 w-1.5 rounded-sm bg-white" />
                            <span className="block h-5 w-1.5 rounded-sm bg-white" />
                          </div>
                        ) : (
                          <div
                            className="h-0 w-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-white"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </div>
                    <ClipTimeline
                      playhead={playhead}
                      setPlayhead={(v) => {
                        setPlayhead(v);
                        seekVideo(v);
                      }}
                      windowStart={windowStart}
                      windowEnd={windowEnd}
                      clipStart={clipStart}
                      clipEnd={clipEnd}
                      onChangeStart={(v) => setClipStart(clampSeconds(v, 0, clipEnd - 0.1))}
                      onChangeEnd={(v) => setClipEnd(clampSeconds(v, clipStart + 0.1, windowEnd))}
                      onScrubStart={() => setPlaying(false)}
                      onScrubEnd={() => {
                        seekVideo(playhead);
                        setPlaying(true);
                      }}
                      onTrackClick={(t) => {
                        setPlayhead(t);
                        seekVideo(t);
                        setPlaying(true);
                      }}
                      heightClass="h-6"
                    />
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">No Cloudinary source available</div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-800 bg-transparent px-3 py-2">
            <div className="mx-auto max-w-4xl space-y-1.5">
              {error && (
                <div className="rounded-md border border-red-500/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setPlayhead(clipStart);
                      if (videoRef.current) {
                        videoRef.current.currentTime = relStart;
                      }
                      setEnforceSelectionStop(true);
                      setPlaySelectedOnce(true);
                      setPlaying(true);
                    }}
                    className="cloudinary-btn cloudinary-btn--play flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition hover:-translate-y-[1px] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                  >
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span>Play Selected Clip</span>
                  </button>
                  <div className="rounded-xl border border-gray-700 bg-gray-800/60 px-3.5 py-2 text-sm font-semibold text-white">
                    Clip duration: <span className="text-slate-100">{formatSeconds(clipEnd - clipStart)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setPlaying(false);
                      onClose();
                    }}
                    className="cloudinary-btn cloudinary-btn--cancel rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition hover:-translate-y-[1px] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onDownload}
                    disabled={isDownloading}
                    className={clsx(
                      "cloudinary-btn cloudinary-btn--primary rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition hover:-translate-y-[1px] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
                      "disabled:cursor-not-allowed disabled:opacity-60"
                    )}
                  >
                    {isDownloading ? "Adding..." : "Add to Timeline"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (portalSelector) {
    const target = typeof document !== "undefined" ? document.querySelector(portalSelector) : null;
    if (target) {
      // Ensure the target is positioned to allow absolute overlay
      if (target instanceof HTMLElement && getComputedStyle(target).position === "static") {
        target.style.position = "relative";
      }
      return createPortal(overlay, target);
    }
  }

  return overlay;
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
      className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
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

