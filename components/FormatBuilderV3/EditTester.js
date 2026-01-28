"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const TARGET_FPS = 30;

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

const DEFAULT_CAPTION_STYLE = {
  textEffect: "default",
  mode: "default",
  color: "#ffffff",
  fontFamily: "Montserrat",
  fontWeight: "800",
  fontSizeRatio: 0.25,
  letterSpacing: 0,
  uppercase: false,
};

const ensureCaptionStyle = (style) => ({
  ...DEFAULT_CAPTION_STYLE,
  ...(style || {}),
  mode: style?.textEffect || style?.mode || DEFAULT_CAPTION_STYLE.mode,
  textEffect: style?.textEffect || style?.mode || DEFAULT_CAPTION_STYLE.textEffect,
});

const EditTester = ({
  songPath,
  marks,
  rapidClipRanges = [],
  fps = TARGET_FPS,
  foregroundMarks = [],
  foregroundRapidClipRanges = [],
  foregroundEnabled = false,
  externalAudioRef = null,
  externalIsPlaying = null,
  onExternalPlayChange = () => {},
  onExternalTimeUpdate = () => {},
  onExternalDuration = () => {},
  captions = null,
  captionsEnabled = false,
  layeredCaptions = false,
  captionStyle = {},
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [foregroundClipIndex, setForegroundClipIndex] = useState(0);
  const internalAudioRef = useRef(null);
  const audioRef = externalAudioRef || internalAudioRef;
  const animationRef = useRef(null);

  // Get current color based on clip index
  const currentColor = CLIP_COLORS[currentClipIndex % CLIP_COLORS.length];

  const shapeTypes = useMemo(
    () => ["circle", "square", "triangle", "star", "rhombus", "diamond", "vertical-rect"],
    []
  );
  const currentShapeType = shapeTypes[foregroundClipIndex % shapeTypes.length];

  const rapidFrameRanges = useMemo(
    () =>
      Array.isArray(rapidClipRanges)
        ? rapidClipRanges.map((r) => ({
            startFrame: secondsToFrame(r.start, fps),
            endFrame: secondsToFrame(r.end, fps),
          }))
        : [],
    [rapidClipRanges, fps]
  );

  const foregroundRapidFrameRanges = useMemo(
    () =>
      Array.isArray(foregroundRapidClipRanges)
        ? foregroundRapidClipRanges.map((r) => ({
            startFrame: secondsToFrame(r.start, fps),
            endFrame: secondsToFrame(r.end, fps),
          }))
        : [],
    [foregroundRapidClipRanges, fps]
  );

  const isRapidFrame = useCallback((frame, ranges) => {
    if (!ranges.length) return false;
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      if (frame >= range.startFrame && frame <= range.endFrame) return true;
    }
    return false;
  }, []);

  const rapidColorIndex = useCallback(
    (timeSeconds, ranges) => {
      if (!ranges.length || !isFinite(timeSeconds)) return null;
      for (let i = 0; i < ranges.length; i++) {
        const { start, end, interval = 0.1 } = ranges[i];
        if (timeSeconds < start || timeSeconds > end) continue;
        const safeInterval = Math.max(interval || 0.1, 0.01);
        const idx = Math.floor((timeSeconds - start) / safeInterval);
        if (idx >= 0) return idx;
      }
      return null;
    },
    []
  );

  // Generate all marks using frame-based calculation to avoid floating-point errors
  const buildMarksWithFrames = useCallback(
    (markTimes, ranges) => {
      const frameMarks = new Map(); // Use frame number as key to dedupe

      // Add segment grid marks (converted to frames)
      markTimes.forEach((time) => {
        const frame = secondsToFrame(time, fps);
        if (!frameMarks.has(frame)) {
          frameMarks.set(frame, { time, frame, type: "segment" });
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
    onExternalTimeUpdate(time);
    updateClipIndexForMarks(time, getAllMarks(), setCurrentClipIndex);
    if (foregroundEnabled) {
      updateClipIndexForMarks(time, foregroundAllMarks, setForegroundClipIndex);
    }
    
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateLoop);
    }
  }, [foregroundAllMarks, foregroundEnabled, isPlaying, updateClipIndexForMarks, getAllMarks, onExternalTimeUpdate]);

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

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setIsPlaying(true);
      onExternalPlayChange(true);
    };
    const handlePause = () => {
      setIsPlaying(false);
      onExternalPlayChange(false);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentClipIndex(0);
      onExternalPlayChange(false);
    };
    const handleLoadedMetadata = () => {
      onExternalDuration(audio.duration);
    };

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
  }, [onExternalDuration]);

  // Sync with external play state
  useEffect(() => {
    if (externalIsPlaying === null || externalIsPlaying === undefined) return;
    if (!audioRef.current) return;
    if (externalIsPlaying) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
    setIsPlaying(externalIsPlaying);
  }, [externalIsPlaying, audioRef]);

  const foregroundActive =
    foregroundEnabled &&
    (foregroundMarksWithFrames.length > 0 ||
      (foregroundRapidClipRanges?.length || 0) > 0);

  const displayRanges = Array.isArray(captions?.displayRanges) ? captions.displayRanges : [];
  const captionLines = Array.isArray(captions?.lines) ? captions.lines : [];
  const captionWords = Array.isArray(captions?.words) ? captions.words : [];

  const isWordModeAt = useCallback(
    (startMs, endMs) =>
      displayRanges.some(
        (r) =>
          r.mode === "word" &&
          startMs < (r.endMs ?? r.startMs ?? 0) &&
          endMs > (r.startMs ?? 0)
      ),
    [displayRanges]
  );

  const activeCaption = useMemo(() => {
    const previewable =
      (captionStyle?.mode || "default") !== "negative" &&
      (captionStyle?.mode || "default") !== "none";
    if (!captionsEnabled || (!captionLines.length && !captionWords.length)) return null;
    const currentMs = currentTime * 1000;
    const pickStyle = (entry) => {
      if (!entry) return captionStyle;
      if (entry.useGlobalStyle === false && entry.style) return ensureCaptionStyle(entry.style);
      return captionStyle;
    };
    const activeWord =
      isWordModeAt(currentMs, currentMs) &&
      captionWords.find(
        (w) =>
          currentMs >= (Number(w.startMs) || 0) &&
          currentMs <= (Number(w.endMs) || Number(w.startMs) || 0)
      );
    if (activeWord && previewable) {
      return {
        text: activeWord.text || "",
        layer: (activeWord.layer || (layeredCaptions ? "layered" : "top")),
        style: pickStyle(activeWord),
      };
    }
    const activeLine = captionLines.find(
      (l) =>
        currentMs >= (Number(l.startMs) || 0) &&
        currentMs <= (Number(l.endMs) || Number(l.startMs) || 0)
    );
    if (activeLine && previewable) {
      return {
        text: activeLine.text || "",
        layer: (activeLine.layer || (layeredCaptions ? "layered" : "top")),
        style: pickStyle(activeLine),
      };
    }
    return null;
  }, [captionLines, captionWords, captionsEnabled, currentTime, isWordModeAt, layeredCaptions, captionStyle]);

  const currentFrame = secondsToFrame(currentTime, fps);
  const baseRapidActive = isRapidFrame(currentFrame, rapidFrameRanges);
  const foregroundRapidActive = isRapidFrame(currentFrame, foregroundRapidFrameRanges);
  const baseRapidColorIdx = rapidColorIndex(currentTime, rapidClipRanges);
  const foregroundRapidColorIdx = rapidColorIndex(currentTime, foregroundRapidClipRanges);
  const baseColorChoice =
    baseRapidColorIdx !== null
      ? CLIP_COLORS[baseRapidColorIdx % CLIP_COLORS.length]
      : currentColor;
  const foregroundColorChoice =
    foregroundRapidColorIdx !== null
      ? CLIP_COLORS[(foregroundRapidColorIdx + 3) % CLIP_COLORS.length]
      : currentColor;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      {/* Hidden audio */}
      <audio ref={audioRef} src={songPath} preload="metadata" />

      {/* Simplified preview area */}
      <div
        className={`relative aspect-video flex items-center justify-center transition-colors duration-100 ${
          baseRapidActive ? "shadow-[0_0_0_3px_rgba(255,255,255,0.12)]" : ""
        }`}
        style={{
          backgroundColor: baseColorChoice.bg,
        }}
      >
        {/* Rapid background overlay */}
        {baseRapidActive && (
          <div
            className="absolute inset-0 animate-pulse pointer-events-none"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.16) 12px, transparent 12px, transparent 24px)",
              mixBlendMode: "screen",
            }}
          />
        )}

        {foregroundEnabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div
              className={`shadow-xl transition-all duration-150 ${
                foregroundRapidActive ? "animate-pulse" : ""
              }`}
              style={{
                width: foregroundRapidActive ? "72%" : "66%",
                height: foregroundRapidActive ? "72%" : "66%",
                backgroundColor: foregroundRapidActive ? foregroundColorChoice.bg : "#000000",
                opacity: foregroundActive ? 0.9 : 0.45,
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

        {/* Caption layer (below cutout when layered captions are chosen) */}
        {activeCaption && activeCaption.text && (
          <div
            className={`absolute inset-0 flex items-center ${
              activeCaption.layer === "layered" ? "justify-center z-15" : "justify-center z-40"
            } px-6 text-center`}
            style={{
              fontFamily: activeCaption.style?.fontFamily || captionStyle.fontFamily || "Montserrat",
              fontWeight: activeCaption.style?.fontWeight || captionStyle.fontWeight || "800",
              color: activeCaption.style?.color || captionStyle.color || "#ffffff",
              textShadow: "0 2px 8px rgba(0,0,0,0.6)",
              fontSize: `clamp(18px, ${(((activeCaption.style?.fontSizeRatio ?? captionStyle.fontSizeRatio ?? 0.25) || 0.25) * 9).toFixed(2)}vw, 42px)`,
              letterSpacing:
                activeCaption.style?.letterSpacing !== undefined
                  ? `${activeCaption.style.letterSpacing}px`
                  : captionStyle.letterSpacing
                  ? `${captionStyle.letterSpacing}px`
                  : undefined,
              lineHeight: 1.15,
              textTransform:
                activeCaption.style?.uppercase ?? captionStyle.uppercase ? "uppercase" : "none",
              pointerEvents: "none",
              alignItems: activeCaption.layer === "layered" ? "center" : "flex-end",
              paddingBottom: activeCaption.layer === "layered" ? "8%" : "12%",
            }}
          >
            {activeCaption.text}
          </div>
        )}

        {/* Clip counter */}
        <div className="absolute top-3 right-3 z-40">
          <div className="px-2.5 py-1.5 rounded-lg bg-black/35 text-white font-bold text-lg tracking-tight">
            {currentClipIndex + 1}
          </div>
        </div>

        {/* Rapid indicator */}
        {(baseRapidActive || foregroundRapidActive) && (
          <div className="absolute top-3 left-3 z-40">
            <div className="px-2 py-1 rounded-md bg-orange-500/90 text-black font-semibold text-xs tracking-tight shadow-md">
              {baseRapidActive && foregroundRapidActive
                ? "Rapid: bg + cutout"
                : baseRapidActive
                ? "Rapid: background"
                : "Rapid: cutout"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditTester;

