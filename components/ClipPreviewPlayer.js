"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactPlayer from "react-player";
import HLSVideoPlayer from "@/components/HLSVideoPlayer2";

/**
 * Reusable clip preview player.
 * - Uses HLSVideoPlayer for Twelve Labs HLS streams when hlsUrl is provided.
 * - Falls back to ReactPlayer for MP4/Cloudinary clips.
 * - Shows play overlay, click-to-play/pause, progress bar, and optional overlays.
 *
 * This is for preview playback only (not the Clip Editor).
 */
const ClipPreviewPlayer = ({
  hlsUrl,
  mp4Url,
  thumbnailUrl,
  startTime = 0,
  endTime = null,
  playing = false,
  isActive = true,
  onPlay,
  onPause,
  onEnded,
  onActivate,
  muted = false,
  className = "",
  overlayTopLeft = null,
  overlayTopRight = null,
  overlayBottomLeft = null,
  overlayBottomRight = null,
  showProgress = true,
}) => {
  const playerRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const clipDuration = useMemo(() => {
    if (typeof endTime !== "number" || typeof startTime !== "number") return 0;
    return Math.max(0, endTime - startTime);
  }, [startTime, endTime]);

  // Poll ReactPlayer for current time to render progress (only for MP4 mode)
  useEffect(() => {
    if (!mp4Url || !playerRef.current || !showProgress || clipDuration <= 0) return;

    const interval = setInterval(() => {
      try {
        const t = playerRef.current.getCurrentTime?.();
        if (typeof t === "number" && !Number.isNaN(t)) {
          const clamped = Math.max(0, Math.min(clipDuration, t));
          setCurrentTime(clamped);
        }
      } catch (err) {
        // player not ready yet; ignore
      }
    }, 120);

    return () => clearInterval(interval);
  }, [mp4Url, clipDuration, showProgress]);

  const progress = clipDuration > 0 ? Math.min(100, (currentTime / clipDuration) * 100) : 0;

  const formatTime = (seconds) => {
    if (!seconds || Number.isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Render ReactPlayer preview with controls disabled
  const renderMp4Player = () => (
    <div
      className="w-full h-full relative"
      onClick={() => {
        if (playing) {
          playerRef.current?.getInternalPlayer?.()?.pause?.();
          onPause?.();
        } else if (onPlay) {
          onPlay();
        }
      }}
    >
      <ReactPlayer
        ref={playerRef}
        url={mp4Url}
        controls={false}
        width="100%"
        height="100%"
        playing={playing}
        muted={muted}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onClickPreview={() => {
          if (!playing) onPlay?.();
        }}
        light={
          !playing && thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              className="object-cover w-full h-full"
              alt="thumbnail"
            />
          ) : false
        }
        config={{
          file: {
            attributes: {
              preload: "auto",
            },
          },
        }}
        progressInterval={100}
      />

      {showProgress && playing && clipDuration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent pointer-events-none">
          <div className="w-full h-1 bg-white/20 mb-2">
            <div
              className="h-full bg-white transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="px-3 pb-2 flex items-center justify-between">
            <p className="text-white text-xs font-medium">
              {formatTime(currentTime)} / {formatTime(clipDuration)}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`relative w-full h-full ${className}`}>
      {!isActive ? (
        <div
          className="w-full h-full relative cursor-pointer"
          onClick={() => {
            onActivate?.();
            onPlay?.();
          }}
        >
          {thumbnailUrl ? (
            <img src={thumbnailUrl} className="object-cover w-full h-full" alt="thumbnail" />
          ) : (
            <div className="flex items-center justify-center w-full h-full bg-black text-slate-500">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5v14l11-7z" />
              </svg>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center shadow-lg border border-white/20">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      ) : hlsUrl ? (
        <HLSVideoPlayer
          hlsUrl={hlsUrl}
          thumbnailUrl={thumbnailUrl}
          startTime={startTime}
          endTime={endTime}
          isPlaying={playing}
          muted={muted}
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onEnded}
        />
      ) : mp4Url ? (
        renderMp4Player()
      ) : null}

      {/* Optional overlays */}
      {overlayTopLeft && (
        <div className="absolute top-3 left-3 z-10">{overlayTopLeft}</div>
      )}
      {overlayTopRight && (
        <div className="absolute top-3 right-3 z-10">{overlayTopRight}</div>
      )}
      {overlayBottomLeft && (
        <div className="absolute bottom-3 left-3 z-10">{overlayBottomLeft}</div>
      )}
      {overlayBottomRight && (
        <div className="absolute bottom-3 right-3 z-10">{overlayBottomRight}</div>
      )}
    </div>
  );
};

export default ClipPreviewPlayer;

