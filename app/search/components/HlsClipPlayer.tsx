"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import clsx from "clsx";
import { formatSeconds } from "../utils/time";

type Props = {
  hlsUrl?: string | null;
  mp4Url?: string | null;
  poster?: string | null;
  startTime?: number;
  endTime?: number | null;
  playing?: boolean;
  muted?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onRequestPlay?: () => void; // fired immediately when the user clicks play overlay
  stopTime?: number | null; // optional hard stop boundary
  seekTime?: number | null; // external seek position
  onTimeUpdate?: (time: number) => void;
};

const HlsClipPlayer: React.FC<Props> = ({
  hlsUrl,
  mp4Url,
  poster,
  startTime = 0,
  endTime = null,
  playing = false,
  muted = false,
  onPlay,
  onPause,
  onEnded,
  onRequestPlay,
  stopTime,
  seekTime,
  onTimeUpdate,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [forceMp4, setForceMp4] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const shouldPlayRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const seekTriesRef = useRef(0);
  const warmMp4DoneRef = useRef(false);

  const clipDuration = useMemo(() => {
    if (endTime === null || endTime <= startTime) return null;
    return endTime - startTime;
  }, [startTime, endTime]);

  const useHls = Boolean(hlsUrl) && !forceMp4;
  const sourceToUse = useHls ? hlsUrl : mp4Url || null;
  const isHls = Boolean(sourceToUse) && useHls;
  const seekTarget = useMemo(
    () => (seekTime !== null && seekTime !== undefined ? seekTime : startTime ?? 0),
    [seekTime, startTime]
  );

  // Warm MP4 to reduce first-byte delay; quick timeout to avoid blocking
  useEffect(() => {
    if (!mp4Url || warmMp4DoneRef.current) return;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1200);
    fetch(mp4Url, { method: "HEAD", signal: controller.signal }).catch(() => {});
    warmMp4DoneRef.current = true;
    return () => clearTimeout(t);
  }, [mp4Url]);

  // Destroy helpers
  const destroyHls = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  };

  // Initialize media
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceToUse) return;

    destroyHls();
    video.removeAttribute("src");
    video.load();

    const cleanupFns: Array<() => void> = [];

    const trySeek = (target: number) => {
      if (!video) return false;
      if (video.seekable && video.seekable.length > 0) {
        const startR = video.seekable.start(0);
        const endR = video.seekable.end(video.seekable.length - 1);
        if (target >= startR && target <= endR) {
          video.currentTime = target;
          pendingSeekRef.current = null;
          return true;
        }
      }
      video.currentTime = target; // best effort
      return false;
    };

    const scheduleSeekRetry = (target: number) => {
      pendingSeekRef.current = target;
      seekTriesRef.current = 0;
      const tick = () => {
        if (!video || pendingSeekRef.current === null) return;
        const ok = trySeek(target);
        seekTriesRef.current += 1;
        if (ok || seekTriesRef.current > 6) {
          pendingSeekRef.current = null;
          return;
        }
        setTimeout(tick, 120 * seekTriesRef.current);
      };
      setTimeout(tick, 120);
    };

    const applyStartTime = () => {
      if (!video) return;
      if (seekTarget >= 0) {
        const ok = trySeek(seekTarget);
        if (!ok) scheduleSeekRetry(seekTarget);
      }
    };

    const handleLoadedMetadata = () => {
      applyStartTime();
      if (shouldPlayRef.current) {
        video.play().catch(() => {});
      }
    };

    const handleCanPlay = () => {
      applyStartTime();
      if (shouldPlayRef.current) {
        video.play().catch(() => {});
      }
    };

    const handleTimeUpdate = () => {
      const boundary = typeof stopTime === "number" ? stopTime : null;
      const enforceBoundary = Number.isFinite(boundary as number);
      if (enforceBoundary && boundary !== null && video.currentTime >= boundary) {
        video.pause();
        setProgress(1);
        onEnded?.();
      } else if (clipDuration) {
        const elapsed = video.currentTime - startTime;
        const pct = Math.max(0, Math.min(1, elapsed / clipDuration));
        setProgress(pct);
      }
      onTimeUpdate?.(video.currentTime);
    };

    const handlePlay = () => {
      setHasStarted(true);
      onPlay?.();
    };
    const handlePause = () => onPause?.();

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    cleanupFns.push(() => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    });

    if (isHls && sourceToUse && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        startPosition: seekTarget > 0 ? seekTarget : -1,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(sourceToUse);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        applyStartTime();
        // Bias buffering near the clip start
        try {
          hls.startLoad(seekTarget > 0 ? seekTarget : -1);
        } catch {
          // ignore
        }
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            destroyHls();
            // If HLS is unusable and we have an MP4 fallback, switch to it.
            if (mp4Url) {
              setForceMp4(true);
              if (video && mp4Url) {
                video.src = mp4Url;
                video.load();
                applyStartTime();
                if (shouldPlayRef.current) {
                  video.play().catch(() => {});
                }
              }
            }
          }
        }
      });
      cleanupFns.push(() => {
        destroyHls();
      });
    } else {
      // Native HLS (Safari) or MP4 fallback
      video.src = sourceToUse;
      video.load();
      applyStartTime();
    }

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, [sourceToUse, isHls, startTime, endTime, clipDuration, onEnded, onPause, onPlay, stopTime, onTimeUpdate, seekTarget, mp4Url]);

  // Controlled play/pause
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    shouldPlayRef.current = playing;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  // External seek
  useEffect(() => {
    if (seekTime === null || seekTime === undefined) return;
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - seekTime) > 0.15) {
      video.currentTime = seekTime;
    }
  }, [seekTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (muted) video.volume = 0;
  }, [muted]);

  const showOverlayPlay = !playing;
  const showProgress = clipDuration !== null && clipDuration > 0;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        className="h-full w-full cursor-pointer object-contain"
        playsInline
        muted={muted}
        poster={poster || undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (playing) {
            shouldPlayRef.current = false;
            onPause?.();
            videoRef.current?.pause();
          } else {
            shouldPlayRef.current = true;
            onRequestPlay?.();
            if (!hasStarted && seekTarget !== null && seekTarget !== undefined) {
              videoRef.current!.currentTime = seekTarget;
            }
            videoRef.current?.play().catch(() => {});
          }
        }}
      />
      {showProgress && (
        <>
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">
            {formatSeconds(progress * (clipDuration ?? 0))} / {formatSeconds(clipDuration ?? 0)}
          </div>
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div
              className={clsx("h-full transition-all duration-100 ease-linear", "bg-linear-to-r from-amber-400 to-amber-500")}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </>
      )}
      {!hasStarted && poster && (
        <img
          src={poster}
          alt="thumbnail"
          className="absolute inset-0 h-full w-full object-cover transition duration-300"
          style={{ opacity: showOverlayPlay ? 1 : 0, pointerEvents: "none" }}
        />
      )}
    </div>
  );
};

export default HlsClipPlayer;

