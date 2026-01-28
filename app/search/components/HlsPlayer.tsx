"use client";

import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Props = {
  hlsUrl: string;
  startTime: number;
  endTime: number;
  playing: boolean;
  seekTime?: number | null;
  muted?: boolean;
  stopAtEnd?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (time: number) => void;
};

/**
 * Minimal HLS player that:
 * - Buffers near startTime (startLoad startPosition)
 * - Seeks on MANIFEST_PARSED + loadedmetadata
 * - Pauses when currentTime >= endTime
 */
const HlsPlayer: React.FC<Props> = ({
  hlsUrl,
  startTime,
  endTime,
  playing,
  seekTime,
  muted = false,
  stopAtEnd = true,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const shouldPlayRef = useRef(false);

  const attachHls = () => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        startPosition: startTime > 0 ? startTime : -1,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(hlsUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        seekToStart();
        try {
          hls.startLoad(startTime > 0 ? startTime : -1);
        } catch {
          // ignore
        }
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.destroy();
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
    } else {
      console.error("HLS not supported");
    }
  };

  const seekToStart = () => {
    const video = videoRef.current;
    if (!video) return;
    if (startTime >= 0) {
      video.currentTime = startTime;
    }
  };

  useEffect(() => {
    attachHls();
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      seekToStart();
      if (shouldPlayRef.current) video.play().catch(() => {});
    };
    const onTime = () => {
      if (stopAtEnd && video.currentTime >= endTime) {
        video.pause();
        onEnded?.();
        return;
      }
      onTimeUpdate?.(video.currentTime);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("canplay", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", () => onPlay?.());
    video.addEventListener("pause", () => onPause?.());

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("canplay", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      if (hlsRef.current) hlsRef.current.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlsUrl, startTime, endTime, stopAtEnd, onEnded, onPause, onPlay, onTimeUpdate]);

  // External seek
  useEffect(() => {
    if (seekTime === null || seekTime === undefined) return;
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - seekTime) > 0.1) {
      video.currentTime = seekTime;
    }
  }, [seekTime]);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (muted) video.volume = 0;
  }, [muted]);

  return <video ref={videoRef} className="h-full w-full object-contain bg-black" playsInline />;
};

export default HlsPlayer;

