"use client";

import { useRef, useEffect, useState, useCallback } from "react";

const formatTime = (seconds) => {
  if (!isFinite(seconds) || isNaN(seconds)) return "0.000";
  return seconds.toFixed(3);
};

const formatTimeDisplay = (seconds) => {
  if (!isFinite(seconds) || isNaN(seconds)) return "0.000";
  return seconds.toFixed(3);
};

const AudioPlayerWithMarks = ({
  songPath,
  currentTime,
  duration,
  isPlaying,
  onTimeUpdate,
  onDurationChange,
  onPlayPause,
  onSeek,
  onAddMark,
  audioRef,
  previewSlot = null,
}) => {
  const progressRef = useRef(null);
  const animationFrameRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  // Handle seeking via progress bar click/drag
  const handleProgressInteraction = useCallback(
    (e) => {
      if (!progressRef.current || !duration) return;
      const rect = progressRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percent = x / rect.width;
      const newTime = percent * duration;
      onSeek(newTime);
    },
    [duration, onSeek]
  );

  const handleMouseDown = (e) => {
    setIsDragging(true);
    handleProgressInteraction(e);
  };

  const handleMouseMove = useCallback(
    (e) => {
      if (isDragging) {
        handleProgressInteraction(e);
      }
    },
    [isDragging, handleProgressInteraction]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // High-frequency time update loop for smooth milliseconds
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      if (audio && !audio.paused) {
        onTimeUpdate(audio.currentTime);
        animationFrameRef.current = requestAnimationFrame(updateTime);
      }
    };

    // Start the loop when playing
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updateTime);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, audioRef, onTimeUpdate]);

  // Audio element event handlers for metadata and non-playing updates
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => onDurationChange(audio.duration);
    const handleDurationChange = () => onDurationChange(audio.duration);
    const handleSeeked = () => onTimeUpdate(audio.currentTime);
    const handlePause = () => onTimeUpdate(audio.currentTime);
    const handleTimeUpdate = () => onTimeUpdate(audio.currentTime);
    const handleEnded = () => onTimeUpdate(audio.currentTime);

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("seeked", handleSeeked);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("seeked", handleSeeked);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioRef, onTimeUpdate, onDurationChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          onPlayPause();
          break;
        case "KeyM":
          e.preventDefault();
          onAddMark();
          break;
        case "ArrowLeft":
          e.preventDefault();
          onSeek(Math.max(0, currentTime - (e.shiftKey ? 1 : 0.1)));
          break;
        case "ArrowRight":
          e.preventDefault();
          onSeek(Math.min(duration, currentTime + (e.shiftKey ? 1 : 0.1)));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onPlayPause, onAddMark, onSeek, currentTime, duration]);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800/80 rounded-2xl p-4 space-y-3 shadow-lg">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={songPath} preload="metadata" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded bg-gray-800/80 border border-gray-700 font-mono text-sm text-amber-300">
            {formatTimeDisplay(currentTime)} / {formatTimeDisplay(duration)}s
          </span>
          <span className="text-slate-500">Space to play/pause • M to mark</span>
        </div>
        <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-500">
          <span className="px-2 py-1 rounded bg-gray-800/70 border border-gray-700">±0.1s ←/→</span>
          <span className="px-2 py-1 rounded bg-gray-800/70 border border-gray-700">±1s ⇧←/→</span>
        </div>
      </div>

      {/* Progress bar */}
      <div
        ref={progressRef}
        className="relative h-2 bg-gray-850 bg-opacity-80 rounded-full cursor-pointer overflow-hidden border border-gray-800"
        onMouseDown={handleMouseDown}
      >
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-600 rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Controls + optional preview side-by-side */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              {/* Play/Pause */}
              <button
                onClick={onPlayPause}
                className="flex items-center justify-center w-14 h-14 rounded-full transition-colors shadow-xl border-2"
                style={{
                  backgroundColor: "#22c55e",
                  borderColor: "#16a34a",
                  color: "#ffffff",
                }}
              >
                {isPlaying ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Add Mark button (beside play) */}
              <button
                onClick={onAddMark}
                className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold rounded-lg transition-all shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Mark
                <span className="text-xs opacity-70">(M)</span>
              </button>
            </div>

            {/* Skip buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSeek(Math.max(0, currentTime - 5))}
                className="flex items-center justify-center w-10 h-10 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                title="Back 5s"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                </svg>
              </button>

              <button
                onClick={() => onSeek(Math.max(0, currentTime - 0.1))}
                className="flex items-center justify-center w-10 h-10 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-xs font-mono"
                title="Back 0.1s"
              >
                -0.1
              </button>

              <button
                onClick={() => onSeek(Math.min(duration, currentTime + 0.1))}
                className="flex items-center justify-center w-10 h-10 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-xs font-mono"
                title="Forward 0.1s"
              >
                +0.1
              </button>

              <button
                onClick={() => onSeek(Math.min(duration, currentTime + 5))}
                className="flex items-center justify-center w-10 h-10 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                title="Forward 5s"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-4">
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-slate-400">Space</kbd> Play/Pause
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-slate-400">M</kbd> Add Mark
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-slate-400">←/→</kbd> Seek ±0.1s
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-slate-400">Shift+←/→</kbd> Seek ±1s
            </span>
          </div>
        </div>

        {/* Inline preview (optional) */}
        {previewSlot && (
          <div className="md:w-1/3 w-full min-w-[240px]">
            <div className="w-full aspect-video overflow-hidden rounded-md bg-black">
              {previewSlot}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioPlayerWithMarks;

