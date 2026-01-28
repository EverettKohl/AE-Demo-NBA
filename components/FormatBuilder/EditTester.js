"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const TARGET_FPS = 30;

const formatTime = (seconds) => {
  if (!isFinite(seconds) || isNaN(seconds)) return "0.000";
  return seconds.toFixed(3);
};

const secondsToFrame = (seconds, fps = TARGET_FPS) => {
  if (!isFinite(seconds) || isNaN(seconds)) return 0;
  return Math.round(seconds * fps);
};

const frameToSeconds = (frame, fps = TARGET_FPS) => {
  return frame / fps;
};

// Vibrant colors that cycle for each clip change
const CLIP_COLORS = [
  { bg: "#dc2626", text: "#ffffff" }, // red
  { bg: "#2563eb", text: "#ffffff" }, // blue
  { bg: "#16a34a", text: "#ffffff" }, // green
  { bg: "#9333ea", text: "#ffffff" }, // purple
  { bg: "#ea580c", text: "#ffffff" }, // orange
  { bg: "#0891b2", text: "#ffffff" }, // cyan
  { bg: "#c026d3", text: "#ffffff" }, // fuchsia
  { bg: "#eab308", text: "#000000" }, // yellow
  { bg: "#059669", text: "#ffffff" }, // emerald
  { bg: "#7c3aed", text: "#ffffff" }, // violet
  { bg: "#e11d48", text: "#ffffff" }, // rose
  { bg: "#0284c7", text: "#ffffff" }, // sky
  { bg: "#65a30d", text: "#ffffff" }, // lime
  { bg: "#d97706", text: "#ffffff" }, // amber
  { bg: "#4f46e5", text: "#ffffff" }, // indigo
  { bg: "#be185d", text: "#ffffff" }, // pink
];

const EditTester = ({
  songPath,
  marks,
  rapidClipRanges = [],
  fps = TARGET_FPS,
  foregroundMarks = [],
  foregroundRapidClipRanges = [],
  foregroundEnabled = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [foregroundClipIndex, setForegroundClipIndex] = useState(0);
  const audioRef = useRef(null);
  const animationRef = useRef(null);

  // Get current color based on clip index
  const currentColor = CLIP_COLORS[currentClipIndex % CLIP_COLORS.length];

  // Current frame number (derived from time)
  const currentFrame = secondsToFrame(currentTime, fps);
  const shapeTypes = useMemo(
    () => ["circle", "square", "triangle", "star", "rhombus", "diamond", "vertical-rect"],
    []
  );
  const currentShapeType = shapeTypes[foregroundClipIndex % shapeTypes.length];

  // Generate all marks using frame-based calculation to avoid floating-point errors
  const buildMarksWithFrames = useCallback(
    (markTimes, ranges) => {
      const frameMarks = new Map(); // Use frame number as key to dedupe

      // Add beat grid marks (converted to frames)
      markTimes.forEach((time) => {
        const frame = secondsToFrame(time, fps);
        if (!frameMarks.has(frame)) {
          frameMarks.set(frame, { time, frame, type: "beat" });
        }
      });

      // Add rapid clip range marks using integer frame iteration
      ranges.forEach((range) => {
        const startFrame = secondsToFrame(range.start, fps);
        const endFrame = secondsToFrame(range.end, fps);
        // Convert interval to frames (minimum 1 frame)
        const frameInterval = Math.max(1, secondsToFrame(range.interval || 0.1, fps));
        
        // Integer frame iteration - no floating-point accumulation errors!
        for (let f = startFrame; f <= endFrame; f += frameInterval) {
          if (!frameMarks.has(f)) {
            frameMarks.set(f, { 
              time: frameToSeconds(f, fps), 
              frame: f, 
              type: "rapid" 
            });
          }
        }
      });

      return [...frameMarks.values()].sort((a, b) => a.frame - b.frame);
    },
    [fps]
  );

  const getAllMarksWithFrames = useCallback(
    () => buildMarksWithFrames(marks || [], rapidClipRanges || []),
    [buildMarksWithFrames, marks, rapidClipRanges]
  );
  
  // Get just the times for backward compatibility
  const getAllMarks = useCallback(() => {
    return getAllMarksWithFrames().map(m => m.time);
  }, [getAllMarksWithFrames]);

  const foregroundMarksWithFrames = useMemo(
    () => buildMarksWithFrames(foregroundMarks || [], foregroundRapidClipRanges || []),
    [buildMarksWithFrames, foregroundMarks, foregroundRapidClipRanges]
  );

  const foregroundAllMarks = useMemo(
    () => foregroundMarksWithFrames.map((m) => m.time),
    [foregroundMarksWithFrames]
  );

  // Find current clip index based on current time
  const updateClipIndexForMarks = useCallback((time, markTimes, setter) => {
    if (!markTimes.length) {
      setter(0);
      return;
    }

    let idx = 0;
    for (let i = 0; i < markTimes.length; i++) {
      if (markTimes[i] <= time) {
        idx = i + 1;
      } else {
        break;
      }
    }
    setter(idx);
  }, []);

  // High-frequency update loop for smooth clip transitions
  const updateLoop = useCallback(() => {
    if (!audioRef.current) return;
    
    const time = audioRef.current.currentTime;
    setCurrentTime(time);
    updateClipIndexForMarks(time, getAllMarks(), setCurrentClipIndex);
    if (foregroundEnabled) {
      updateClipIndexForMarks(time, foregroundAllMarks, setForegroundClipIndex);
    }
    
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateLoop);
    }
  }, [foregroundAllMarks, foregroundEnabled, isPlaying, updateClipIndexForMarks, getAllMarks]);

  // Start/stop the update loop
  useEffect(() => {
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateLoop);
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, updateLoop]);

  // Handle play/pause
  const handlePlayPause = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentClipIndex(0);
    };
    const handleLoadedMetadata = () => setDuration(audio.duration);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, []);

  // Reset and restart test
  const handleRestart = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
    setIsPlaying(true);
    setCurrentClipIndex(0);
  };

  const allMarksWithFrames = getAllMarksWithFrames();
  const allMarks = allMarksWithFrames.map(m => m.time);
  const totalClips = allMarks.length + 1; // +1 because first clip is before first mark
  const totalFrames = secondsToFrame(duration, fps);
  const foregroundActive =
    foregroundEnabled &&
    (foregroundMarksWithFrames.length > 0 ||
      (foregroundRapidClipRanges?.length || 0) > 0);

  // Get next mark time and frame
  const getNextMark = () => {
    return allMarksWithFrames.find((m) => m.frame > currentFrame);
  };

  const nextMarkInfo = getNextMark();
  const nextMark = nextMarkInfo?.time;
  
  // Calculate current clip's frame count
  const getCurrentClipFrameCount = () => {
    if (allMarksWithFrames.length === 0) return totalFrames;
    
    const currentMarkIdx = currentClipIndex - 1;
    if (currentMarkIdx < 0) {
      // First clip (before first mark)
      return allMarksWithFrames[0]?.frame || totalFrames;
    }
    if (currentMarkIdx >= allMarksWithFrames.length - 1) {
      // Last clip
      const lastMark = allMarksWithFrames[allMarksWithFrames.length - 1];
      return totalFrames - lastMark.frame;
    }
    // Middle clip
    const startFrame = allMarksWithFrames[currentMarkIdx].frame;
    const endFrame = allMarksWithFrames[currentMarkIdx + 1].frame;
    return endFrame - startFrame;
  };
  
  const currentClipFrameCount = getCurrentClipFrameCount();

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      {/* Hidden audio */}
      <audio ref={audioRef} src={songPath} preload="metadata" />

      {/* Test display area - full color background */}
      <div 
        className="relative aspect-video flex items-center justify-center transition-colors duration-100"
        style={{ backgroundColor: currentColor.bg }}
      >
        {foregroundEnabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div
              className="shadow-xl transition-all duration-200"
              style={{
                width: "66%",
                height: "66%",
                backgroundColor: "#000000",
                opacity: foregroundActive ? 0.9 : 0.4,
                clipPath:
                  currentShapeType === "circle"
                    ? "circle(50% at 50% 50%)"
                    : currentShapeType === "square"
                    ? "inset(0 0 0 0)"
                    : currentShapeType === "triangle"
                    ? "polygon(50% 0%, 0% 100%, 100% 100%)"
                    : currentShapeType === "star"
                    ? "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)"
                    : currentShapeType === "rhombus"
                    ? "polygon(50% 0%, 90% 50%, 50% 100%, 10% 50%)"
                    : currentShapeType === "diamond"
                    ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
                    : "polygon(30% 0%, 70% 0%, 70% 100%, 30% 100%)", // vertical-rect
              }}
              title={foregroundActive ? "Cutout layer active" : "Cutout layer available"}
            />
          </div>
        )}
        {/* Clip number display with frame info */}
        <div className="relative z-20 text-center space-y-4">
          <div 
            className="text-8xl md:text-[12rem] font-black tracking-tight drop-shadow-2xl"
            style={{ color: currentColor.text }}
          >
            {currentClipIndex + 1}
          </div>
          <div 
            className="text-2xl md:text-4xl font-mono opacity-80"
            style={{ color: currentColor.text }}
          >
            {formatTime(currentTime)}s
          </div>
          <div 
            className="text-lg md:text-xl font-mono opacity-70"
            style={{ color: currentColor.text }}
          >
            Frame {currentFrame} / {currentClipFrameCount}f @ {fps}fps
          </div>
          {nextMarkInfo && (
            <div 
              className="text-sm md:text-lg opacity-60"
              style={{ color: currentColor.text }}
            >
              Next clip at: {formatTime(nextMarkInfo.time)}s (frame {nextMarkInfo.frame})
            </div>
          )}
        </div>

        {/* Progress indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-black/30">
          <div
            className="h-full bg-white/80"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>

        {/* Clip markers on progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-2">
          {allMarks.map((mark, idx) => (
            <div
              key={idx}
              className="absolute top-0 w-0.5 h-full bg-black/50"
              style={{ left: `${duration ? (mark / duration) * 100 : 0}%` }}
            />
          ))}
        </div>

        {/* Stats overlay with frame info */}
        <div 
          className="absolute top-4 right-4 text-right text-sm px-3 py-2 rounded-lg"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", color: "#ffffff" }}
        >
          <div>
            <span className="font-semibold">{currentClipIndex + 1}</span>
            <span className="opacity-60"> / </span>
            <span>{totalClips}</span>
          </div>
          {foregroundEnabled && (
            <div className="text-xs opacity-70">
              FG clips: {foregroundMarksWithFrames.length + 1}
            </div>
          )}
          <div className="text-xs opacity-70">
            {allMarks.length} marks • {totalFrames}f total
          </div>
          <div className="text-xs opacity-50 font-mono mt-1">
            {fps}fps • Frame-Accurate
          </div>
        </div>

        {/* Not playing overlay */}
        {!isPlaying && currentTime === 0 && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <button
              onClick={handlePlayPause}
              className="flex items-center gap-3 px-8 py-5 bg-white hover:bg-gray-100 text-black font-bold rounded-xl transition-colors text-xl shadow-2xl"
            >
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Start Test
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 bg-gray-900 border-t border-gray-700 flex items-center gap-4">
        <button
          onClick={handlePlayPause}
          className="flex items-center justify-center w-14 h-14 rounded-full transition-colors shadow-lg border-2"
          style={{ 
            backgroundColor: isPlaying ? "#ef4444" : "#22c55e", 
            borderColor: isPlaying ? "#dc2626" : "#16a34a",
            color: "#ffffff"
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

        <button
          onClick={handleRestart}
          className="flex items-center justify-center w-12 h-12 rounded-lg transition-colors border-2"
          style={{ backgroundColor: "#374151", borderColor: "#4b5563", color: "#ffffff" }}
          title="Restart"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
            Frame-Accurate Edit Test
          </div>
          <div className="text-xs" style={{ color: "#94a3b8" }}>
            {totalClips} clips • {totalFrames} frames @ {fps}fps
          </div>
        </div>

        <div className="text-right">
          <div className="text-xl font-mono font-bold" style={{ color: "#fbbf24" }}>
            {formatTime(currentTime)}s
          </div>
          <div className="text-sm font-mono" style={{ color: "#94a3b8" }}>
            Frame {currentFrame} / {totalFrames}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditTester;

