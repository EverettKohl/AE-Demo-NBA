"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  SongSelector,
  AudioPlayerWithMarks,
  StackedTimeline,
  RapidClipSelector,
  EditTester,
} from "@/components/FormatBuilder";
import UnifiedTimeline from "@/components/FormatBuilderV3/UnifiedTimeline";
import {
  clampVolume,
  normalizeBeatMetadata,
  normalizeIntroBeat,
  normalizeMixSegments,
} from "@/lib/songEditScheduler";
import {
  TARGET_FPS,
  secondsToFrame,
  frameToSeconds,
  getEnabledBeatGrid,
} from "@/lib/frameAccurateTiming";

const DEFAULT_CLIP_VOLUME = 0;
const DEFAULT_MUSIC_VOLUME = 1;

const DEFAULT_CAPTION_STYLE = {
  mode: "default", // default | cutout | negative
  color: "#ffffff",
  fontFamily: "Montserrat",
  fontWeight: "800",
  fontSizeRatio: 0.25,
  letterSpacing: 0,
  animation: "word", // word | chunk
  chunkRule: "line",
  uppercase: false,
};

const ensureCaptionStyle = (style) => ({
  ...DEFAULT_CAPTION_STYLE,
  ...(style || {}),
});

const applyForegroundClipDefaults = (beatMetadata = []) =>
  beatMetadata.map((entry) => {
    const clipSlot = { ...(entry?.clipSlot || {}) };
    if (!Number.isFinite(clipSlot.clipVolume)) clipSlot.clipVolume = 0;
    if (!Number.isFinite(clipSlot.musicVolume)) clipSlot.musicVolume = 1;
    return { ...entry, clipSlot };
  });

const normalizeCaptions = (captions) => {
  if (!captions) return null;
  return {
    ...captions,
    words: Array.isArray(captions.words)
      ? captions.words.map((word) => ({
          text: word.text || "",
          startMs: Number(word.startMs) || 0,
          endMs: Number(word.endMs) || Number(word.startMs) || 0,
          useGlobalStyle: word.useGlobalStyle !== false,
          style: word.style ? ensureCaptionStyle(word.style) : null,
        }))
      : [],
    lines: Array.isArray(captions.lines)
      ? captions.lines.map((line) => ({
          text: line.text || "",
          startMs: Number(line.startMs) || 0,
          endMs: Number(line.endMs) || Number(line.startMs) || 0,
          useGlobalStyle: line.useGlobalStyle !== false,
          style: line.style ? ensureCaptionStyle(line.style) : null,
        }))
      : [],
    style: ensureCaptionStyle(captions.style),
    displayRanges: Array.isArray(captions.displayRanges)
      ? captions.displayRanges.map((r) => ({
          startMs: Number(r.startMs) || 0,
          endMs: Number(r.endMs) || Number(r.startMs) || 0,
          mode: r.mode === "word" ? "word" : "line",
        }))
      : [],
  };
};

const INTENT_OPTIONS = [
  { value: "visual", label: "Visual moment" },
  { value: "dialogue", label: "Dialogue focus" },
  { value: "custom", label: "Custom" },
];

const INTENT_LABEL_MAP = INTENT_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

const GUIDELINE_PRESETS = [
  { value: "dialogue", label: "Dialogue" },
  { value: "intense", label: "Intense" },
  { value: "tender", label: "Tender" },
];

const formatSecondsLabel = (seconds) => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "0.000";
  }
  return seconds.toFixed(3);
};

// For editable text inputs: show a friendly seconds string without forcing trailing zeros.
const formatSecondsInput = (ms) => {
  const seconds = (Number(ms) || 0) / 1000;
  const fixed = seconds.toFixed(3);
  return fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
};

// Returns a finite number (seconds) or null if not currently parseable.
const parseSecondsInput = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  return num;
};

const LIVE_PREVIEW_COLORS = [
  { bg: "#f97316", text: "#0b0b0b" },
  { bg: "#22c55e", text: "#041307" },
  { bg: "#3b82f6", text: "#081021" },
  { bg: "#a855f7", text: "#0f0620" },
  { bg: "#eab308", text: "#0f0f03" },
  { bg: "#ef4444", text: "#1a0505" },
];

const LivePreview = ({
  currentTime = 0,
  segments = [],
  rapidRanges = [],
  fps = TARGET_FPS,
  duration = 0,
}) => {
  const clipIndex = useMemo(() => {
    const points = [];

    // Base segment boundaries
    if (Array.isArray(segments) && segments.length) {
      segments.forEach((s) => {
        if (Number.isFinite(s?.start)) points.push(s.start);
      });
    } else {
      points.push(0);
    }

    // Rapid range sub-segments
    const minStep = 1 / (fps || TARGET_FPS);
    rapidRanges.forEach((r) => {
      const start = Number(r?.start);
      const end = Number(r?.end);
      const interval = Number.isFinite(r?.interval) ? Math.max(r.interval, minStep) : minStep;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      points.push(start);
      for (let t = start + interval; t < end - 1e-6; t += interval) {
        points.push(t);
      }
    });

    // Ensure we don't overflow past duration
    if (Number.isFinite(duration) && duration > 0) points.push(duration);

    const sorted = Array.from(new Set(points.filter(Number.isFinite))).sort((a, b) => a - b);
    if (!sorted.length) return 0;

    let idx = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      if (currentTime >= sorted[i]) idx = i;
      else break;
    }
    return idx;
  }, [segments, rapidRanges, currentTime, fps, duration]);

  const color = LIVE_PREVIEW_COLORS[clipIndex % LIVE_PREVIEW_COLORS.length];
  const displayNumber = clipIndex + 1;

  return (
    <div
      className="w-full h-full flex items-center justify-center rounded-xl"
      style={{ background: color.bg, color: color.text }}
    >
      <div className="text-4xl md:text-5xl font-black font-mono drop-shadow-sm">
        {displayNumber}
      </div>
    </div>
  );
};

const mergeIntroBeatState = (current, patch = {}) => {
  const normalized = normalizeIntroBeat(current);
  const clipSlot = patch.clipSlot
    ? {
        ...normalized.clipSlot,
        ...patch.clipSlot,
      }
    : { ...normalized.clipSlot };
  const next = {
    ...normalized,
    ...patch,
    clipSlot,
    guidelineTags: Array.isArray(patch.guidelineTags)
      ? patch.guidelineTags
      : normalized.guidelineTags,
  };
  return normalizeIntroBeat(next);
};

const FormatBuilderPage = () => {
  // Song and format state
  const [selectedSong, setSelectedSong] = useState(null);
  const [format, setFormat] = useState(null);
  const [formatExists, setFormatExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [rangeDeleteStart, setRangeDeleteStart] = useState(null);
  const [rangeDeleteEnd, setRangeDeleteEnd] = useState(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);

  // Audio state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);
  
  // Waveform visualization state
  const [waveformData, setWaveformData] = useState(null);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [waveformSaved, setWaveformSaved] = useState(false);
  const [hasWaveformBackup, setHasWaveformBackup] = useState(false);
  const [regeneratingWaveform, setRegeneratingWaveform] = useState(false);
  const [globalVolumes, setGlobalVolumes] = useState({
    clipVolume: DEFAULT_CLIP_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
  });
  const globalVolumesInitializedRef = useRef(false);

  // View state
  const [activeTab, setActiveTab] = useState("editor"); // "editor" | "tester"
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [captionsSaving, setCaptionsSaving] = useState(false);
  const [captionsError, setCaptionsError] = useState(null);
  // Keep raw user-typed values so we don't fight cursor/formatting while typing.
  // We still update the underlying ms values when input is parseable.
  const [captionTimeDrafts, setCaptionTimeDrafts] = useState({});
  const [captionPreviewOpen, setCaptionPreviewOpen] = useState(false);
  const [captionEditScope, setCaptionEditScope] = useState("all");
  const [selectedCaptionLine, setSelectedCaptionLine] = useState(null);
  const [selectedCaptionWord, setSelectedCaptionWord] = useState(null);
  const [selectedCaptionKeys, setSelectedCaptionKeys] = useState([]);
  const [lastCaptionSelectionIndex, setLastCaptionSelectionIndex] = useState(null);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [editModal, setEditModal] = useState(null);
  const [bulkEditModal, setBulkEditModal] = useState(null);
  const [renderLoading, setRenderLoading] = useState(false);
  const [renderError, setRenderError] = useState(null);
  const [renderUrl, setRenderUrl] = useState(null);
  const [overlayVisibility, setOverlayVisibility] = useState({
    marks: true,
    rapidRanges: true,
    lyrics: true,
    wordLyrics: true,
  });
  const [activeCaptionVariant, setActiveCaptionVariant] = useState("lyrics");
  const [captionPlacements, setCaptionPlacements] = useState({ lyrics: "top", clip: "layered" });
  const layeredCaptions = useMemo(
    () => Object.values(captionPlacements || {}).includes("layered"),
    [captionPlacements]
  );
  const [waveformEnabled, setWaveformEnabled] = useState(true);
  const [waveformActiveLayers, setWaveformActiveLayers] = useState({});
  const [waveformLayerStrengths, setWaveformLayerStrengths] = useState({});
  const [activeLayer, setActiveLayer] = useState("background"); // background | foreground

  const fps = useMemo(() => {
    return format?.meta?.targetFps || TARGET_FPS;
  }, [format?.meta?.targetFps]);

  const songDuration = useMemo(() => {
    if (format?.meta?.durationSeconds) {
      return format.meta.durationSeconds;
    }
    return duration || 0;
  }, [format?.meta?.durationSeconds, duration]);

  const cutoutEnabled = useMemo(
    () => Boolean(format?.cutoutEnabled),
    [format?.cutoutEnabled]
  );

  const foregroundDefaults = useMemo(
    () => ({
      beatGrid: [],
      beatGridFrames: [],
      beatGridFramePairs: [],
      beatMetadata: [],
      rapidClipRanges: [],
      rapidClipFrames: [],
      clipSegments: [],
    }),
    []
  );

  const hydrateForeground = useCallback(
    (fg = {}) => ({
      ...foregroundDefaults,
      ...fg,
      beatGrid: Array.isArray(fg.beatGrid) ? fg.beatGrid : [],
      beatGridFrames: Array.isArray(fg.beatGridFrames) ? fg.beatGridFrames : [],
      beatGridFramePairs: Array.isArray(fg.beatGridFramePairs)
        ? fg.beatGridFramePairs
        : [],
      beatMetadata: applyForegroundClipDefaults(
        Array.isArray(fg.beatMetadata) ? fg.beatMetadata : []
      ),
      rapidClipRanges: Array.isArray(fg.rapidClipRanges)
        ? fg.rapidClipRanges
        : [],
      rapidClipFrames: Array.isArray(fg.rapidClipFrames)
        ? fg.rapidClipFrames
        : [],
      clipSegments: Array.isArray(fg.clipSegments) ? fg.clipSegments : [],
    }),
    [foregroundDefaults]
  );

  const foregroundLayer = useMemo(() => {
    if (!format?.foreground) return foregroundDefaults;
    return hydrateForeground(format.foreground);
  }, [format?.foreground, foregroundDefaults, hydrateForeground]);

  const isForegroundLayer = cutoutEnabled && activeLayer === "foreground";

  const layerBeatGrid = isForegroundLayer
    ? foregroundLayer.beatGrid || []
    : format?.beatGrid || [];

  const layerBeatMetadata = isForegroundLayer
    ? foregroundLayer.beatMetadata || []
    : format?.beatMetadata || [];

  const layerRapidClipRanges = isForegroundLayer
    ? foregroundLayer.rapidClipRanges || []
    : format?.rapidClipRanges || [];

  const enabledForegroundBeatGrid = useMemo(
    () =>
      getEnabledBeatGrid(
        foregroundLayer.beatGrid || [],
        foregroundLayer.beatMetadata || []
      ),
    [foregroundLayer.beatGrid, foregroundLayer.beatMetadata]
  );

  useEffect(() => {
    if (!cutoutEnabled && activeLayer === "foreground") {
      setActiveLayer("background");
    }
  }, [cutoutEnabled, activeLayer]);

  const handleToggleCutoutLayer = useCallback(() => {
    setFormat((prev) => {
      if (!prev) return prev;
      const nextEnabled = !prev.cutoutEnabled;
      const nextForeground = hydrateForeground(prev.foreground || {});
      return {
        ...prev,
        cutoutEnabled: nextEnabled,
        foreground: nextForeground,
      };
    });
    setActiveLayer((prevLayer) => (!cutoutEnabled ? "foreground" : "background"));
    setHasUnsavedChanges(true);
  }, [cutoutEnabled, foregroundDefaults, hydrateForeground]);

  const handleLayerSwitch = useCallback(
    (layer) => {
      if (layer === "foreground" && !cutoutEnabled) {
        return;
      }
      setActiveLayer(layer);
    },
    [cutoutEnabled]
  );

  // Canonical beat state is stored in frames; seconds are derived for display/metadata
  const updateBeatGridFrames = useCallback(
    (mutator, layer = activeLayer) => {
      setFormat((prev) => {
        if (!prev) return prev;
        const target = layer === "foreground" ? prev.foreground || {} : prev;
        const currentFrames = Array.isArray(target.beatGridFrames)
          ? [...target.beatGridFrames]
          : Array.isArray(target.beatGrid)
          ? target.beatGrid.map((t) => secondsToFrame(t, fps))
          : [];

        const nextFrames = Array.from(
          new Set(
            mutator(currentFrames)
              .map((f) => Math.max(0, Math.round(f)))
              .filter((f) => Number.isFinite(f))
          )
        ).sort((a, b) => a - b);

        const nextSeconds = nextFrames.map((f) => frameToSeconds(f, fps));
        const nextMetadata = normalizeBeatMetadata(
          nextSeconds,
          target.beatMetadata || []
        );
        const nextFramePairs = nextFrames.map((frame) => ({
          frame,
          time: frameToSeconds(frame, fps),
        }));

        if (layer === "foreground") {
          return {
            ...prev,
            cutoutEnabled: true,
            foreground: {
              ...target,
              beatGridFrames: nextFrames,
              beatGrid: nextSeconds,
              beatGridFramePairs: nextFramePairs,
              beatMetadata: applyForegroundClipDefaults(nextMetadata),
            },
          };
        }

        return {
          ...prev,
          beatGridFrames: nextFrames,
          beatGrid: nextSeconds,
          beatGridFramePairs: nextFramePairs,
          beatMetadata: nextMetadata,
        };
      });
      setHasUnsavedChanges(true);
    },
    [activeLayer, fps, setFormat]
  );

  const updateMixSegments = useCallback(
    (mutator) => {
      setFormat((prev) => {
        if (!prev) return prev;
        const currentSegments = Array.isArray(prev.mixSegments)
          ? [...prev.mixSegments]
          : [];
        const nextSegments = mutator(currentSegments);
        return {
          ...prev,
          mixSegments: normalizeMixSegments(nextSegments, songDuration),
        };
      });
      setHasUnsavedChanges(true);
    },
    [songDuration]
  );

  const handleBeatMetadataChange = useCallback(
    (index, patch) => {
      setFormat((prev) => {
        if (!prev) return prev;
        if (activeLayer === "foreground") {
          const fg = prev.foreground || {};
          const existing = Array.isArray(fg.beatMetadata)
            ? [...fg.beatMetadata]
            : [];
          if (!existing[index]) {
            return prev;
          }
          const next = existing.map((entry, idx) => {
            if (idx !== index) return entry;
            const merged = { ...entry, ...patch };
            if (patch.clipSlot) {
              merged.clipSlot = {
                ...entry.clipSlot,
                ...patch.clipSlot,
              };
            }
            if (patch.guidelineTags) {
              merged.guidelineTags = patch.guidelineTags;
            }
            return merged;
          });
          return {
            ...prev,
            cutoutEnabled: true,
            foreground: {
              ...fg,
              beatMetadata: normalizeBeatMetadata(
                fg.beatGrid || [],
                next
              ),
            },
          };
        }

        const existing = Array.isArray(prev.beatMetadata)
          ? [...prev.beatMetadata]
          : [];
        if (!existing[index]) {
          return prev;
        }
        const next = existing.map((entry, idx) => {
          if (idx !== index) return entry;
          const merged = { ...entry, ...patch };
          if (patch.clipSlot) {
            merged.clipSlot = {
              ...entry.clipSlot,
              ...patch.clipSlot,
            };
          }
          if (patch.guidelineTags) {
            merged.guidelineTags = patch.guidelineTags;
          }
          return merged;
        });
        return {
          ...prev,
          beatMetadata: normalizeBeatMetadata(prev.beatGrid || [], next),
        };
      });
      setHasUnsavedChanges(true);
    },
    [activeLayer]
  );

  const handleIntroBeatUpdate = useCallback(
    (patchOrUpdater) => {
      let didUpdate = false;
      setFormat((prev) => {
        if (!prev) return prev;
        const normalizedIntroBeat = normalizeIntroBeat(prev.introBeat);
        const patch =
          typeof patchOrUpdater === "function"
            ? patchOrUpdater(normalizedIntroBeat)
            : patchOrUpdater;
        if (!patch) return prev;
        didUpdate = true;
        return {
          ...prev,
          introBeat: mergeIntroBeatState(normalizedIntroBeat, patch),
        };
      });
      if (didUpdate) {
        setHasUnsavedChanges(true);
      }
    },
    [setFormat, setHasUnsavedChanges]
  );

  const handleIntroBeatLabelChange = useCallback(
    (value) => {
      handleIntroBeatUpdate({ label: value });
    },
    [handleIntroBeatUpdate]
  );

  const handleIntroIntentChange = useCallback(
    (intent) => {
      handleIntroBeatUpdate({ intent });
    },
    [handleIntroBeatUpdate]
  );

  const handleIntroGuidelineTagToggle = useCallback(
    (tag) => {
      if (!tag) return;
      handleIntroBeatUpdate((current) => {
        const tags = new Set(current.guidelineTags || []);
        if (tags.has(tag)) {
          tags.delete(tag);
        } else {
          tags.add(tag);
        }
        return { guidelineTags: Array.from(tags) };
      });
    },
    [handleIntroBeatUpdate]
  );

  const handleIntroPauseToggle = useCallback(
    (pauseMusic) => {
      handleIntroBeatUpdate({
        clipSlot: {
          pauseMusic,
          resumeMode: pauseMusic ? "clip_end" : "beat",
        },
      });
    },
    [handleIntroBeatUpdate]
  );

  const handleIntroClipVolumeChange = useCallback(
    (field, value) => {
      handleIntroBeatUpdate({
        clipSlot: {
          [field]: value,
        },
      });
    },
    [handleIntroBeatUpdate]
  );

  const handleIntroCustomGuidelineChange = useCallback(
    (value) => {
      handleIntroBeatUpdate({ customGuideline: value });
    },
    [handleIntroBeatUpdate]
  );

  const handleGuidelineTagToggle = useCallback(
    (index, tag) => {
      if (!tag) return;
      setFormat((prev) => {
        if (!prev) return prev;
        if (activeLayer === "foreground") {
          const fg = prev.foreground || {};
          const next = (fg.beatMetadata || []).map((entry, idx) => {
            if (idx !== index) return entry;
            const tags = new Set(entry.guidelineTags || []);
            if (tags.has(tag)) {
              tags.delete(tag);
            } else {
              tags.add(tag);
            }
            return {
              ...entry,
              guidelineTags: Array.from(tags),
            };
          });
          return {
            ...prev,
            cutoutEnabled: true,
            foreground: {
              ...fg,
              beatMetadata: normalizeBeatMetadata(fg.beatGrid || [], next),
            },
          };
        }
        const next = (prev.beatMetadata || []).map((entry, idx) => {
          if (idx !== index) return entry;
          const tags = new Set(entry.guidelineTags || []);
          if (tags.has(tag)) {
            tags.delete(tag);
          } else {
            tags.add(tag);
          }
          return {
            ...entry,
            guidelineTags: Array.from(tags),
          };
        });
        return {
          ...prev,
          beatMetadata: normalizeBeatMetadata(prev.beatGrid || [], next),
        };
      });
      setHasUnsavedChanges(true);
    },
    [activeLayer]
  );

  const handleIntentChange = useCallback(
    (index, intent) => {
      handleBeatMetadataChange(index, { intent });
    },
    [handleBeatMetadataChange]
  );

  const handlePauseToggle = useCallback(
    (index, pauseMusic) => {
      handleBeatMetadataChange(index, {
        clipSlot: {
          pauseMusic,
          resumeMode: pauseMusic ? "clip_end" : "beat",
        },
      });
    },
    [handleBeatMetadataChange]
  );

  const handleClipVolumeChange = useCallback(
    (index, field, value) => {
      handleBeatMetadataChange(index, {
        clipSlot: {
          [field]: value,
        },
      });
    },
    [handleBeatMetadataChange]
  );

  const applyGlobalVolumes = useCallback(
    ({ clipVolume, musicVolume }) => {
      setFormat((prev) => {
        if (!prev) return prev;
        const normalizedBeatMetadata = normalizeBeatMetadata(
          prev.beatGrid || [],
          prev.beatMetadata || []
        );
        const nextBeatMetadata = normalizedBeatMetadata.map((entry) => ({
          ...entry,
          clipSlot: {
            ...entry.clipSlot,
            clipVolume,
            musicVolume,
          },
        }));

        const foreground = prev.foreground || {};
        const normalizedFgBeatMetadata = normalizeBeatMetadata(
          foreground.beatGrid || [],
          foreground.beatMetadata || []
        );
        const nextFgBeatMetadata = applyForegroundClipDefaults(
          normalizedFgBeatMetadata.map((entry) => ({
            ...entry,
            clipSlot: {
              ...entry.clipSlot,
              clipVolume,
              musicVolume,
            },
          }))
        );

        return {
          ...prev,
          beatMetadata: nextBeatMetadata,
          introBeat: mergeIntroBeatState(prev.introBeat, {
            clipSlot: {
              clipVolume,
              musicVolume,
            },
          }),
          foreground: {
            ...foreground,
            beatMetadata: nextFgBeatMetadata,
          },
        };
      });
      setHasUnsavedChanges(true);
    },
    [setFormat]
  );

  const handleGlobalVolumeSliderChange = useCallback(
    (field, rawValue) => {
      const numericValue = clampVolume(
        typeof rawValue === "number" ? rawValue : parseFloat(rawValue),
        field === "clipVolume" ? DEFAULT_CLIP_VOLUME : DEFAULT_MUSIC_VOLUME
      );
      setGlobalVolumes((prev) => {
        const next = { ...prev, [field]: numericValue };
        applyGlobalVolumes(next);
        return next;
      });
    },
    [applyGlobalVolumes]
  );

  // Load format when song is selected
  const loadFormat = useCallback(async (song) => {
    if (!song) {
      setFormat(null);
      setFormatExists(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/format-builder-6/get?slug=${song.slug}`);
      if (!res.ok) throw new Error("Failed to load format");
      const data = await res.json();

      setFormatExists(data.exists);
      const resolvedFps = data.format?.meta?.targetFps || TARGET_FPS;

      // Support legacy beatGridFrames shape (array of { frame, time }) and new numeric arrays
      const existingBeatSeconds = Array.isArray(data.format.beatGrid)
        ? data.format.beatGrid
            .filter((t) => Number.isFinite(t))
            .sort((a, b) => a - b)
        : [];

      const incomingBeatFrames = Array.isArray(data.format.beatGridFrames)
        ? data.format.beatGridFrames
            .map((entry) => {
              if (typeof entry === "number") return Math.round(entry);
              if (entry && typeof entry === "object") {
                if (typeof entry.frame === "number") return Math.round(entry.frame);
                if (typeof entry.time === "number") {
                  return Math.round(secondsToFrame(entry.time, resolvedFps));
                }
              }
              return null;
            })
            .filter((f) => Number.isFinite(f))
        : null;

      const normalizeFrames = (frames) =>
        Array.from(new Set(frames)).sort((a, b) => a - b);

      const beatGridFrames =
        incomingBeatFrames?.length
          ? normalizeFrames(incomingBeatFrames)
          : existingBeatSeconds.length
          ? normalizeFrames(
              existingBeatSeconds.map((t) => secondsToFrame(t, resolvedFps))
            )
          : [];

      const beatGridSeconds = incomingBeatFrames?.length
        ? beatGridFrames.map((f) => frameToSeconds(f, resolvedFps))
        : existingBeatSeconds;

      const normalizedBeatMetadata = normalizeBeatMetadata(
        beatGridSeconds,
        data.format.beatMetadata || []
      );
      const normalizedMixSegments = normalizeMixSegments(
        data.format.mixSegments || [],
        data.format.meta?.durationSeconds
      );
      const normalizedCaptions = normalizeCaptions(data.format.captions);
      const incomingPlacements = data.format?.captionPlacements || {};
      setCaptionPlacements({
        lyrics: incomingPlacements.lyrics || "top",
        clip: incomingPlacements.clip || "layered",
      });
      setFormat({
        ...data.format,
        source: song.path,
        beatGrid: beatGridSeconds,
        beatGridFrames,
        beatMetadata: normalizedBeatMetadata,
        mixSegments: normalizedMixSegments,
        introBeat: normalizeIntroBeat(data.format.introBeat),
        captions: normalizedCaptions,
      });
      setCaptionsEnabled(
        normalizedCaptions
          ? typeof normalizedCaptions.enabled === "boolean"
            ? normalizedCaptions.enabled
            : true
          : false
      );
      setOverlayVisibility((prev) => ({
        ...prev,
        marks: true,
        rapidRanges: true,
        lyrics: Boolean(normalizedCaptions && captionsEnabled),
        wordLyrics: Boolean(normalizedCaptions && captionsEnabled),
      }));
      setHasUnsavedChanges(false);
    } catch (err) {
      setError(err.message);
      setFormat(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load saved waveform data or analyze if not exists
  const loadWaveform = useCallback(async (song) => {
    if (!song) {
      setWaveformData(null);
      setWaveformSaved(false);
      setHasWaveformBackup(false);
      return;
    }

    setWaveformLoading(true);

    try {
      // First, check for saved waveform data
      const savedRes = await fetch(`/api/format-builder-6/waveform/get?slug=${song.slug}`);
      if (savedRes.ok) {
        const savedData = await savedRes.json();
        if (savedData.exists && savedData.waveformData) {
          setWaveformData(savedData.waveformData);
          setWaveformSaved(true);
          setHasWaveformBackup(savedData.hasBackup);
          setWaveformLoading(false);
          return;
        }
        setHasWaveformBackup(savedData.hasBackup);
      }

      // No saved data, analyze the song
      const res = await fetch("/api/format-builder-6/waveform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songPath: song.path,
          targetPoints: 600,
        }),
      });

      if (!res.ok) {
        console.warn("Failed to analyze waveform data");
        setWaveformData(null);
        return;
      }

      const data = await res.json();
      setWaveformData(data);

      // Auto-save the analyzed waveform data
      const saveRes = await fetch("/api/format-builder-6/waveform/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: song.slug,
          waveformData: data,
        }),
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        setWaveformSaved(true);
        setHasWaveformBackup(saveData.hasBackup);
      }
    } catch (err) {
      console.warn("Waveform loading error:", err);
      setWaveformData(null);
    } finally {
      setWaveformLoading(false);
    }
  }, []);

  const updateCaptions = useCallback(
    (updater) => {
      let didUpdate = false;
      setFormat((prev) => {
        if (!prev) return prev;
        const base =
          normalizeCaptions(prev.captions) || {
            provider: "manual",
            status: "draft",
            requestedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            words: [],
            lines: [],
            style: ensureCaptionStyle(prev.captions?.style),
          };
        const next = typeof updater === "function" ? updater(base) : updater;
        didUpdate = true;
        return {
          ...prev,
          captions: normalizeCaptions(next),
        };
      });
      if (didUpdate) {
        setHasUnsavedChanges(true);
      }
    },
    []
  );

  const handleCaptionStyleChange = useCallback(
    (field, value) => {
      updateCaptions((current) => ({
        ...current,
        style: {
          ...ensureCaptionStyle(current.style),
          [field]: value,
        },
        updatedAt: new Date().toISOString(),
      }));
    },
    [updateCaptions]
  );

  const handleCaptionLineChange = useCallback(
    (index, patch) => {
      updateCaptions((current) => {
        if (!Array.isArray(current.lines)) return current;
        const nextLines = current.lines.map((line, idx) =>
          idx === index ? { ...line, ...patch } : line
        );
        return {
          ...current,
          lines: nextLines,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [updateCaptions]
  );

  const handleAddLine = useCallback(() => {
    updateCaptions((current) => ({
      ...current,
      lines: [
        ...(current.lines || []),
        {
          text: "New line",
          startMs: 0,
          endMs: 1000,
          useGlobalStyle: true,
          style: ensureCaptionStyle(current.style),
        },
      ],
      updatedAt: new Date().toISOString(),
    }));
  }, [updateCaptions]);

  const handleAddWord = useCallback(() => {
    updateCaptions((current) => ({
      ...current,
      words: [
        ...(current.words || []),
        {
          text: "New",
          startMs: 0,
          endMs: 500,
          useGlobalStyle: true,
          style: null,
        },
      ],
      updatedAt: new Date().toISOString(),
    }));
  }, [updateCaptions]);

  const handleConvertWordToLine = useCallback(
    (index) => {
      updateCaptions((current) => {
        if (!current.words?.[index]) return current;
        const word = current.words[index];
        const line = {
          text: word.text,
          startMs: word.startMs ?? 0,
          endMs: word.endMs ?? word.startMs ?? 0,
          useGlobalStyle: word.useGlobalStyle !== false,
          style: word.useGlobalStyle === false && word.style
            ? ensureCaptionStyle(word.style)
            : ensureCaptionStyle(current.style),
        };
        const nextWords = [...current.words];
        nextWords.splice(index, 1);
        return {
          ...current,
          words: nextWords,
          lines: [...(current.lines || []), line],
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [updateCaptions]
  );

  const handleConvertLineToWords = useCallback(
    (index) => {
      updateCaptions((current) => {
        if (!current.lines?.[index]) return current;
        const line = current.lines[index];
        const textParts = (line.text || "").split(/\s+/).filter(Boolean);
        const duration = Math.max(0, (line.endMs ?? line.startMs ?? 0) - (line.startMs ?? 0));
        const slice = textParts.length ? duration / textParts.length : duration;
        let cursor = line.startMs ?? 0;
        const newWords = textParts.map((t, idx) => {
          const start = cursor;
          const end = idx === textParts.length - 1 ? line.endMs ?? start : cursor + slice;
          cursor = end;
          return {
            text: t,
            startMs: start,
            endMs: end,
            useGlobalStyle: line.useGlobalStyle !== false,
            style:
              line.useGlobalStyle === false && line.style
                ? ensureCaptionStyle(line.style)
                : null,
          };
        });
        const nextLines = [...current.lines];
        nextLines.splice(index, 1);
        return {
          ...current,
          lines: nextLines,
          words: [...(current.words || []), ...newWords],
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [updateCaptions]
  );

  const handleConvertAllToWords = useCallback(() => {
    updateCaptions((current) => {
      const lines = current.lines || [];
      if (!lines.length) return current;
      const allWords = lines.flatMap((line) => {
        const textParts = (line.text || "").split(/\s+/).filter(Boolean);
        const duration = Math.max(0, (line.endMs ?? line.startMs ?? 0) - (line.startMs ?? 0));
        const slice = textParts.length ? duration / textParts.length : duration;
        let cursor = line.startMs ?? 0;
        return textParts.map((t, idx) => {
          const start = cursor;
          const end = idx === textParts.length - 1 ? line.endMs ?? start : cursor + slice;
          cursor = end;
          return {
            text: t,
            startMs: start,
            endMs: end,
            useGlobalStyle: line.useGlobalStyle !== false,
            style:
              line.useGlobalStyle === false && line.style
                ? ensureCaptionStyle(line.style)
                : null,
          };
        });
      });
      return {
        ...current,
        lines: [],
        words: [...(current.words || []), ...allWords],
        updatedAt: new Date().toISOString(),
      };
    });
  }, [updateCaptions]);

  const handleConvertAllToLines = useCallback(() => {
    updateCaptions((current) => {
      const words = current.words || [];
      if (!words.length) return current;
      const allLines = words.map((word) => ({
        text: word.text || "",
        startMs: word.startMs ?? 0,
        endMs: word.endMs ?? word.startMs ?? 0,
        useGlobalStyle: word.useGlobalStyle !== false,
        style:
          word.useGlobalStyle === false && word.style
            ? ensureCaptionStyle(word.style)
            : ensureCaptionStyle(current.style),
      }));
      return {
        ...current,
        words: [],
        lines: [...(current.lines || []), ...allLines],
        updatedAt: new Date().toISOString(),
      };
    });
  }, [updateCaptions]);

  const handleRemoveLine = useCallback(
    (index) => {
      updateCaptions((current) => {
        if (!current.lines?.[index]) return current;
        const next = [...current.lines];
        next.splice(index, 1);
        return { ...current, lines: next, updatedAt: new Date().toISOString() };
      });
    },
    [updateCaptions]
  );

  const handleRemoveWord = useCallback(
    (index) => {
      updateCaptions((current) => {
        if (!current.words?.[index]) return current;
        const next = [...current.words];
        next.splice(index, 1);
        return { ...current, words: next, updatedAt: new Date().toISOString() };
      });
    },
    [updateCaptions]
  );

  const saveEditModal = useCallback(() => {
    if (!editModal) return;
    const { index, draft } = editModal;
    const startSeconds =
      draft.startSecondsText !== undefined
        ? parseSecondsInput(draft.startSecondsText)
        : (Number(draft.startMs) || 0) / 1000;
    const endSeconds =
      draft.endSecondsText !== undefined
        ? parseSecondsInput(draft.endSecondsText)
        : (Number(draft.endMs) || 0) / 1000;

    if (startSeconds === null || endSeconds === null) {
      setCaptionsError("Start/End must be a valid number of seconds.");
      return;
    }
    if (startSeconds < 0 || endSeconds < 0) {
      setCaptionsError("Start/End must be ≥ 0 seconds.");
      return;
    }
    if (endSeconds < startSeconds) {
      setCaptionsError("End must be ≥ Start.");
      return;
    }
    if (songDuration && endSeconds > songDuration) {
      setCaptionsError(`End must be ≤ song duration (${formatSecondsLabel(songDuration)}s).`);
      return;
    }

    const nextStartMs = Math.round(startSeconds * 1000);
    const nextEndMs = Math.round(endSeconds * 1000);
    setCaptionsError(null);

    if (editModal.type === "line") {
      updateCaptions((current) => {
        const next = [...(current.lines || [])];
        if (!next[index]) return current;
        next[index] = {
          ...next[index],
          text: draft.text,
          startMs: nextStartMs,
          endMs: nextEndMs,
          useGlobalStyle: draft.useGlobalStyle,
          style: draft.useGlobalStyle ? null : ensureCaptionStyle(draft.style),
        };
        return { ...current, lines: next, updatedAt: new Date().toISOString() };
      });
    }
    if (editModal.type === "word") {
      updateCaptions((current) => {
        const next = [...(current.words || [])];
        if (!next[index]) return current;
        next[index] = {
          ...next[index],
          text: draft.text,
          startMs: nextStartMs,
          endMs: nextEndMs,
          useGlobalStyle: draft.useGlobalStyle,
          style: draft.useGlobalStyle ? null : ensureCaptionStyle(draft.style),
        };
        return { ...current, words: next, updatedAt: new Date().toISOString() };
      });
    }
    setCaptionTimeDrafts((prev) => {
      const next = { ...(prev || {}) };
      delete next[`${editModal.type}-${index}`];
      return next;
    });
    setEditModal(null);
  }, [editModal, songDuration, updateCaptions]);

  const cancelEditModal = useCallback(() => setEditModal(null), []);

  const handleGenerateCaptions = useCallback(async () => {
    if (!selectedSong) return;
    if (
      format?.captions &&
      !window.confirm("Regenerate lyrics and replace existing captions?")
    ) {
      return;
    }

    setCaptionsLoading(true);
    setCaptionsError(null);
    try {
      const res = await fetch("/api/format-builder-6/captions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: selectedSong.slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate captions");
      }
      const data = await res.json();
      const normalizedCaptions = normalizeCaptions(data.captions);
      setFormat((prev) => ({
        ...(data.format || prev || {}),
        captions: normalizedCaptions,
      }));
      setOverlayVisibility((prev) => ({ ...prev, lyrics: true }));
      setHasUnsavedChanges(false);
      setSuccessMessage("Lyrics generated and saved");
      setTimeout(() => setSuccessMessage(null), 3000);
      setCaptionTimeDrafts({});
    } catch (err) {
      setCaptionsError(err.message);
    } finally {
      setCaptionsLoading(false);
    }
  }, [format?.captions, selectedSong]);

  const handleActiveCaptionVariantChange = useCallback((variant) => {
    setActiveCaptionVariant(variant);
  }, []);

  const handleCaptionPlacementChange = useCallback(
    (placement) => {
      setCaptionPlacements((prev) => {
        const next = { ...(prev || {}) };
        next[activeCaptionVariant] = placement;
        return next;
      });
      setHasUnsavedChanges(true);
    },
    [activeCaptionVariant]
  );

  const validateCaptionTimeDrafts = useCallback(() => {
    if (!format?.captions) return { ok: true };
    const issues = [];

    for (const [key, fields] of Object.entries(captionTimeDrafts || {})) {
      const [type, indexText] = String(key).split("-");
      const index = Number(indexText);
      if (!Number.isInteger(index)) continue;

      const entry =
        type === "line"
          ? format.captions.lines?.[index]
          : type === "word"
          ? format.captions.words?.[index]
          : null;
      if (!entry) continue;

      const startText = fields?.start;
      const endText = fields?.end;

      const startSeconds =
        startText !== undefined ? parseSecondsInput(startText) : (Number(entry.startMs) || 0) / 1000;
      const endSeconds =
        endText !== undefined ? parseSecondsInput(endText) : (Number(entry.endMs) || 0) / 1000;

      if (startText !== undefined && (startSeconds === null || startSeconds < 0)) {
        issues.push(`${type} #${index + 1} start`);
        continue;
      }
      if (endText !== undefined && (endSeconds === null || endSeconds < 0)) {
        issues.push(`${type} #${index + 1} end`);
        continue;
      }
      if (startSeconds !== null && endSeconds !== null && endSeconds < startSeconds) {
        issues.push(`${type} #${index + 1} end < start`);
        continue;
      }
      if (songDuration && endSeconds !== null && endSeconds > songDuration) {
        issues.push(`${type} #${index + 1} end > duration`);
        continue;
      }
    }

    if (!issues.length) return { ok: true };
    const suffix = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
    return {
      ok: false,
      message: `Fix invalid caption times before saving (${issues[0]}${suffix}).`,
    };
  }, [captionTimeDrafts, format?.captions, songDuration]);

  const handleSaveCaptionsOnly = useCallback(async () => {
    if (!selectedSong || !format?.captions) return;
    setCaptionsSaving(true);
    setCaptionsError(null);
    try {
      const validation = validateCaptionTimeDrafts();
      if (!validation.ok) {
        setCaptionsError(validation.message);
        return;
      }
      const res = await fetch("/api/format-builder-6/captions/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: selectedSong.slug, captions: format.captions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save captions");
      }
      const data = await res.json();
      const normalizedCaptions = normalizeCaptions(data.captions || format.captions);
      setFormat((prev) => ({
        ...(prev || {}),
        ...(data.format || {}),
        captions: normalizedCaptions,
        captionPlacements,
      }));
      setHasUnsavedChanges(false);
      setSuccessMessage("Captions saved");
      setTimeout(() => setSuccessMessage(null), 2500);
      setCaptionTimeDrafts({});
    } catch (err) {
      setCaptionsError(err.message);
    } finally {
      setCaptionsSaving(false);
    }
  }, [format?.captions, selectedSong, validateCaptionTimeDrafts]);

  const handleRenderCaptions = useCallback(async () => {
    if (!selectedSong) return;
    setRenderLoading(true);
    setRenderError(null);
    setRenderUrl(null);
    try {
      const validation = validateCaptionTimeDrafts();
      if (!validation.ok) {
        setRenderError(validation.message);
        return;
      }
      if (hasUnsavedChanges && format?.captions) {
        const saveRes = await fetch("/api/format-builder-6/captions/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: selectedSong.slug, captions: format.captions }),
        });
        if (!saveRes.ok) {
          const data = await saveRes.json().catch(() => ({}));
          throw new Error(data.error || "Failed to save captions before render");
        }
        const data = await saveRes.json();
        const normalizedCaptions = normalizeCaptions(data.captions || format.captions);
        setFormat((prev) => ({
          ...(prev || {}),
          ...(data.format || {}),
          captions: normalizedCaptions,
        }));
        setHasUnsavedChanges(false);
        setCaptionTimeDrafts({});
      }
      const res = await fetch("/api/format-builder-6/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: selectedSong.slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to render captions");
      }
      const data = await res.json();
      setRenderUrl(data.url);
      setSuccessMessage("Render complete");
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err) {
      setRenderError(err.message);
    } finally {
      setRenderLoading(false);
    }
  }, [selectedSong, hasUnsavedChanges, format?.captions, validateCaptionTimeDrafts]);

  const applyCaptionTextTransform = useCallback(
    (transformFn) => {
      updateCaptions((current) => {
        if (!current) return current;
        const nextWords = (current.words || []).map((w) => ({
          ...w,
          text: transformFn(w.text || ""),
        }));
        const nextLines = (current.lines || []).map((l) => ({
          ...l,
          text: transformFn(l.text || ""),
        }));
        return {
          ...current,
          words: nextWords,
          lines: nextLines,
          updatedAt: new Date().toISOString(),
        };
      });
      setHasUnsavedChanges(true);
    },
    [updateCaptions]
  );

  const handleSetAllCaps = useCallback(() => {
    applyCaptionTextTransform((text) => text.toUpperCase());
  }, [applyCaptionTextTransform]);

  const handleSetSentenceCase = useCallback(() => {
    applyCaptionTextTransform((text) => {
      const trimmed = text.trimStart();
      if (!trimmed) return text;
      const lowered = trimmed.toLowerCase();
      const capped = lowered.replace(/^([a-z])/i, (m) => m.toUpperCase());
      const leadingSpaces = text.length - trimmed.length;
      return `${" ".repeat(leadingSpaces)}${capped}`;
    });
  }, [applyCaptionTextTransform]);

  // Regenerate waveform (re-analyze and save)
  const handleRegenerateWaveform = useCallback(async () => {
    if (!selectedSong) return;

    const confirmed = window.confirm(
      "This will re-analyze the audio and replace the current waveform visualization. Continue?"
    );
    if (!confirmed) return;

    setRegeneratingWaveform(true);
    setError(null);

    try {
      // Analyze fresh
      const res = await fetch("/api/format-builder-6/waveform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songPath: selectedSong.path,
          targetPoints: 600,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to analyze waveform");
      }

      const data = await res.json();

      // Save with current data as backup
      const saveRes = await fetch("/api/format-builder-6/waveform/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: selectedSong.slug,
          waveformData: data,
          previousWaveform: waveformData, // Current becomes backup
        }),
      });

      if (!saveRes.ok) {
        throw new Error("Failed to save waveform");
      }

      const saveData = await saveRes.json();
      setWaveformData(data);
      setWaveformSaved(true);
      setHasWaveformBackup(saveData.hasBackup);
      setSuccessMessage("Waveform regenerated and saved!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegeneratingWaveform(false);
    }
  }, [selectedSong, waveformData]);

  // Undo waveform (restore from backup)
  const handleUndoWaveform = useCallback(async () => {
    if (!selectedSong || !hasWaveformBackup) return;

    setWaveformLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/format-builder-6/waveform/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: selectedSong.slug,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to restore waveform");
      }

      const data = await res.json();
      setWaveformData(data.waveformData);
      setHasWaveformBackup(data.hasBackup);
      setSuccessMessage("Previous waveform restored!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setWaveformLoading(false);
    }
  }, [selectedSong, hasWaveformBackup]);

  // Handle song selection
  const handleSongSelect = (song) => {
    if (hasUnsavedChanges) {
      const confirm = window.confirm(
        "You have unsaved changes. Are you sure you want to switch songs?"
      );
      if (!confirm) return;
    }

    globalVolumesInitializedRef.current = false;
    setGlobalVolumes({
      clipVolume: DEFAULT_CLIP_VOLUME,
      musicVolume: DEFAULT_MUSIC_VOLUME,
    });

    setSelectedSong(song);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setWaveformData(null);
    setWaveformSaved(false);
    setHasWaveformBackup(false);
    setOverlayVisibility({
      marks: true,
      rapidRanges: true,
      lyrics: false,
      wordLyrics: false,
    });
    setCaptionTimeDrafts({});
    setCaptionsError(null);
    setEditModal(null);
    setActiveLayer("background");
    loadFormat(song);
    loadWaveform(song);
  };

  const handleToggleOverlay = useCallback((key) => {
    setOverlayVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // Update duration from audio metadata
  useEffect(() => {
    if (duration > 0 && format && format.meta.durationSeconds !== duration) {
      setFormat((prev) => ({
        ...prev,
        meta: {
          ...prev.meta,
          durationSeconds: duration,
        },
        mixSegments: normalizeMixSegments(prev.mixSegments || [], duration),
      }));
      setHasUnsavedChanges(true);
    }
  }, [duration, format]);

  useEffect(() => {
    if (!format) {
      globalVolumesInitializedRef.current = false;
      setGlobalVolumes({
        clipVolume: DEFAULT_CLIP_VOLUME,
        musicVolume: DEFAULT_MUSIC_VOLUME,
      });
      return;
    }
    if (globalVolumesInitializedRef.current) return;
    const normalizedMeta = normalizeBeatMetadata(
      format.beatGrid || [],
      format.beatMetadata || []
    );
    const referenceEntry =
      normalizedMeta[0] || normalizeIntroBeat(format.introBeat);
    setGlobalVolumes({
      clipVolume: clampVolume(
        referenceEntry?.clipSlot?.clipVolume,
        DEFAULT_CLIP_VOLUME
      ),
      musicVolume: clampVolume(
        referenceEntry?.clipSlot?.musicVolume,
        DEFAULT_MUSIC_VOLUME
      ),
    });
    globalVolumesInitializedRef.current = true;
  }, [format, format?.beatGrid, format?.beatMetadata, format?.introBeat]);

  // Add mark at current time (frame-snapped)
  const handleAddMark = useCallback(() => {
    if (!format) return;

    const time = audioRef.current?.currentTime || currentTime;
    const frame = secondsToFrame(time, fps);

    updateBeatGridFrames((prevFrames) => {
      if (prevFrames.some((f) => f === frame)) return prevFrames;
      return [...prevFrames, frame];
    });
  }, [format, currentTime, fps, updateBeatGridFrames]);

  // Move a mark (frame-snapped)
  const handleMarkMove = useCallback((markIndex, newTime) => {
    const frame = secondsToFrame(newTime, fps);
    updateBeatGridFrames((prevFrames) => {
      const next = [...prevFrames];
      next[markIndex] = frame;
      return next;
    });
  }, [fps, updateBeatGridFrames]);

  // Delete a mark
  const handleMarkDelete = useCallback((markIndex) => {
    updateBeatGridFrames((prevFrames) =>
      prevFrames.filter((_, i) => i !== markIndex)
    );
  }, [updateBeatGridFrames]);

  const handleSelectLayer = useCallback((layerId) => {
    setSelectedLayerId(layerId);
  }, []);

  const handleSelectSegment = useCallback((segment) => {
    setSelectedSegment(segment);
  }, []);

  const handleWaveformLayerToggle = useCallback((key) => {
    setWaveformActiveLayers((prev) => ({
      ...prev,
      [key]: !prev?.[key],
    }));
  }, []);

  const handleWaveformStrengthChange = useCallback((key, value) => {
    setWaveformLayerStrengths((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const handleSegmentResize = useCallback(
    (laneId, _segmentId, edge, newTimeSeconds, segmentIndex = null) => {
      const layer = laneId === "foreground" ? "foreground" : "background";
      const minGap = 1 / (fps || TARGET_FPS);
      const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

      updateBeatGridFrames((prevFrames) => {
        if (!Array.isArray(prevFrames) || prevFrames.length === 0) return prevFrames;
        if (segmentIndex === null || segmentIndex === undefined) return prevFrames;

        const times = prevFrames.map((f) => frameToSeconds(f, fps));
        const nextFrames = [...prevFrames];
        const durationSec = songDuration || 0;

        const getEnd = (idx) => (idx + 1 < times.length ? times[idx + 1] : durationSec);
        const startTime = times[segmentIndex];
        const endTime = getEnd(segmentIndex);
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return prevFrames;

        if (edge === "start") {
          if (segmentIndex === 0) return prevFrames;
          const min = times[segmentIndex - 1] + minGap;
          const max = endTime - minGap;
          const nextStart = clamp(newTimeSeconds, min, max);
          nextFrames[segmentIndex] = secondsToFrame(nextStart, fps);
          return nextFrames;
        }

        if (edge === "end") {
          if (segmentIndex >= times.length - 1) return prevFrames;
          const min = startTime + minGap;
          const max =
            segmentIndex + 2 < times.length ? times[segmentIndex + 2] - minGap : durationSec;
          const nextEnd = clamp(newTimeSeconds, min, max);
          nextFrames[segmentIndex + 1] = secondsToFrame(nextEnd, fps);
          return nextFrames;
        }

        if (edge === "move") {
          if (segmentIndex >= times.length) return prevFrames;
          const span = endTime - startTime;
          const prevStartNeighbor = segmentIndex === 0 ? 0 : times[segmentIndex - 1] + minGap;
          const nextNeighbor =
            segmentIndex + 1 < times.length
              ? times[segmentIndex + 1] - minGap
              : durationSec - minGap;
          let nextStart = clamp(newTimeSeconds, prevStartNeighbor, nextNeighbor - span);
          let nextEnd = nextStart + span;
          if (nextEnd > durationSec) {
            nextEnd = durationSec;
            nextStart = clamp(nextEnd - span, prevStartNeighbor, nextNeighbor);
          }
          nextFrames[segmentIndex] = secondsToFrame(nextStart, fps);
          if (segmentIndex + 1 < nextFrames.length) {
            nextFrames[segmentIndex + 1] = secondsToFrame(nextEnd, fps);
          }
          return nextFrames;
        }

        return prevFrames;
      }, layer);
    },
    [fps, songDuration, updateBeatGridFrames]
  );

  // Add rapid clip range
  const handleAddRapidRange = useCallback((range) => {
    setFormat((prev) => {
      if (!prev) return prev;
      if (activeLayer === "foreground") {
        const fg = prev.foreground || {};
        return {
          ...prev,
          cutoutEnabled: true,
          foreground: {
            ...fg,
            rapidClipRanges: [...(fg.rapidClipRanges || []), range],
          },
        };
      }
      return {
        ...prev,
        rapidClipRanges: [...(prev.rapidClipRanges || []), range],
      };
    });
    setHasUnsavedChanges(true);
  }, [activeLayer]);

  // Remove rapid clip range
  const handleRemoveRapidRange = useCallback((index) => {
    setFormat((prev) => {
      if (!prev) return prev;
      if (activeLayer === "foreground") {
        const fg = prev.foreground || {};
        return {
          ...prev,
          cutoutEnabled: true,
          foreground: {
            ...fg,
            rapidClipRanges: (fg.rapidClipRanges || []).filter((_, i) => i !== index),
          },
        };
      }
      return {
        ...prev,
        rapidClipRanges: prev.rapidClipRanges.filter((_, i) => i !== index),
      };
    });
    setHasUnsavedChanges(true);
  }, [activeLayer]);

  // Update rapid clip range
  const handleUpdateRapidRange = useCallback((index, updatedRange) => {
    setFormat((prev) => {
      if (!prev) return prev;
      if (activeLayer === "foreground") {
        const fg = prev.foreground || {};
        return {
          ...prev,
          cutoutEnabled: true,
          foreground: {
            ...fg,
            rapidClipRanges: (fg.rapidClipRanges || []).map((range, i) =>
              i === index ? updatedRange : range
            ),
          },
        };
      }
      return {
        ...prev,
        rapidClipRanges: prev.rapidClipRanges.map((range, i) =>
          i === index ? updatedRange : range
        ),
      };
    });
    setHasUnsavedChanges(true);
  }, [activeLayer]);

  const handleAddMixSegment = useCallback(() => {
    const fallbackDuration = songDuration || 10;
    const defaultLength = Math.min(6, Math.max(2, fallbackDuration * 0.1));
    const start = Math.max(0, Math.min(songDuration - defaultLength, currentTime));
    const end = Math.min(songDuration || start + defaultLength, start + defaultLength);
    updateMixSegments((prev) => [
      ...prev,
      {
        id: `mix-${Date.now()}`,
        label: `Segment ${prev.length + 1}`,
        start,
        end,
        musicVolume: 0.4,
        clipVolume: 1,
      },
    ]);
  }, [currentTime, songDuration, updateMixSegments]);

  const handleMixSegmentChange = useCallback(
    (index, patch) => {
      updateMixSegments((prev) =>
        prev.map((segment, idx) =>
          idx === index
            ? {
                ...segment,
                ...patch,
              }
            : segment
        )
      );
    },
    [updateMixSegments]
  );

  const handleRemoveMixSegment = useCallback(
    (index) => {
      updateMixSegments((prev) => prev.filter((_, idx) => idx !== index));
    },
    [updateMixSegments]
  );

  const handleApplyFullSongMix = useCallback(
    (musicVolume = 0.5, clipVolume = 1) => {
      const fullDuration = songDuration || 0;
      if (fullDuration <= 0) return;
      updateMixSegments(() => [
        {
          id: "mix-full-song",
          label: "Entire song",
          start: 0,
          end: fullDuration,
          musicVolume,
          clipVolume,
        },
      ]);
    },
    [songDuration, updateMixSegments]
  );

  const sortedBeatGrid = useMemo(() => {
    if (!Array.isArray(layerBeatGrid)) return [];
    return [...layerBeatGrid].sort((a, b) => a - b);
  }, [layerBeatGrid]);

  const markSelectionOptions = useMemo(() => {
    return sortedBeatGrid.map((time, idx) => ({
      value: idx,
      label: `Beat ${idx + 1} — ${formatSecondsLabel(time)}s`,
    }));
  }, [sortedBeatGrid]);

  const deleteRangeCount = useMemo(() => {
    if (rangeDeleteStart === null || rangeDeleteEnd === null) return 0;
    const start = Math.min(rangeDeleteStart, rangeDeleteEnd);
    const end = Math.max(rangeDeleteStart, rangeDeleteEnd);
    return end >= start ? end - start + 1 : 0;
  }, [rangeDeleteStart, rangeDeleteEnd]);

  const canDeleteMarkRange = useMemo(() => {
    return (
      sortedBeatGrid.length > 0 &&
      rangeDeleteStart !== null &&
      rangeDeleteEnd !== null
    );
  }, [rangeDeleteEnd, rangeDeleteStart, sortedBeatGrid.length]);

  useEffect(() => {
    if (rangeDeleteStart !== null && rangeDeleteStart >= sortedBeatGrid.length) {
      setRangeDeleteStart(null);
    }
    if (rangeDeleteEnd !== null && rangeDeleteEnd >= sortedBeatGrid.length) {
      setRangeDeleteEnd(null);
    }
  }, [rangeDeleteStart, rangeDeleteEnd, sortedBeatGrid.length]);

  const handleDeleteMarkRange = useCallback(() => {
    if (rangeDeleteStart === null || rangeDeleteEnd === null) return;
    if (!sortedBeatGrid.length) return;

    const startIdx = Math.min(rangeDeleteStart, rangeDeleteEnd);
    const endIdx = Math.max(rangeDeleteStart, rangeDeleteEnd);
    if (startIdx < 0 || endIdx >= sortedBeatGrid.length) return;

    const count = endIdx - startIdx + 1;
    const confirmed = window.confirm(
      `Delete ${count} mark${count !== 1 ? "s" : ""} from Beat ${
        startIdx + 1
      } to Beat ${endIdx + 1}?`
    );
    if (!confirmed) return;

    updateBeatGridFrames((prevFrames) => {
      const sortedFrames = [...prevFrames].sort((a, b) => a - b);
      return sortedFrames.filter((_, idx) => idx < startIdx || idx > endIdx);
    });

    setRangeDeleteStart(null);
    setRangeDeleteEnd(null);
  }, [
    rangeDeleteStart,
    rangeDeleteEnd,
    sortedBeatGrid.length,
    updateBeatGridFrames,
  ]);

  const beatEntries = useMemo(() => {
    if (!sortedBeatGrid.length) return [];
    const normalizedMeta = normalizeBeatMetadata(
      sortedBeatGrid,
      layerBeatMetadata || []
    );
    return sortedBeatGrid.map((time, idx) => {
      const next =
        idx < sortedBeatGrid.length - 1 ? sortedBeatGrid[idx + 1] : songDuration;
      return {
        index: idx,
        displayIndex: idx + 1,
        time,
        duration: Math.max(0, (next ?? songDuration) - time),
        metadata: normalizedMeta[idx],
        isIntro: false,
      };
    });
  }, [sortedBeatGrid, layerBeatMetadata, songDuration]);

  const buildSegmentsFromGrid = useCallback(
    (gridSeconds) => {
      const durationSec = songDuration || 0;
      if (!durationSec) return [];
      const sorted =
        Array.isArray(gridSeconds) && gridSeconds.length
          ? [...gridSeconds].filter(Number.isFinite).sort((a, b) => a - b)
          : [];
      if (!sorted.length) {
        return [
          {
            id: "seg-0",
            index: 0,
            start: 0,
            end: durationSec,
          },
        ];
      }
      return sorted
        .map((start, idx) => {
          const end = idx + 1 < sorted.length ? sorted[idx + 1] : durationSec;
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            return null;
          }
          return {
            id: `seg-${idx}`,
            index: idx,
            start,
            end,
          };
        })
        .filter(Boolean);
    },
    [songDuration]
  );

  const backgroundSegments = useMemo(
    () => buildSegmentsFromGrid(format?.beatGrid || []),
    [buildSegmentsFromGrid, format?.beatGrid]
  );

  const foregroundSegments = useMemo(
    () => (cutoutEnabled ? buildSegmentsFromGrid(foregroundLayer.beatGrid || []) : []),
    [buildSegmentsFromGrid, cutoutEnabled, foregroundLayer.beatGrid]
  );

  const timelineLanes = useMemo(() => {
    const lanes = [];
    lanes.push({
      id: "background",
      type: "base",
      label: "Base",
      colorKey: "bg",
      segments: overlayVisibility.marks ? backgroundSegments : [],
    });
    if (cutoutEnabled) {
      lanes.push({
        id: "foreground",
        type: "cutout",
        label: "Cutout",
        colorKey: "fg",
        segments: overlayVisibility.marks ? foregroundSegments : [],
      });
    }
    return lanes;
  }, [backgroundSegments, cutoutEnabled, foregroundSegments, overlayVisibility.marks]);

  const introBeatEntry = useMemo(() => {
    if (!format) return null;
    const introBeat = normalizeIntroBeat(format.introBeat);
    const firstBeatTime = sortedBeatGrid[0];
    const safeEnd =
      typeof firstBeatTime === "number"
        ? firstBeatTime
        : typeof songDuration === "number"
        ? songDuration
        : 0;
    return {
      index: -1,
      displayIndex: 0,
      time: 0,
      duration: Math.max(0, safeEnd),
      metadata: introBeat,
      isIntro: true,
    };
  }, [format, sortedBeatGrid, songDuration]);

  const guidelineEntries = useMemo(() => {
    if (!format) return [];
    const entries = [...beatEntries];
    if (introBeatEntry) {
      return [introBeatEntry, ...entries];
    }
    return entries;
  }, [beatEntries, introBeatEntry, format]);

  const beatLabelMap = useMemo(() => {
    return beatEntries.reduce((acc, entry) => {
      acc[entry.index] = `Beat ${entry.displayIndex}`;
      return acc;
    }, {});
  }, [beatEntries]);

  const captionStyle = useMemo(
    () => ensureCaptionStyle(format?.captions?.style),
    [format?.captions?.style]
  );

  const captionDisplayRanges = useMemo(() => {
    return Array.isArray(format?.captions?.displayRanges) ? format.captions.displayRanges : [];
  }, [format?.captions?.displayRanges]);

  const captionLines = useMemo(() => {
    if (!format?.captions?.lines) return [];
    return format.captions.lines.map((line, idx) => ({
      ...line,
      index: idx,
      startSeconds: (Number(line.startMs) || 0) / 1000,
      endSeconds: (Number(line.endMs) || 0) / 1000,
    }));
  }, [format?.captions?.lines]);

  const captionWords = useMemo(() => {
    if (!format?.captions?.words) return [];
    return format.captions.words.map((word, idx) => ({
      ...word,
      index: idx,
      startSeconds: (Number(word.startMs) || 0) / 1000,
      endSeconds: (Number(word.endMs) || 0) / 1000,
    }));
  }, [format?.captions?.words]);

  const combinedCaptionEntries = useMemo(() => {
    const entries = [
      ...captionLines.map((line) => ({ type: "line", data: line })),
      ...captionWords.map((word) => ({ type: "word", data: word })),
    ];
    return entries.sort((a, b) => {
      const aStart = a.data.startMs ?? 0;
      const bStart = b.data.startMs ?? 0;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = a.data.endMs ?? aStart;
      const bEnd = b.data.endMs ?? bStart;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return a.type === "line" ? -1 : 1;
    });
  }, [captionLines, captionWords]);

  const combinedEntryIndexMap = useMemo(() => {
    return new Map(
      combinedCaptionEntries.map((entry, idx) => [
        `${entry.type}-${entry.data.index}`,
        idx,
      ])
    );
  }, [combinedCaptionEntries]);

  const bulkEditTargetKeys = useMemo(() => {
    if (bulkEditModal?.targetKeys?.length) {
      return bulkEditModal.targetKeys;
    }
    return selectedCaptionKeys;
  }, [bulkEditModal, selectedCaptionKeys]);

  const captionSections = useMemo(() => {
    if (!combinedCaptionEntries.length) return [];
    const toKey = (style) =>
      `${style.mode}|${style.color}|${style.fontFamily}|${style.fontWeight}|${style.fontSizeRatio}|${style.letterSpacing}|${style.animation}|${style.uppercase}`;
    const effectiveStyle = (entry) =>
      entry.data.useGlobalStyle === false && entry.data.style
        ? ensureCaptionStyle(entry.data.style)
        : captionStyle;
    const sections = [];
    let currentStart = 0;
    let currentKey = toKey(effectiveStyle(combinedCaptionEntries[0]));
    for (let i = 1; i < combinedCaptionEntries.length; i += 1) {
      const nextKey = toKey(effectiveStyle(combinedCaptionEntries[i]));
      if (nextKey !== currentKey) {
        const slice = combinedCaptionEntries.slice(currentStart, i);
        const startMs = slice[0].data.startMs ?? 0;
        const last = slice[slice.length - 1];
        const endMs = last.data.endMs ?? last.data.startMs ?? 0;
        sections.push({
          id: `section-${sections.length}`,
          entries: slice,
          keys: slice.map((entry) => `${entry.type}-${entry.data.index}`),
          startMs,
          endMs,
        });
        currentStart = i;
        currentKey = nextKey;
      }
    }
    const finalSlice = combinedCaptionEntries.slice(currentStart);
    if (finalSlice.length) {
      const startMs = finalSlice[0].data.startMs ?? 0;
      const last = finalSlice[finalSlice.length - 1];
      const endMs = last.data.endMs ?? last.data.startMs ?? 0;
      sections.push({
        id: `section-${sections.length}`,
        entries: finalSlice,
        keys: finalSlice.map((entry) => `${entry.type}-${entry.data.index}`),
        startMs,
        endMs,
      });
    }
    return sections;
  }, [combinedCaptionEntries, captionStyle]);

  const hasCaptionOverrides = useMemo(
    () => captionSections.length > 1,
    [captionSections.length]
  );

  const activeCaptionLine = useMemo(() => {
    if (!captionLines.length) return null;
    const currentMs = currentTime * 1000;
    return (
      captionLines.find(
        (line) =>
          currentMs >= (line.startMs ?? 0) && currentMs <= (line.endMs ?? line.startMs ?? 0)
      ) || null
    );
  }, [captionLines, currentTime]);

  // Compute filtered lines/words based on display ranges (word vs line)
  const { filteredLines, filteredWords } = useMemo(() => {
    if (!captionDisplayRanges.length) {
      return { filteredLines: captionLines, filteredWords: captionWords };
    }
    const wordRanges = captionDisplayRanges.filter((r) => r.mode === "word");
    const lineRanges = captionDisplayRanges.filter((r) => r.mode !== "word");

    const isWithin = (startMs, endMs, range) =>
      startMs < (range.endMs ?? range.startMs ?? 0) &&
      endMs > (range.startMs ?? 0);

    const selectedWords = captionWords.filter((w) =>
      wordRanges.some((r) => isWithin(w.startMs ?? 0, w.endMs ?? w.startMs ?? 0, r))
    );
    const selectedLines = captionLines.filter((l) =>
      (lineRanges.length
        ? lineRanges.some((r) => isWithin(l.startMs ?? 0, l.endMs ?? l.startMs ?? 0, r))
        : true) && !wordRanges.some((r) => isWithin(l.startMs ?? 0, l.endMs ?? l.startMs ?? 0, r))
    );

    // If no lines selected but lineRanges exist, lines default to empty
    const resolvedLines = lineRanges.length ? selectedLines : captionLines;
    const resolvedWords = wordRanges.length ? selectedWords : captionWords;
    return {
      filteredLines: resolvedLines.map((l) => ({ ...l, index: l.index })),
      filteredWords: resolvedWords.map((w) => ({ ...w, index: w.index })),
    };
  }, [captionDisplayRanges, captionLines, captionWords]);

  const activeCaptionWord = useMemo(() => {
    if (!filteredWords.length) return null;
    const currentMs = currentTime * 1000;
    return (
      filteredWords.find(
        (w) => currentMs >= (w.startMs ?? 0) && currentMs <= (w.endMs ?? w.startMs ?? 0)
      ) || null
    );
  }, [filteredWords, currentTime]);

  const activePreviewText = useMemo(() => {
    if (selectedCaptionLine !== null && filteredLines[selectedCaptionLine]) {
      const line = filteredLines[selectedCaptionLine];
      const style =
        line.useGlobalStyle === false && line.style ? ensureCaptionStyle(line.style) : captionStyle;
      return { text: line.text, style };
    }
    if (selectedCaptionWord !== null && filteredWords[selectedCaptionWord]) {
      const word = filteredWords[selectedCaptionWord];
      const style =
        word.useGlobalStyle === false && word.style ? ensureCaptionStyle(word.style) : captionStyle;
      return { text: word.text, style };
    }
    if (activeCaptionWord) {
      const style =
        activeCaptionWord.useGlobalStyle === false && activeCaptionWord.style
          ? ensureCaptionStyle(activeCaptionWord.style)
          : captionStyle;
      return { text: activeCaptionWord.text, style };
    }
    if (activeCaptionLine) {
      return { text: activeCaptionLine.text, style: captionStyle };
    }
    return { text: "Play audio to preview timed captions", style: captionStyle };
  }, [
    selectedCaptionLine,
    filteredLines,
    selectedCaptionWord,
    filteredWords,
    activeCaptionLine,
    activeCaptionWord,
    captionStyle,
  ]);

  const captionInputClass =
    "w-full rounded-md bg-white text-slate-900 border border-slate-300 px-2 py-1.5 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400";
  const captionSelectClass =
    "w-full rounded-md bg-white text-slate-900 border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400";

  useEffect(() => {
    if (hasCaptionOverrides && captionEditScope !== "sections") {
      setCaptionEditScope("sections");
    }
  }, [hasCaptionOverrides, captionEditScope]);

  const getEffectiveCaptionStyle = useCallback(
    (entry) =>
      entry.data.useGlobalStyle === false && entry.data.style
        ? ensureCaptionStyle(entry.data.style)
        : captionStyle,
    [captionStyle]
  );

  const captionStyleKey = useCallback(
    (style) =>
      `${style.mode}|${style.color}|${style.fontFamily}|${style.fontWeight}|${style.fontSizeRatio}|${style.letterSpacing}|${style.animation}|${style.uppercase}`,
    []
  );

  const getSectionStyleSummary = useCallback(
    (section) => {
      if (!section.entries.length) return "No entries";
      const styles = section.entries.map(getEffectiveCaptionStyle);
      const firstKey = captionStyleKey(styles[0]);
      const isUniform = styles.every((style) => captionStyleKey(style) === firstKey);
      if (!isUniform) return "Mixed styles";
      const style = styles[0];
      return `${style.mode} · ${style.fontFamily} ${style.fontWeight} · ${style.fontSizeRatio} · ${style.letterSpacing}px · ${
        style.animation === "word" ? "word" : "line"
      } · ${style.uppercase ? "ALL CAPS" : "Sentence case"}`;
    },
    [captionStyleKey, getEffectiveCaptionStyle]
  );

  const selectedCaptionKeySet = useMemo(
    () => new Set(selectedCaptionKeys),
    [selectedCaptionKeys]
  );

  const handleCaptionSelection = useCallback(
    (entry, orderIdx, event) => {
      const key = `${entry.type}-${entry.data.index}`;
      if (event?.shiftKey && lastCaptionSelectionIndex !== null) {
        const start = Math.min(lastCaptionSelectionIndex, orderIdx);
        const end = Math.max(lastCaptionSelectionIndex, orderIdx);
        const rangeKeys = combinedCaptionEntries
          .slice(start, end + 1)
          .map((item) => `${item.type}-${item.data.index}`);
        setSelectedCaptionKeys(rangeKeys);
      } else {
        setSelectedCaptionKeys([key]);
      }
      setLastCaptionSelectionIndex(orderIdx);
      if (entry.type === "line") {
        setSelectedCaptionLine(entry.data.index);
        setSelectedCaptionWord(null);
      } else {
        setSelectedCaptionWord(entry.data.index);
        setSelectedCaptionLine(null);
      }
    },
    [combinedCaptionEntries, lastCaptionSelectionIndex]
  );

  const findCaptionOrderIndex = useCallback(
    (type, index) =>
      combinedCaptionEntries.findIndex(
        (entry) => entry.type === type && entry.data.index === index
      ),
    [combinedCaptionEntries]
  );

  const openBulkEditForKeys = useCallback(
    (keys, seedStyle = captionStyle) => {
      setSelectedCaptionKeys(keys);
      setBulkEditModal({
        draft: ensureCaptionStyle(seedStyle),
        useGlobalStyle: false,
        targetKeys: keys,
      });
    },
    [captionStyle]
  );

  const applySelectedCaptionTextTransform = useCallback(
    (transformFn, targetKeys = selectedCaptionKeys) => {
      if (!targetKeys.length) return;
      const lineIndexes = new Set(
        targetKeys
          .filter((key) => key.startsWith("line-"))
          .map((key) => Number(key.split("-")[1]))
      );
      const wordIndexes = new Set(
        targetKeys
          .filter((key) => key.startsWith("word-"))
          .map((key) => Number(key.split("-")[1]))
      );
      updateCaptions((current) => {
        const nextLines = (current.lines || []).map((line, idx) =>
          lineIndexes.has(idx)
            ? { ...line, text: transformFn(line.text || "") }
            : line
        );
        const nextWords = (current.words || []).map((word, idx) =>
          wordIndexes.has(idx)
            ? { ...word, text: transformFn(word.text || "") }
            : word
        );
        return {
          ...current,
          lines: nextLines,
          words: nextWords,
          updatedAt: new Date().toISOString(),
        };
      });
      setHasUnsavedChanges(true);
    },
    [selectedCaptionKeys, updateCaptions]
  );

  const applyBulkCaptionStyle = useCallback(
    (draft, useGlobalStyle, targetKeys = selectedCaptionKeys) => {
      if (!targetKeys.length) return;
      const lineIndexes = new Set(
        targetKeys
          .filter((key) => key.startsWith("line-"))
          .map((key) => Number(key.split("-")[1]))
      );
      const wordIndexes = new Set(
        targetKeys
          .filter((key) => key.startsWith("word-"))
          .map((key) => Number(key.split("-")[1]))
      );
      updateCaptions((current) => {
        const nextLines = (current.lines || []).map((line, idx) =>
          lineIndexes.has(idx)
            ? {
                ...line,
                useGlobalStyle,
                style: useGlobalStyle ? null : ensureCaptionStyle(draft),
              }
            : line
        );
        const nextWords = (current.words || []).map((word, idx) =>
          wordIndexes.has(idx)
            ? {
                ...word,
                useGlobalStyle,
                style: useGlobalStyle ? null : ensureCaptionStyle(draft),
              }
            : word
        );
        return {
          ...current,
          lines: nextLines,
          words: nextWords,
          updatedAt: new Date().toISOString(),
        };
      });
      setHasUnsavedChanges(true);
    },
    [selectedCaptionKeys, updateCaptions]
  );

  const openEditModal = useCallback(
    (type, index) => {
      if (type === "line" && captionLines[index]) {
        const line = captionLines[index];
        const startMs = line.startMs ?? line.startSeconds * 1000 ?? 0;
        const endMs = line.endMs ?? line.endSeconds * 1000 ?? 0;
        setEditModal({
          type: "line",
          index,
          draft: {
            text: line.text,
            startMs,
            endMs,
            startSecondsText: formatSecondsInput(startMs),
            endSecondsText: formatSecondsInput(endMs),
            useGlobalStyle: line.useGlobalStyle !== false,
            style: ensureCaptionStyle(line.style || format?.captions?.style || DEFAULT_CAPTION_STYLE),
          },
        });
      }
      if (type === "word" && captionWords[index]) {
        const word = captionWords[index];
        const startMs = word.startMs ?? word.startSeconds * 1000 ?? 0;
        const endMs = word.endMs ?? word.endSeconds * 1000 ?? 0;
        setEditModal({
          type: "word",
          index,
          draft: {
            text: word.text,
            startMs,
            endMs,
            startSecondsText: formatSecondsInput(startMs),
            endSecondsText: formatSecondsInput(endMs),
            useGlobalStyle: word.useGlobalStyle !== false,
            style: ensureCaptionStyle(word.style || format?.captions?.style || DEFAULT_CAPTION_STYLE),
          },
        });
      }
    },
    [captionLines, captionWords, format?.captions?.style]
  );

  // Play/pause toggle
  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // Seek to time
  const handleSeek = useCallback((time) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  // Save format
  const handleSave = async () => {
    if (!selectedSong || !format) return;

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const validation = validateCaptionTimeDrafts();
      if (!validation.ok) {
        setError(validation.message);
        return;
      }
      const res = await fetch("/api/format-builder-6/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: selectedSong.slug,
          format: {
            ...format,
            captions: format.captions
              ? {
                  ...format.captions,
                  enabled: captionsEnabled,
                }
              : format.captions,
            captionPlacements,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const data = await res.json();
      const incomingPlacements = data.format?.captionPlacements || captionPlacements;
      setCaptionPlacements({
        lyrics: incomingPlacements.lyrics || "top",
        clip: incomingPlacements.clip || "layered",
      });
      setFormat(data.format);
      setFormatExists(true);
      setHasUnsavedChanges(false);
      setSuccessMessage("Format saved successfully!");
      setTimeout(() => setSuccessMessage(null), 3000);
      setCaptionTimeDrafts({});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Clear all marks
  const handleClearMarks = () => {
    if (!window.confirm("Clear all marks? This cannot be undone.")) return;
    updateBeatGridFrames(() => []);
  };

  // Auto analyze song
  const handleAutoAnalyze = async () => {
    if (!selectedSong || !format) return;

    // Confirm if marks already exist
    if (layerBeatGrid.length > 0) {
      const confirmed = window.confirm(
        `This will replace the existing ${layerBeatGrid.length} marks with auto-detected beats for the ${isForegroundLayer ? "foreground" : "background"} layer. Continue?`
      );
      if (!confirmed) return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const res = await fetch("/api/format-builder-6/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songPath: selectedSong.path,
          minSpacing: 0.3,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Analysis failed");
      }

      const data = await res.json();

      setFormat((prev) => {
        if (!prev) return prev;
        if (isForegroundLayer) {
          const fg = prev.foreground || {};
          return {
            ...prev,
            cutoutEnabled: true,
            foreground: {
              ...fg,
              beatGrid: data.beatGrid,
            },
            meta: {
              ...prev.meta,
              bpm: data.meta.bpm,
              bpmConfidence: data.meta.bpmConfidence,
            },
          };
        }
        return {
          ...prev,
          beatGrid: data.beatGrid,
          meta: {
            ...prev.meta,
            bpm: data.meta.bpm,
            bpmConfidence: data.meta.bpmConfidence,
          },
        };
      });
      setHasUnsavedChanges(true);
      setSuccessMessage(
        `Auto-detected ${data.beatGrid.length} marks` +
          (data.meta.bpm ? ` at ${data.meta.bpm} BPM` : "")
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
                  Format Builder 6
                </h1>
                <p className="text-sm text-slate-400">
                  Create beat maps and clip change timings for songs
                </p>
              </div>
            </div>

            {/* Save button */}
            {selectedSong && format && (
              <div className="flex items-center gap-3">
                {hasUnsavedChanges && (
                  <span className="text-amber-400 text-sm">Unsaved changes</span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-semibold rounded-lg transition-colors"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Save Format
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Messages */}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="p-4 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-200">
            {successMessage}
          </div>
        )}

        {/* Song selector */}
        <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
          <SongSelector
            selectedSong={selectedSong}
            onSelect={handleSongSelect}
            disabled={loading}
          />
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-slate-400">
              <div className="w-6 h-6 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
              Loading format...
            </div>
          </div>
        )}

        {/* Main editor */}
        {selectedSong && format && !loading && (
          <>
            {/* Tab navigation */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("editor")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === "editor"
                    ? "bg-amber-600 text-white"
                    : "bg-gray-800 text-slate-300 hover:bg-gray-700"
                }`}
              >
                Editor
              </button>
              <button
                onClick={() => setActiveTab("tester")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === "tester"
                    ? "bg-amber-600 text-white"
                    : "bg-gray-800 text-slate-300 hover:bg-gray-700"
                }`}
              >
                Test Edit
              </button>
              
              <div className="flex-1" />
              
              {/* Stats with frame info */}
              <div className="text-sm text-slate-400 flex items-center gap-3">
                <span>
                  <span className="text-amber-400 font-semibold">{layerBeatGrid.length}</span> {isForegroundLayer ? "foreground" : "background"} marks
                </span>
                {layerRapidClipRanges?.length > 0 && (
                  <span>
                    <span className="text-purple-400 font-semibold">{layerRapidClipRanges.length}</span> rapid ranges
                  </span>
                )}
                {format.meta?.totalClips && (
                  <span className="border-l border-slate-600 pl-3">
                    <span className="text-emerald-400 font-semibold">{format.meta.totalClips}</span> clips
                  </span>
                )}
                {format.meta?.totalFrames && (
                  <span>
                    <span className="text-cyan-400 font-semibold">{format.meta.totalFrames}</span>f
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  @{format.meta?.targetFps || 30}fps
                </span>
              </div>

              <div className="flex items-center gap-2 bg-gray-900/60 border border-gray-800 px-3 py-2 rounded-lg">
                <div className="text-xs text-slate-400 font-semibold">
                  Delete range
                  {deleteRangeCount > 0 && (
                    <span className="text-slate-500 font-normal ml-1">
                      ({deleteRangeCount})
                    </span>
                  )}
                </div>
                <select
                  value={rangeDeleteStart ?? ""}
                  onChange={(e) =>
                    setRangeDeleteStart(
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  disabled={!markSelectionOptions.length}
                  className="bg-gray-800 text-slate-200 text-xs rounded-md border border-gray-700 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Start mark</option>
                  {markSelectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="text-slate-600 text-xs">to</span>
                <select
                  value={rangeDeleteEnd ?? ""}
                  onChange={(e) =>
                    setRangeDeleteEnd(
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  disabled={!markSelectionOptions.length}
                  className="bg-gray-800 text-slate-200 text-xs rounded-md border border-gray-700 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">End mark</option>
                  {markSelectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleDeleteMarkRange}
                  disabled={!canDeleteMarkRange}
                  className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800/70 disabled:opacity-50 text-red-200 text-xs font-semibold rounded-md transition-colors"
                >
                  Delete selected
                </button>
              </div>

              <div className="flex flex-wrap gap-3 items-center">
                {/* Auto Analyze button */}
                <button
                  onClick={handleAutoAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:text-indigo-300 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {analyzing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Auto Analyze
                    </>
                  )}
                </button>
                <label className="inline-flex items-center gap-2 text-xs text-white/80 bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-lg">
                  <input
                    type="checkbox"
                    className="rounded border-gray-500 bg-black"
                    checked={captionsEnabled}
                    onChange={(e) => {
                      setCaptionsEnabled(e.target.checked);
                      setOverlayVisibility((prev) => ({
                        ...prev,
                        lyrics: e.target.checked && Boolean(format?.captions),
                        wordLyrics: e.target.checked && Boolean(format?.captions),
                      }));
                      setHasUnsavedChanges(true);
                    }}
                  />
                  <span className="font-semibold">Captions enabled</span>
                </label>
              </div>

              <button
                onClick={handleClearMarks}
                disabled={layerBeatGrid.length === 0}
                className="px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 disabled:opacity-50 text-red-300 text-sm rounded-lg transition-colors"
              >
                Clear All Marks
              </button>
            </div>

            {/* Cutout layer controls */}
            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <button
                onClick={handleToggleCutoutLayer}
                className={`px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                  cutoutEnabled
                    ? "bg-emerald-900/40 border-emerald-600 text-emerald-200 hover:bg-emerald-800/60"
                    : "bg-gray-800 border-gray-700 text-slate-300 hover:bg-gray-700"
                }`}
              >
                {cutoutEnabled ? "Cutout layer enabled" : "Enable cutout layer"}
              </button>

              {cutoutEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Editing layer:</span>
                  <div className="inline-flex rounded-md border border-gray-800 overflow-hidden">
                    <button
                      onClick={() => handleLayerSwitch("background")}
                      className={`px-3 py-1 text-xs font-semibold ${
                        activeLayer === "background"
                          ? "bg-amber-700 text-white"
                          : "bg-gray-900 text-slate-400 hover:text-white"
                      }`}
                    >
                      Background
                    </button>
                    <button
                      onClick={() => handleLayerSwitch("foreground")}
                      className={`px-3 py-1 text-xs font-semibold ${
                        activeLayer === "foreground"
                          ? "bg-emerald-800 text-white"
                          : "bg-gray-900 text-slate-400 hover:text-white"
                      }`}
                    >
                      Foreground (cutout)
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="px-2 py-1 rounded bg-gray-900 border border-gray-800">
                  BG: {format?.beatGrid?.length || 0} marks · {format?.rapidClipRanges?.length || 0} ranges
                </span>
                {cutoutEnabled && (
                  <span className="px-2 py-1 rounded bg-gray-900 border border-gray-800">
                    FG: {foregroundLayer.beatGrid?.length || 0} marks · {foregroundLayer.rapidClipRanges?.length || 0} ranges
                  </span>
                )}
              </div>
            </div>

            {activeTab === "editor" ? (
              <div className="space-y-6">
                {/* Audio player with live minimal preview */}
                <AudioPlayerWithMarks
                  songPath={selectedSong.path}
                  currentTime={currentTime}
                  duration={duration}
                  isPlaying={isPlaying}
                  onTimeUpdate={setCurrentTime}
                  onDurationChange={setDuration}
                  onPlayPause={handlePlayPause}
                  onSeek={handleSeek}
                  onAddMark={handleAddMark}
                  audioRef={audioRef}
                  previewSlot={
                    <LivePreview
                      currentTime={currentTime}
                      segments={backgroundSegments}
                      rapidRanges={[
                        ...(format.rapidClipRanges || []),
                        ...(foregroundLayer.rapidClipRanges || []),
                      ]}
                      duration={songDuration}
                      fps={format.meta?.targetFps || TARGET_FPS}
                    />
                  }
                />

                {/* Stacked timeline (placed above audio player) */}
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  {/* Waveform status bar */}
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-800">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      {waveformLoading ? (
                        <>
                          <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
                          {regeneratingWaveform ? "Regenerating waveform..." : "Loading waveform visualization..."}
                        </>
                      ) : waveformData ? (
                        <>
                          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-slate-400">
                            Waveform {waveformSaved ? "loaded from cache" : "analyzed"}
                            {waveformData.savedAt && (
                              <span className="text-slate-600 ml-1">
                                • Saved {new Date(waveformData.savedAt).toLocaleDateString()}
                              </span>
                            )}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-600">No waveform data</span>
                      )}
                    </div>
                    
                    {/* Waveform controls */}
                    <div className="flex items-center gap-2">
                      {hasWaveformBackup && (
                        <button
                          onClick={handleUndoWaveform}
                          disabled={waveformLoading}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-slate-400 hover:text-white rounded transition-colors"
                          title="Restore previous waveform"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          Undo
                        </button>
                      )}
                      <button
                        onClick={handleRegenerateWaveform}
                        disabled={waveformLoading || regeneratingWaveform}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-indigo-900/50 hover:bg-indigo-800 disabled:opacity-50 text-indigo-300 hover:text-white rounded transition-colors"
                        title="Re-analyze audio and regenerate waveform"
                      >
                        {regeneratingWaveform ? (
                          <>
                            <div className="w-3 h-3 border border-indigo-300 border-t-transparent rounded-full animate-spin" />
                            Regenerating...
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Regenerate
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  
                  {/* Overlay toggles */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide mr-2">
                      Timeline overlays:
                    </span>
                    {[
                      { key: "marks", label: "Beat marks" },
                      { key: "rapidRanges", label: "Rapid ranges" },
                      { key: "lyrics", label: "Lyric lines" },
                      { key: "wordLyrics", label: "Lyric words" },
                    ].map((opt) => {
                      const active = overlayVisibility[opt.key];
                      return (
                        <button
                          key={opt.key}
                          onClick={() => handleToggleOverlay(opt.key)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                            active
                              ? "bg-emerald-700/40 border-emerald-500 text-emerald-100"
                              : "bg-gray-800 border-gray-700 text-slate-400 hover:bg-gray-700"
                          }`}
                        >
                          {active ? "Hide" : "Show"} {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <StackedTimeline
                    duration={duration}
                    currentTime={currentTime}
                    marks={sortedBeatGrid}
                    markLabels={beatLabelMap}
                    onMarkMove={handleMarkMove}
                    onMarkDelete={handleMarkDelete}
                    onSeek={handleSeek}
                    rapidClipRanges={layerRapidClipRanges || []}
                    waveformData={waveformData}
                    lyrics={filteredLines}
                    wordLyrics={filteredWords}
                    showMarks={overlayVisibility.marks}
                    showRapidRanges={overlayVisibility.rapidRanges}
                    showLyrics={overlayVisibility.lyrics}
                    showWordLyrics={overlayVisibility.wordLyrics}
                    onLyricSelect={(idx) => {
                      setSelectedCaptionLine(idx);
                      setSelectedCaptionWord(null);
                    setSelectedCaptionKeys([`line-${idx}`]);
                    const nextIndex = findCaptionOrderIndex("line", idx);
                    setLastCaptionSelectionIndex(nextIndex >= 0 ? nextIndex : null);
                    }}
                    onWordSelect={(idx) => {
                      setSelectedCaptionWord(idx);
                      setSelectedCaptionLine(null);
                      setSelectedCaptionKeys([`word-${idx}`]);
                      const nextIndex = findCaptionOrderIndex("word", idx);
                      setLastCaptionSelectionIndex(nextIndex >= 0 ? nextIndex : null);
                    }}
                    selectedLyricIndex={selectedCaptionLine}
                    selectedWordIndex={selectedCaptionWord}
                  />
                </div>

                {/* Layered timeline (v3-style view) */}
                <div className="w-full border border-black/60 rounded-md bg-[#0c0c0c] p-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-slate-400">Segments & rapid ranges (layered view)</div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        <span>Zoom</span>
                        <input
                          type="range"
                          min="0.25"
                          max="4"
                          step="0.25"
                          value={timelineZoom}
                          onChange={(e) => setTimelineZoom(parseFloat(e.target.value) || 1)}
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          className="rounded border-gray-600 bg-gray-800"
                          checked={waveformEnabled}
                          onChange={(e) => setWaveformEnabled(e.target.checked)}
                        />
                        <span>Waveform</span>
                      </label>
                    </div>
                  </div>
                  <UnifiedTimeline
                    duration={duration}
                    zoom={timelineZoom}
                    onZoomChange={setTimelineZoom}
                    onSelectSegment={handleSelectSegment}
                    selectedSegment={selectedSegment}
                    currentTime={currentTime}
                    onSeek={handleSeek}
                    waveformData={waveformData}
                    waveformEnabled={waveformEnabled}
                    onWaveformEnabledChange={setWaveformEnabled}
                    waveformActiveLayers={waveformActiveLayers}
                    waveformLayerStrengths={waveformLayerStrengths}
                    onWaveformLayerToggle={handleWaveformLayerToggle}
                    onWaveformStrengthChange={handleWaveformStrengthChange}
                    lanes={timelineLanes}
                    onLaneReorder={() => {}}
                    onSegmentResize={handleSegmentResize}
                    onSelectLayer={handleSelectLayer}
                    selectedLayerId={selectedLayerId}
                    rapidRangesByLane={{
                      background:
                        overlayVisibility.rapidRanges && Array.isArray(format?.rapidClipRanges)
                          ? format.rapidClipRanges
                          : [],
                      foreground:
                        overlayVisibility.rapidRanges &&
                        cutoutEnabled &&
                        Array.isArray(foregroundLayer?.rapidClipRanges)
                          ? foregroundLayer.rapidClipRanges
                          : [],
                    }}
                  />
                </div>

                {/* Lyrics / captions (placed below timeline, above rapid ranges) */}
                {captionsEnabled && (
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-white">Lyrics & Captions</h3>
                        <p className="text-xs text-slate-500">
                          Generate millisecond-aligned lyrics per song (AssemblyAI) and style them.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-400">
                          <div className="inline-flex rounded-md border border-gray-800 bg-gray-900 p-0.5">
                            {[
                              { key: "lyrics", label: "Lyrics captions" },
                              { key: "clip", label: "Clip captions" },
                            ].map((opt) => {
                              const active = activeCaptionVariant === opt.key;
                              return (
                                <button
                                  key={opt.key}
                                  onClick={() => handleActiveCaptionVariantChange(opt.key)}
                                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                    active
                                      ? "bg-emerald-700 text-white"
                                      : "text-slate-300 hover:text-white hover:bg-gray-800"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                          <label className="flex items-center gap-2 text-xs text-slate-400">
                            <span>Layer placement</span>
                            <select
                              className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white"
                              value={
                                captionPlacements[activeCaptionVariant] || (layeredCaptions ? "layered" : "top")
                              }
                              onChange={(e) => handleCaptionPlacementChange(e.target.value)}
                            >
                              <option value="top">Top (above cutout)</option>
                              <option value="layered">Layered (under cutout)</option>
                            </select>
                          </label>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-400">
                          <span>
                            Status:{" "}
                            {format?.captions
                              ? format.captions.status || "ready"
                              : "not generated"}
                          </span>
                          {format?.captions?.updatedAt && (
                            <span className="text-slate-500">
                              • Updated {new Date(format.captions.updatedAt).toLocaleString()}
                            </span>
                          )}
                          {format?.captions?.words && (
                            <span className="text-slate-500">
                              • {format.captions.words.length} words
                            </span>
                          )}
                          {format?.captions?.lines && (
                            <span className="text-slate-500">
                              • {format.captions.lines.length} lines
                            </span>
                          )}
                        </div>
                        {captionsError && (
                          <div className="text-xs text-red-300 mt-1">{captionsError}</div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handleGenerateCaptions}
                          disabled={captionsLoading}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-500 disabled:opacity-60"
                        >
                          {captionsLoading ? (
                            <>
                              <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Generate lyrics
                            </>
                          )}
                        </button>
                        <button
                          onClick={handleSaveCaptionsOnly}
                          disabled={!format?.captions || captionsSaving}
                          className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
                        >
                          {captionsSaving ? "Saving..." : "Save captions"}
                        </button>
                        <button
                          onClick={handleRenderCaptions}
                          disabled={renderLoading}
                          className="px-3 py-1.5 rounded-md bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50"
                        >
                          {renderLoading ? "Rendering..." : "Render captions"}
                        </button>
                        <button
                          onClick={() => setCaptionPreviewOpen((v) => !v)}
                          className="px-3 py-1.5 rounded-md bg-gray-800 text-slate-200 text-sm font-semibold hover:bg-gray-700"
                        >
                          {captionPreviewOpen ? "Hide preview" : "Show preview"}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleSetAllCaps}
                        disabled={!format?.captions}
                        className="px-3 py-1.5 rounded-md bg-gray-800 text-slate-200 text-sm font-semibold border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
                      >
                        Apply ALL CAPS
                      </button>
                      <button
                        onClick={handleSetSentenceCase}
                        disabled={!format?.captions}
                        className="px-3 py-1.5 rounded-md bg-gray-800 text-slate-200 text-sm font-semibold border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
                      >
                        Apply Sentence case
                      </button>
                      <button
                        onClick={handleConvertAllToLines}
                        disabled={!format?.captions || captionWords.length === 0}
                        className="px-3 py-1.5 rounded-md bg-gray-800 text-slate-200 text-sm font-semibold border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
                      >
                        Convert all → lines
                      </button>
                      <button
                        onClick={handleConvertAllToWords}
                        disabled={!format?.captions || captionLines.length === 0}
                        className="px-3 py-1.5 rounded-md bg-gray-800 text-slate-200 text-sm font-semibold border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
                      >
                        Convert all → words
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>
                        Showing {captionLines.length || 0} lines and {captionWords.length || 0} words in time order.
                      </span>
                      <span>Line/word tags keep mixed formats clear.</span>
                    </div>
                  </div>

                  {renderError && <div className="text-xs text-red-300">{renderError}</div>}
                  {renderUrl && (
                    <div className="space-y-2">
                      <div className="text-xs text-emerald-300">
                        Render ready:{" "}
                        <a href={renderUrl} target="_blank" className="underline">
                          {renderUrl}
                        </a>
                      </div>
                      <video
                        key={renderUrl}
                        src={renderUrl}
                        controls
                        className="w-full max-h-96 rounded border border-gray-800"
                        playsInline
                      />
                    </div>
                  )}
                  {/* Style controls */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide">
                        Caption edit mode
                      </span>
                      <div className="inline-flex rounded-md border border-gray-800 bg-gray-900 p-0.5">
                        {[
                          { key: "all", label: "Edit all" },
                          { key: "sections", label: "Edit sections" },
                        ].map((opt) => {
                          const active = captionEditScope === opt.key;
                          return (
                            <button
                              key={opt.key}
                              onClick={() => setCaptionEditScope(opt.key)}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                active
                                  ? "bg-emerald-700 text-white"
                                  : "text-slate-300 hover:text-white hover:bg-gray-800"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      {hasCaptionOverrides && (
                        <span className="text-xs text-amber-300">
                          Sections detected · overrides are active
                        </span>
                      )}
                    </div>

                    {captionEditScope === "all" ? (
                      <>
                        <div className="text-xs text-slate-500">
                          Global range: {formatSecondsLabel(0)}s →{" "}
                          {formatSecondsLabel(songDuration || 0)}s
                        </div>
                        <div className="grid gap-2 md:grid-cols-3">
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>Style</span>
                            <select
                              className={captionSelectClass}
                              value={captionStyle.mode}
                              onChange={(e) => handleCaptionStyleChange("mode", e.target.value)}
                            >
                              <option value="default">Default</option>
                              <option value="cutout">Cutout</option>
                              <option value="negative">Negative</option>
                            </select>
                          </label>
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>Font</span>
                            <select
                              className={captionSelectClass}
                              value={captionStyle.fontFamily}
                              onChange={(e) => handleCaptionStyleChange("fontFamily", e.target.value)}
                            >
                              <option value="Montserrat">Montserrat</option>
                              <option value="Playfair Display">Playfair Display</option>
                            </select>
                          </label>
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>Weight</span>
                            <select
                              className={captionSelectClass}
                              value={captionStyle.fontWeight}
                              onChange={(e) => handleCaptionStyleChange("fontWeight", e.target.value)}
                            >
                              {["400", "600", "700", "800", "900"].map((w) => (
                                <option key={w} value={w}>
                                  {w}
                                </option>
                              ))}
                            </select>
                          </label>
                          {captionStyle.mode === "default" && (
                            <label className="text-xs text-slate-400 space-y-1">
                              <span>Color</span>
                              <input
                                type="color"
                                className="w-full h-9 rounded bg-white border border-slate-300 p-1"
                                value={captionStyle.color}
                                onChange={(e) => handleCaptionStyleChange("color", e.target.value)}
                              />
                            </label>
                          )}
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>Font size ratio (relative to frame height)</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0.05"
                              max="1"
                              className={captionInputClass}
                              value={captionStyle.fontSizeRatio}
                              onChange={(e) =>
                                handleCaptionStyleChange(
                                  "fontSizeRatio",
                                  parseFloat(e.target.value) || 0.25
                                )
                              }
                            />
                          </label>
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>Letter spacing (px or normalized)</span>
                            <input
                              type="number"
                              step="0.5"
                              className={captionInputClass}
                              value={captionStyle.letterSpacing}
                              onChange={(e) =>
                                handleCaptionStyleChange(
                                  "letterSpacing",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                            />
                          </label>
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>Reveal</span>
                            <select
                              className={captionSelectClass}
                              value={captionStyle.animation}
                              onChange={(e) => handleCaptionStyleChange("animation", e.target.value)}
                            >
                              <option value="word">Word by word</option>
                              <option value="chunk">Chunk/line</option>
                            </select>
                          </label>
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>All caps</span>
                            <button
                              onClick={() =>
                                handleCaptionStyleChange("uppercase", !captionStyle.uppercase)
                              }
                              className={`w-full px-3 py-2 rounded-md text-sm font-semibold border ${
                                captionStyle.uppercase
                                  ? "bg-emerald-700 text-white border-emerald-500"
                                  : "bg-gray-800 text-slate-200 border-gray-700"
                              }`}
                            >
                              {captionStyle.uppercase ? "Enabled" : "Disabled"}
                            </button>
                          </label>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-2">
                        {captionSections.length === 0 ? (
                          <div className="text-xs text-slate-500">No captions to segment yet.</div>
                        ) : (
                          captionSections.map((section, idx) => {
                            const styles = section.entries.map(getEffectiveCaptionStyle);
                            const firstKey = captionStyleKey(styles[0]);
                            const isUniform = styles.every(
                              (style) => captionStyleKey(style) === firstKey
                            );
                            const seedStyle = isUniform ? styles[0] : captionStyle;
                            return (
                              <div
                                key={section.id}
                                className="border border-gray-800 rounded-lg bg-gray-900/40 p-2 space-y-1"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-xs text-slate-300 font-semibold">
                                    Section {idx + 1} ·{" "}
                                    {formatSecondsLabel((section.startMs || 0) / 1000)}s →{" "}
                                    {formatSecondsLabel((section.endMs || 0) / 1000)}s ·{" "}
                                    {section.entries.length} item
                                    {section.entries.length === 1 ? "" : "s"}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() =>
                                        openBulkEditForKeys(section.keys, seedStyle)
                                      }
                                      className="px-2 py-1 text-xs rounded-md bg-emerald-700 text-white hover:bg-emerald-600"
                                    >
                                      Edit section
                                    </button>
                                    <button
                                      onClick={() =>
                                        applyBulkCaptionStyle(captionStyle, true, section.keys)
                                      }
                                      className="px-2 py-1 text-xs rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                                    >
                                      Use global
                                    </button>
                                  </div>
                                </div>
                                <div className="text-xs text-slate-500">
                                  Style: {getSectionStyleSummary(section)}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                        Lines + Words (time order)
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedCaptionKeys.length > 1 && (
                          <button
                            onClick={() => openBulkEditForKeys(selectedCaptionKeys, captionStyle)}
                            className="px-2 py-1 text-xs rounded-md bg-emerald-700 text-white hover:bg-emerald-600"
                          >
                            Bulk edit ({selectedCaptionKeys.length})
                          </button>
                        )}
                        {selectedCaptionKeys.length > 0 && (
                          <button
                            onClick={() => {
                              setSelectedCaptionKeys([]);
                              setLastCaptionSelectionIndex(null);
                            }}
                            className="px-2 py-1 text-xs rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                          >
                            Clear selection
                          </button>
                        )}
                        <button
                          onClick={handleAddLine}
                          className="px-2 py-1 text-xs rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                        >
                          Add line
                        </button>
                        <button
                          onClick={handleAddWord}
                          className="px-2 py-1 text-xs rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                        >
                          Add word
                        </button>
                        <div className="text-[11px] text-slate-500 hidden sm:block">
                          Click a row to select or edit.
                        </div>
                      </div>
                    </div>
                    {captionLines.length === 0 && captionWords.length === 0 ? (
                      <div className="text-sm text-slate-500">
                        No captions yet. Generate lyrics to populate timed entries.
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                        {captionEditScope === "sections"
                          ? captionSections.map((section, sectionIdx) => {
                              const styles = section.entries.map(getEffectiveCaptionStyle);
                              const firstKey = captionStyleKey(styles[0]);
                              const isUniform = styles.every(
                                (style) => captionStyleKey(style) === firstKey
                              );
                              const seedStyle = isUniform ? styles[0] : captionStyle;
                              return (
                                <div key={section.id} className="space-y-1">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border border-gray-800 rounded-md bg-gray-900/70 px-2 py-1 text-[11px] text-slate-300">
                                    <div>
                                      Section {sectionIdx + 1} ·{" "}
                                      {formatSecondsLabel((section.startMs || 0) / 1000)}s →{" "}
                                      {formatSecondsLabel((section.endMs || 0) / 1000)}s
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-slate-500">
                                        {getSectionStyleSummary(section)}
                                      </span>
                                      <button
                                        onClick={() => openBulkEditForKeys(section.keys, seedStyle)}
                                        className="px-2 py-0.5 rounded bg-emerald-700 text-white hover:bg-emerald-600"
                                      >
                                        Edit section
                                      </button>
                                    </div>
                                  </div>
                                  {section.entries.map((entry) => {
                                    const isLine = entry.type === "line";
                                    const idx = entry.data.index;
                                    const key = `${entry.type}-${idx}`;
                                    const orderIdx = combinedEntryIndexMap.get(key) ?? 0;
                                    const isSelected = selectedCaptionKeySet.has(key);
                                    const labelClasses = isLine
                                      ? "bg-indigo-900/60 text-indigo-100 border border-indigo-700"
                                      : "bg-amber-900/60 text-amber-100 border border-amber-700";
                                    return (
                                      <div
                                        key={`${entry.type}-${idx}-${orderIdx}`}
                                        className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-gray-800/60 border rounded-lg px-2 py-2 ${
                                          isSelected ? "border-emerald-500" : "border-gray-800"
                                        }`}
                                        onClick={(e) => {
                                          if (e.target.closest("input,select,textarea,button")) return;
                                          handleCaptionSelection(entry, orderIdx, e);
                                        }}
                                      >
                                        <div className="flex items-center gap-2 md:col-span-2">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleCaptionSelection(entry, orderIdx, e);
                                            }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            className={`text-xs font-semibold px-2 py-1 rounded ${
                                              isSelected
                                                ? "bg-emerald-700 text-white"
                                                : "bg-gray-900 text-slate-300 hover:bg-gray-700"
                                            }`}
                                          >
                                            #{idx + 1}
                                          </button>
                                          <span
                                            className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${labelClasses}`}
                                          >
                                            {isLine ? "Line" : "Word"}
                                          </span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openEditModal(isLine ? "line" : "word", idx);
                                            }}
                                            className="text-xs text-slate-300 hover:text-white"
                                          >
                                            Edit
                                          </button>
                                        </div>
                                        <label className="text-[11px] text-slate-400 space-y-1 md:col-span-2">
                                          <span>Start (s)</span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="0"
                                            className={captionInputClass}
                                            value={
                                              captionTimeDrafts[key]?.start ??
                                              formatSecondsInput(entry.data.startMs)
                                            }
                                            onChange={(e) => {
                                              const text = e.target.value;
                                              setCaptionTimeDrafts((prev) => ({
                                                ...prev,
                                                [key]: { ...(prev[key] || {}), start: text },
                                              }));
                                              const seconds = parseSecondsInput(text);
                                              if (seconds === null || seconds < 0) return;
                                              const startMs = Math.round(seconds * 1000);
                                              if (isLine) {
                                                handleCaptionLineChange(idx, { startMs });
                                              } else {
                                                updateCaptions((current) => {
                                                  const next = [...(current.words || [])];
                                                  if (!next[idx]) return current;
                                                  next[idx] = { ...next[idx], startMs };
                                                  return {
                                                    ...current,
                                                    words: next,
                                                    updatedAt: new Date().toISOString(),
                                                  };
                                                });
                                              }
                                            }}
                                          />
                                        </label>
                                        <label className="text-[11px] text-slate-400 space-y-1 md:col-span-2">
                                          <span>End (s)</span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="0"
                                            className={captionInputClass}
                                            value={
                                              captionTimeDrafts[key]?.end ??
                                              formatSecondsInput(entry.data.endMs)
                                            }
                                            onChange={(e) => {
                                              const text = e.target.value;
                                              setCaptionTimeDrafts((prev) => ({
                                                ...prev,
                                                [key]: { ...(prev[key] || {}), end: text },
                                              }));
                                              const seconds = parseSecondsInput(text);
                                              if (seconds === null || seconds < 0) return;
                                              const endMs = Math.round(seconds * 1000);
                                              if (isLine) {
                                                handleCaptionLineChange(idx, { endMs });
                                              } else {
                                                updateCaptions((current) => {
                                                  const next = [...(current.words || [])];
                                                  if (!next[idx]) return current;
                                                  next[idx] = { ...next[idx], endMs };
                                                  return {
                                                    ...current,
                                                    words: next,
                                                    updatedAt: new Date().toISOString(),
                                                  };
                                                });
                                              }
                                            }}
                                          />
                                        </label>
                                        <label className="text-[11px] text-slate-400 space-y-1 md:col-span-4">
                                          <span>Text</span>
                                          <input
                                            className={captionInputClass}
                                            value={entry.data.text}
                                            onChange={(e) => {
                                              const text = e.target.value;
                                              if (isLine) {
                                                handleCaptionLineChange(idx, { text });
                                              } else {
                                                updateCaptions((current) => {
                                                  const next = [...(current.words || [])];
                                                  if (!next[idx]) return current;
                                                  next[idx] = { ...next[idx], text };
                                                  return {
                                                    ...current,
                                                    words: next,
                                                    updatedAt: new Date().toISOString(),
                                                  };
                                                });
                                              }
                                            }}
                                          />
                                        </label>
                                        <div className="flex items-center gap-2 text-xs text-slate-400 md:col-span-2 md:justify-end">
                                          <button
                                            onClick={() =>
                                              isLine
                                                ? handleConvertLineToWords(idx)
                                                : handleConvertWordToLine(idx)
                                            }
                                            className="px-2 py-1 rounded bg-gray-900 hover:bg-gray-800 text-slate-200"
                                          >
                                            {isLine ? "To words" : "To line"}
                                          </button>
                                          <button
                                            onClick={() =>
                                              isLine ? handleRemoveLine(idx) : handleRemoveWord(idx)
                                            }
                                            className="px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-100"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })
                          : combinedCaptionEntries.map((entry, orderIdx) => {
                              const isLine = entry.type === "line";
                              const idx = entry.data.index;
                              const key = `${entry.type}-${idx}`;
                              const isSelected = selectedCaptionKeySet.has(key);
                              const labelClasses = isLine
                                ? "bg-indigo-900/60 text-indigo-100 border border-indigo-700"
                                : "bg-amber-900/60 text-amber-100 border border-amber-700";
                              return (
                                <div
                                  key={`${entry.type}-${idx}-${orderIdx}`}
                                  className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-gray-800/60 border rounded-lg px-2 py-2 ${
                                    isSelected ? "border-emerald-500" : "border-gray-800"
                                  }`}
                                  onClick={(e) => {
                                    if (e.target.closest("input,select,textarea,button")) return;
                                    handleCaptionSelection(entry, orderIdx, e);
                                  }}
                                >
                                  <div className="flex items-center gap-2 md:col-span-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCaptionSelection(entry, orderIdx, e);
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      className={`text-xs font-semibold px-2 py-1 rounded ${
                                        isSelected
                                          ? "bg-emerald-700 text-white"
                                          : "bg-gray-900 text-slate-300 hover:bg-gray-700"
                                      }`}
                                    >
                                      #{idx + 1}
                                    </button>
                                    <span
                                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${labelClasses}`}
                                    >
                                      {isLine ? "Line" : "Word"}
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEditModal(isLine ? "line" : "word", idx);
                                      }}
                                      className="text-xs text-slate-300 hover:text-white"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                  <label className="text-[11px] text-slate-400 space-y-1 md:col-span-2">
                                    <span>Start (s)</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      className={captionInputClass}
                                      value={
                                        captionTimeDrafts[key]?.start ??
                                        formatSecondsInput(entry.data.startMs)
                                      }
                                      onChange={(e) => {
                                        const text = e.target.value;
                                        setCaptionTimeDrafts((prev) => ({
                                          ...prev,
                                          [key]: { ...(prev[key] || {}), start: text },
                                        }));
                                        const seconds = parseSecondsInput(text);
                                        if (seconds === null || seconds < 0) return;
                                        const startMs = Math.round(seconds * 1000);
                                        if (isLine) {
                                          handleCaptionLineChange(idx, { startMs });
                                        } else {
                                          updateCaptions((current) => {
                                            const next = [...(current.words || [])];
                                            if (!next[idx]) return current;
                                            next[idx] = { ...next[idx], startMs };
                                            return {
                                              ...current,
                                              words: next,
                                              updatedAt: new Date().toISOString(),
                                            };
                                          });
                                        }
                                      }}
                                    />
                                  </label>
                                  <label className="text-[11px] text-slate-400 space-y-1 md:col-span-2">
                                    <span>End (s)</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      className={captionInputClass}
                                      value={
                                        captionTimeDrafts[key]?.end ??
                                        formatSecondsInput(entry.data.endMs)
                                      }
                                      onChange={(e) => {
                                        const text = e.target.value;
                                        setCaptionTimeDrafts((prev) => ({
                                          ...prev,
                                          [key]: { ...(prev[key] || {}), end: text },
                                        }));
                                        const seconds = parseSecondsInput(text);
                                        if (seconds === null || seconds < 0) return;
                                        const endMs = Math.round(seconds * 1000);
                                        if (isLine) {
                                          handleCaptionLineChange(idx, { endMs });
                                        } else {
                                          updateCaptions((current) => {
                                            const next = [...(current.words || [])];
                                            if (!next[idx]) return current;
                                            next[idx] = { ...next[idx], endMs };
                                            return {
                                              ...current,
                                              words: next,
                                              updatedAt: new Date().toISOString(),
                                            };
                                          });
                                        }
                                      }}
                                    />
                                  </label>
                                  <label className="text-[11px] text-slate-400 space-y-1 md:col-span-4">
                                    <span>Text</span>
                                    <input
                                      className={captionInputClass}
                                      value={entry.data.text}
                                      onChange={(e) => {
                                        const text = e.target.value;
                                        if (isLine) {
                                          handleCaptionLineChange(idx, { text });
                                        } else {
                                          updateCaptions((current) => {
                                            const next = [...(current.words || [])];
                                            if (!next[idx]) return current;
                                            next[idx] = { ...next[idx], text };
                                            return {
                                              ...current,
                                              words: next,
                                              updatedAt: new Date().toISOString(),
                                            };
                                          });
                                        }
                                      }}
                                    />
                                  </label>
                                  <div className="flex items-center gap-2 text-xs text-slate-400 md:col-span-2 md:justify-end">
                                    <button
                                      onClick={() =>
                                        isLine
                                          ? handleConvertLineToWords(idx)
                                          : handleConvertWordToLine(idx)
                                      }
                                      className="px-2 py-1 rounded bg-gray-900 hover:bg-gray-800 text-slate-200"
                                    >
                                      {isLine ? "To words" : "To line"}
                                    </button>
                                    <button
                                      onClick={() =>
                                        isLine ? handleRemoveLine(idx) : handleRemoveWord(idx)
                                      }
                                      className="px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-100"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                      </div>
                    )}
                  </div>

                  {/* Live preview */}
                  {captionPreviewOpen && (
                    <div className="border border-gray-800 rounded-lg bg-black/60 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Live caption preview (syncs to player time)</span>
                        {activeCaptionLine ? (
                          <span className="text-emerald-300">
                            {formatSecondsLabel(activeCaptionLine.startSeconds)}s →{" "}
                            {formatSecondsLabel(activeCaptionLine.endSeconds)}s
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            No active line at {formatSecondsLabel(currentTime)}s
                          </span>
                        )}
                      </div>
                      <div className="relative w-full overflow-hidden rounded-md border border-gray-800 bg-black">
                        <div className="relative aspect-video">
                          {/* Scenic background to visualize cutout/negative */}
                          <div
                            className="absolute inset-0 bg-cover bg-center opacity-80"
                            style={{ backgroundImage: "url('/testimage.png')" }}
                          />
                          {/* Subtle overlay to keep text readable */}
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                captionStyle.mode === "cutout"
                                  ? "rgba(0,0,0,0.55)"
                                  : captionStyle.mode === "negative"
                                  ? "rgba(0,0,0,0.65)"
                                  : "rgba(0,0,0,0.45)",
                            }}
                          />
                          {/* Caption text */}
                          <div className="relative z-10 flex items-center justify-center w-full h-full px-4">
                            <div
                              style={{
                                color:
                                  activePreviewText.style.mode === "default"
                                    ? activePreviewText.style.color
                                    : "#ffffff",
                                fontFamily: activePreviewText.style.fontFamily,
                                fontWeight: activePreviewText.style.fontWeight,
                                letterSpacing: activePreviewText.style.letterSpacing
                                  ? `${activePreviewText.style.letterSpacing}px`
                                  : undefined,
                                fontSize: `${activePreviewText.style.fontSizeRatio * 5}rem`,
                                textTransform: "none",
                                textShadow:
                                  activePreviewText.style.mode === "negative"
                                    ? "0 0 14px rgba(255,255,255,0.65)"
                                    : activePreviewText.style.mode === "cutout"
                                    ? "0 0 14px rgba(0,0,0,0.8)"
                                    : "0 0 10px rgba(0,0,0,0.5)",
                              }}
                              className="text-center leading-snug drop-shadow-lg"
                            >
                              {activePreviewText.style.uppercase
                                ? activePreviewText.text?.toUpperCase()
                                : activePreviewText.text}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                )}

                {/* Rapid clip selector */}
                <RapidClipSelector
                  duration={duration}
                  currentTime={currentTime}
                  rapidClipRanges={layerRapidClipRanges || []}
                  onAddRange={handleAddRapidRange}
                  onRemoveRange={handleRemoveRapidRange}
                  onUpdateRange={handleUpdateRapidRange}
                  onSeek={handleSeek}
                />

                {/* Mix segment automation */}
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Mix & Volume Automation
                      </h3>
                      <p className="text-xs text-slate-500">
                        Duck the song or boost clip audio for precise sections.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApplyFullSongMix(0.5, 1)}
                        disabled={!songDuration}
                        className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-slate-200 disabled:opacity-40"
                      >
                        Duck entire song
                      </button>
                      <button
                        onClick={handleAddMixSegment}
                        className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-500"
                      >
                        Add segment
                      </button>
                    </div>
                  </div>
                  {format.mixSegments?.length ? (
                    <div className="space-y-3">
                      {format.mixSegments.map((segment, idx) => (
                        <div
                          key={segment.id || idx}
                          className="border border-gray-800 rounded-lg p-3 bg-gray-900/60 space-y-3"
                        >
                          <div className="flex items-center gap-3 justify-between">
                            <div className="text-sm font-semibold text-slate-200 flex-1">
                              Segment {idx + 1}
                            </div>
                            <button
                              onClick={() => handleRemoveMixSegment(idx)}
                              className="text-xs text-red-300 hover:text-red-200"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <label className="text-xs text-slate-400 space-y-1">
                              <span>Label</span>
                              <input
                                className="w-full rounded bg-gray-800 border border-gray-700 p-2 text-sm"
                                value={segment.label || `Segment ${idx + 1}`}
                                onChange={(e) =>
                                  handleMixSegmentChange(idx, {
                                    label: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="text-xs text-slate-400 space-y-1">
                              <span>Start (s)</span>
                              <input
                                type="number"
                                step="0.05"
                                min="0"
                                className="w-full rounded bg-gray-800 border border-gray-700 p-2 text-sm"
                                value={segment.start}
                                onChange={(e) =>
                                  handleMixSegmentChange(idx, {
                                    start: parseFloat(e.target.value) || 0,
                                  })
                                }
                              />
                            </label>
                            <label className="text-xs text-slate-400 space-y-1">
                              <span>End (s)</span>
                              <input
                                type="number"
                                step="0.05"
                                min="0"
                                className="w-full rounded bg-gray-800 border border-gray-700 p-2 text-sm"
                                value={segment.end}
                                onChange={(e) =>
                                  handleMixSegmentChange(idx, {
                                    end: parseFloat(e.target.value) || segment.start,
                                  })
                                }
                              />
                            </label>
                            <div className="space-y-2">
                              <div className="text-xs text-slate-400">Duration</div>
                              <div className="text-sm text-slate-200 font-mono">
                                {(segment.end - segment.start).toFixed(2)}s
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="text-xs text-slate-400 space-y-1">
                              <div className="flex items-center justify-between">
                                <span>Song volume</span>
                                <span className="text-slate-300">
                                  {(segment.musicVolume * 100).toFixed(0)}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={segment.musicVolume}
                                onChange={(e) =>
                                  handleMixSegmentChange(idx, {
                                    musicVolume: parseFloat(e.target.value),
                                  })
                                }
                                className="w-full"
                              />
                            </label>
                            <label className="text-xs text-slate-400 space-y-1">
                              <div className="flex items-center justify-between">
                                <span>Clip volume</span>
                                <span className="text-slate-300">
                                  {(segment.clipVolume * 100).toFixed(0)}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={segment.clipVolume}
                                onChange={(e) =>
                                  handleMixSegmentChange(idx, {
                                    clipVolume: parseFloat(e.target.value),
                                  })
                                }
                                className="w-full"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">
                      No automation yet. Add segments to duck the song under dialogue,
                      or apply the preset to cover the entire track.
                    </div>
                  )}
                </div>

                {/* Segment guidelines wizard (v3-style) */}
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-3">
                  <div className="flex flex-col gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-white">Segment Guidelines & Scheduling</h3>
                    <p className="text-xs text-slate-500">
                      Tag segments with guideline tags, dialogue/visual/iconic/B-roll needs,
                      and pause/trim rules before editors head into the detailed song edit tab.
                    </p>
                  </div>
                  <div className="mb-3 rounded-lg border border-gray-800/80 bg-gray-900/60 p-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                          Global Segment Levels
                        </h4>
                        <p className="text-xs text-slate-500">
                          Adjust once to update Segment 0 and every segment below. Fine-tune individual
                          segments afterward if needed.
                        </p>
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {Math.round(globalVolumes.clipVolume * 100)}% clip ·{" "}
                        {Math.round(globalVolumes.musicVolume * 100)}% music
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="text-xs text-slate-400 space-y-1">
                        <div className="flex items-center justify-between">
                          <span>Clip loudness (dialogue, fx, VO)</span>
                          <span className="text-slate-300 font-mono">
                            {(globalVolumes.clipVolume * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={globalVolumes.clipVolume}
                          onChange={(e) => handleGlobalVolumeSliderChange("clipVolume", e.target.value)}
                          className="w-full"
                        />
                      </label>
                      <label className="text-xs text-slate-400 space-y-1">
                        <div className="flex items-center justify-between">
                          <span>Music underneath segments</span>
                          <span className="text-slate-300 font-mono">
                            {(globalVolumes.musicVolume * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={globalVolumes.musicVolume}
                          onChange={(e) => handleGlobalVolumeSliderChange("musicVolume", e.target.value)}
                          className="w-full"
                        />
                      </label>
                    </div>
                  </div>
                  {guidelineEntries.length === 0 ? (
                    <div className="text-sm text-slate-500">Create cuts to enable guideline planning.</div>
                  ) : (
                    <>
                      <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                        {guidelineEntries.map((entry) => (
                          <div
                            key={
                              entry.isIntro ? "segment-guideline-intro" : `segment-guideline-${entry.index}`
                            }
                            className="border border-gray-800 rounded-lg p-2 bg-gray-900/50 space-y-2"
                          >
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div className="text-xs font-semibold text-slate-200">
                                Segment {entry.displayIndex} · {entry.time.toFixed(3)}s →{" "}
                                {(entry.time + entry.duration).toFixed(3)}s
                                <span className="ml-2 text-xs text-slate-400">
                                  {entry.duration.toFixed(2)}s window
                                </span>
                                {entry.isIntro && entry.metadata?.label && (
                                  <span className="ml-2 text-xs font-semibold text-amber-300">
                                    {entry.metadata.label}
                                  </span>
                                )}
                              </div>
                              <label className="text-xs text-slate-400 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={entry.metadata?.clipSlot?.pauseMusic || false}
                                  onChange={(e) =>
                                    entry.isIntro
                                      ? handleIntroPauseToggle(e.target.checked)
                                      : handlePauseToggle(entry.index, e.target.checked)
                                  }
                                  className="rounded border-gray-600 bg-gray-800"
                                />
                                Pause song until clip ends
                              </label>
                              {isForegroundLayer && !entry.isIntro && (
                                <label className="text-xs text-slate-400 flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={entry.metadata?.layerEnabled !== false}
                                    onChange={(e) =>
                                      handleBeatMetadataChange(entry.index, {
                                        layerEnabled: e.target.checked,
                                      })
                                    }
                                    className="rounded border-gray-600 bg-gray-800"
                                  />
                                  Cutout active on this segment
                                </label>
                              )}
                            </div>

                            {entry.isIntro && (
                              <label className="text-xs text-slate-400 space-y-1">
                                <span>Opening segment label</span>
                                <input
                                  className="w-full rounded bg-gray-800 border border-gray-700 p-2 text-sm"
                                  placeholder="e.g. Opening tension, Ambient lead-in"
                                  value={entry.metadata?.label || ""}
                                  onChange={(e) => handleIntroBeatLabelChange(e.target.value)}
                                />
                              </label>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div className="text-xs text-slate-400 space-y-1">
                                <span>Guideline tags</span>
                                <div className="flex flex-wrap gap-2">
                                  {GUIDELINE_PRESETS.map((preset) => {
                                    const isActive =
                                      entry.metadata?.guidelineTags?.includes(preset.value) || false;
                                    return (
                                      <button
                                        key={preset.value}
                                        onClick={() =>
                                          entry.isIntro
                                            ? handleIntroGuidelineTagToggle(preset.value)
                                            : handleGuidelineTagToggle(entry.index, preset.value)
                                        }
                                        className={`px-2 py-1 rounded-full text-[11px] font-semibold border ${
                                          isActive
                                            ? "bg-emerald-700/40 border-emerald-500 text-emerald-100"
                                            : "bg-gray-800 border-gray-700 text-slate-300"
                                        }`}
                                      >
                                        {preset.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              {entry.metadata?.clipSlot?.pauseMusic && (
                                <label className="text-xs text-slate-400 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span>Max clip length (s)</span>
                                    <span className="text-slate-300 font-mono">
                                      {Number.isFinite(entry.metadata?.clipSlot?.maxClipSeconds)
                                        ? entry.metadata.clipSlot.maxClipSeconds.toFixed(2)
                                        : "None"}
                                    </span>
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
                                    value={
                                      Number.isFinite(entry.metadata?.clipSlot?.maxClipSeconds)
                                        ? entry.metadata.clipSlot.maxClipSeconds
                                        : ""
                                    }
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value);
                                      const maxClipSeconds = Number.isFinite(val) && val >= 0 ? val : null;
                                      const patch = { clipSlot: { maxClipSeconds } };
                                      if (entry.isIntro) {
                                        handleIntroBeatUpdate(patch);
                                      } else {
                                        handleBeatMetadataChange(entry.index, patch);
                                      }
                                    }}
                                  />
                                  <p className="text-[11px] text-slate-500">
                                    Limits eligible clips to this duration or shorter when music is paused.
                                  </p>
                                </label>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <label className="text-xs text-slate-400 space-y-1">
                                <span>Clip volume (segment)</span>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 text-[11px]">
                                    {Math.round(
                                      (entry.metadata?.clipSlot?.clipVolume ?? globalVolumes.clipVolume) * 100
                                    )}
                                    %
                                  </span>
                                  <span className="text-slate-500 text-[11px]">
                                    {Math.round(
                                      (entry.metadata?.clipSlot?.musicVolume ?? globalVolumes.musicVolume) * 100
                                    )}
                                    %
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={clampVolume(
                                    entry.metadata?.clipSlot?.clipVolume,
                                    globalVolumes.clipVolume
                                  )}
                                  onChange={(e) => {
                                    const clipVolume = clampVolume(parseFloat(e.target.value), 0);
                                    if (entry.isIntro) {
                                      handleIntroBeatUpdate({ clipSlot: { clipVolume } });
                                    } else {
                                      handleBeatMetadataChange(entry.index, { clipSlot: { clipVolume } });
                                    }
                                  }}
                                />
                              </label>
                              <label className="text-xs text-slate-400 space-y-1">
                                <span>Music volume (segment)</span>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={clampVolume(
                                    entry.metadata?.clipSlot?.musicVolume,
                                    globalVolumes.musicVolume
                                  )}
                                  onChange={(e) => {
                                    const musicVolume = clampVolume(parseFloat(e.target.value), 1);
                                    if (entry.isIntro) {
                                      handleIntroBeatUpdate({ clipSlot: { musicVolume } });
                                    } else {
                                      handleBeatMetadataChange(entry.index, { clipSlot: { musicVolume } });
                                    }
                                  }}
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Beat guidelines wizard */}
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-3">
                  <div className="flex flex-col gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-white">
                      Beat Guidelines & Scheduling
                    </h3>
                    <p className="text-xs text-slate-500">
                      Tag beats with intent, dialogue needs, and pause/trim rules
                      before editors head into the detailed song edit tab.
                    </p>
                  </div>
                  <div className="mb-3 rounded-lg border border-gray-800/80 bg-gray-900/60 p-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                          Global Beat Levels
                        </h4>
                        <p className="text-xs text-slate-500">
                          Adjust once to update Beat 0 and every beat below. Fine-tune individual
                          beats afterward if needed.
                        </p>
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {Math.round(globalVolumes.clipVolume * 100)}% clip ·{" "}
                        {Math.round(globalVolumes.musicVolume * 100)}% music
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="text-xs text-slate-400 space-y-1">
                        <div className="flex items-center justify-between">
                          <span>Clip loudness (dialogue, fx, VO)</span>
                          <span className="text-slate-300 font-mono">
                            {(globalVolumes.clipVolume * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={globalVolumes.clipVolume}
                          onChange={(e) => handleGlobalVolumeSliderChange("clipVolume", e.target.value)}
                          className="w-full"
                        />
                      </label>
                      <label className="text-xs text-slate-400 space-y-1">
                        <div className="flex items-center justify-between">
                          <span>Music underneath beats</span>
                          <span className="text-slate-300 font-mono">
                            {(globalVolumes.musicVolume * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={globalVolumes.musicVolume}
                          onChange={(e) => handleGlobalVolumeSliderChange("musicVolume", e.target.value)}
                          className="w-full"
                        />
                      </label>
                    </div>
                  </div>
                  {guidelineEntries.length === 0 ? (
                    <div className="text-sm text-slate-500">
                      Create beat marks to enable guideline planning.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                        {guidelineEntries.map((entry) => (
                          <div
                            key={
                              entry.isIntro
                                ? "beat-guideline-intro"
                                : `beat-guideline-${entry.index}`
                            }
                            className="border border-gray-800 rounded-lg p-2 bg-gray-900/50 space-y-2"
                          >
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div className="text-xs font-semibold text-slate-200">
                                Beat {entry.displayIndex} · {entry.time.toFixed(3)}s →{" "}
                                {(entry.time + entry.duration).toFixed(3)}s
                                <span className="ml-2 text-xs text-slate-400">
                                  {entry.duration.toFixed(2)}s window
                                </span>
                                {entry.isIntro && entry.metadata?.label && (
                                  <span className="ml-2 text-xs font-semibold text-amber-300">
                                    {entry.metadata.label}
                                  </span>
                                )}
                              </div>
                              <label className="text-xs text-slate-400 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={entry.metadata?.clipSlot?.pauseMusic || false}
                                  onChange={(e) =>
                                    entry.isIntro
                                      ? handleIntroPauseToggle(e.target.checked)
                                      : handlePauseToggle(entry.index, e.target.checked)
                                  }
                                  className="rounded border-gray-600 bg-gray-800"
                                />
                                Pause song until clip ends
                              </label>
                              {isForegroundLayer && !entry.isIntro && (
                                <label className="text-xs text-slate-400 flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={entry.metadata?.layerEnabled !== false}
                                    onChange={(e) =>
                                      handleBeatMetadataChange(entry.index, {
                                        layerEnabled: e.target.checked,
                                      })
                                    }
                                    className="rounded border-gray-600 bg-gray-800"
                                  />
                                  Cutout active on this beat
                                </label>
                              )}
                            </div>

                            {entry.isIntro && (
                              <label className="text-xs text-slate-400 space-y-1">
                                <span>Opening beat label</span>
                                <input
                                  className="w-full rounded bg-gray-800 border border-gray-700 p-2 text-sm"
                                  placeholder="e.g. Opening tension, Ambient lead-in"
                                  value={entry.metadata?.label || ""}
                                  onChange={(e) => handleIntroBeatLabelChange(e.target.value)}
                                />
                              </label>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <label className="text-xs text-slate-400 space-y-1">
                                <span>Intent</span>
                                <select
                                  className="w-full rounded bg-gray-800 border border-gray-700 p-2 text-sm"
                                  value={entry.metadata?.intent || "visual"}
                                  onChange={(e) =>
                                    entry.isIntro
                                      ? handleIntroIntentChange(e.target.value)
                                      : handleIntentChange(entry.index, e.target.value)
                                  }
                                >
                                  {INTENT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="text-xs text-slate-400 space-y-1">
                                <span>Guideline tags</span>
                                <div className="flex flex-wrap gap-2">
                                  {GUIDELINE_PRESETS.map((preset) => {
                                    const isActive =
                                      entry.metadata?.guidelineTags?.includes(preset.value) ||
                                      false;
                                    return (
                                      <button
                                        key={preset.value}
                                        onClick={() =>
                                          entry.isIntro
                                            ? handleIntroGuidelineTagToggle(preset.value)
                                            : handleGuidelineTagToggle(entry.index, preset.value)
                                        }
                                        className={`px-2 py-1 rounded-full text-[11px] font-semibold border ${
                                          isActive
                                            ? "bg-emerald-700/40 border-emerald-500 text-emerald-100"
                                            : "bg-gray-800 border-gray-700 text-slate-300"
                                        }`}
                                      >
                                        {preset.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <label className="text-xs text-slate-400 space-y-1">
                                <span>Custom note</span>
                                <input
                                  className="w-full rounded bg-gray-800 border border-gray-700 p-2 text-sm"
                                  placeholder="e.g. Bride POV whisper"
                                  value={entry.metadata?.customGuideline || ""}
                                  onChange={(e) =>
                                    entry.isIntro
                                      ? handleIntroCustomGuidelineChange(e.target.value)
                                      : handleBeatMetadataChange(entry.index, {
                                          customGuideline: e.target.value,
                                        })
                                  }
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <label className="text-xs text-slate-400 space-y-1">
                                <div className="flex items-center justify-between">
                                  <span>Clip volume</span>
                                  <span className="text-slate-300">
                                    {(
                                      (entry.metadata?.clipSlot?.clipVolume ?? 1) * 100
                                    ).toFixed(0)}
                                    %
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={entry.metadata?.clipSlot?.clipVolume ?? 1}
                                  onChange={(e) =>
                                    entry.isIntro
                                      ? handleIntroClipVolumeChange(
                                          "clipVolume",
                                          parseFloat(e.target.value)
                                        )
                                      : handleClipVolumeChange(
                                          entry.index,
                                          "clipVolume",
                                          parseFloat(e.target.value)
                                        )
                                  }
                                  className="w-full"
                                />
                              </label>
                              <label className="text-xs text-slate-400 space-y-1">
                                <div className="flex items-center justify-between">
                                  <span>Music under this beat</span>
                                  <span className="text-slate-300">
                                    {(
                                      (entry.metadata?.clipSlot?.musicVolume ?? 1) * 100
                                    ).toFixed(0)}
                                    %
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={entry.metadata?.clipSlot?.musicVolume ?? 1}
                                  onChange={(e) =>
                                    entry.isIntro
                                      ? handleIntroClipVolumeChange(
                                          "musicVolume",
                                          parseFloat(e.target.value)
                                        )
                                      : handleClipVolumeChange(
                                          entry.index,
                                          "musicVolume",
                                          parseFloat(e.target.value)
                                        )
                                  }
                                  className="w-full"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                      {beatEntries.length === 0 && (
                        <div className="mt-2 text-xs text-slate-500 border border-dashed border-gray-800 rounded-lg p-2">
                          Add beat marks to plan guidelines beyond Beat 0.
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Marks list */}
                {layerBeatGrid.length > 0 && (
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-white mb-3">
                      {isForegroundLayer ? "Foreground" : "Background"} Marks ({layerBeatGrid.length})
                    </h3>
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                      {layerBeatGrid.map((mark, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSeek(mark)}
                          className="group flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs font-mono text-slate-300 transition-colors"
                        >
                          <span>{idx + 1}.</span>
                          <span className="text-emerald-400">{mark.toFixed(3)}s</span>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkDelete(idx);
                            }}
                            className="ml-1 text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-300 cursor-pointer"
                          >
                            ×
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Format info with frame details */}
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">Format Info</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-slate-500">Source</div>
                      <div className="text-slate-200 font-mono text-xs truncate">
                        {format.source}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Duration</div>
                      <div className="text-slate-200 font-mono">
                        {format.meta.durationSeconds?.toFixed(3)}s
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Target FPS</div>
                      <div className="text-cyan-400 font-mono">
                        {format.meta?.targetFps || 30}fps
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Total Frames</div>
                      <div className="text-cyan-400 font-mono">
                        {format.meta?.totalFrames || Math.round((format.meta?.durationSeconds || 0) * (format.meta?.targetFps || 30))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-3 pt-3 border-t border-gray-800">
                    <div>
                      <div className="text-slate-500">Total Clips</div>
                      <div className="text-emerald-400 font-semibold">
                        {format.meta?.totalClips || format.beatGrid.length + 1}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Min/Max Clip</div>
                      <div className="text-slate-200 font-mono text-xs">
                        {format.meta?.minClipFrames || "—"}f / {format.meta?.maxClipFrames || "—"}f
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Status</div>
                      <div className={formatExists ? "text-emerald-400" : "text-amber-400"}>
                        {formatExists ? "Saved" : "New"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Last Updated</div>
                      <div className="text-slate-200 text-xs">
                        {format.updatedAt
                          ? new Date(format.updatedAt).toLocaleString()
                          : "Never"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <EditTester
                songPath={selectedSong.path}
                marks={format.beatGrid}
                rapidClipRanges={format.rapidClipRanges || []}
                foregroundMarks={enabledForegroundBeatGrid}
                foregroundRapidClipRanges={foregroundLayer.rapidClipRanges || []}
                foregroundEnabled={cutoutEnabled}
                fps={format.meta?.targetFps || 30}
              />
            )}
          </>
        )}

        {/* Empty state */}
        {!selectedSong && !loading && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🎵</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Select a Song to Get Started
            </h2>
            <p className="text-slate-400 max-w-md mx-auto">
              Choose a song from the dropdown above to begin creating a beat map.
              Add beat marks in real-time while the song plays, or define rapid clip ranges.
            </p>
          </div>
        )}

        {/* Caption edit modal */}
        {editModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4">
            <div className="w-full max-w-xl bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">
                  Edit {editModal.type === "line" ? "Line" : "Word"} #{editModal.index + 1}
                </h3>
                <button
                  onClick={cancelEditModal}
                  className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded"
                >
                  Close
                </button>
              </div>
              <div className="grid gap-3">
                <label className="text-xs text-slate-400 space-y-1">
                  <span>Text</span>
                  <input
                    className={captionInputClass}
                    value={editModal.draft.text}
                    onChange={(e) =>
                      setEditModal((prev) =>
                        prev ? { ...prev, draft: { ...prev.draft, text: e.target.value } } : prev
                      )
                    }
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-slate-400 space-y-1">
                    <span>Start (s)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className={captionInputClass}
                      value={
                        editModal.draft.startSecondsText ??
                        formatSecondsInput(editModal.draft.startMs)
                      }
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                draft: {
                                  ...prev.draft,
                                  startSecondsText: e.target.value,
                                },
                              }
                            : prev
                        )
                      }
                    />
                  </label>
                  <label className="text-xs text-slate-400 space-y-1">
                    <span>End (s)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className={captionInputClass}
                      value={
                        editModal.draft.endSecondsText ??
                        formatSecondsInput(editModal.draft.endMs)
                      }
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                draft: {
                                  ...prev.draft,
                                  endSecondsText: e.target.value,
                                },
                              }
                            : prev
                        )
                      }
                    />
                  </label>
                </div>

                {(editModal.type === "line" || editModal.type === "word") && (
                  <div className="space-y-2 border border-gray-800 rounded-md p-3 bg-gray-900/50">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={editModal.draft.useGlobalStyle}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, draft: { ...prev.draft, useGlobalStyle: e.target.checked } }
                              : prev
                          )
                        }
                        className="rounded border-gray-600 bg-gray-800"
                      />
                      Use global style
                    </label>
                    <div className={editModal.draft.useGlobalStyle ? "opacity-60 pointer-events-none" : ""}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-slate-400 space-y-1">
                          <span>Style</span>
                          <select
                            className={captionSelectClass}
                            value={editModal.draft.style.mode}
                            onChange={(e) =>
                              setEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      draft: {
                                        ...prev.draft,
                                        style: { ...prev.draft.style, mode: e.target.value },
                                      },
                                    }
                                  : prev
                              )
                            }
                          >
                            <option value="default">Default</option>
                            <option value="cutout">Cutout</option>
                            <option value="negative">Negative</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-400 space-y-1">
                          <span>Font</span>
                          <select
                            className={captionSelectClass}
                            value={editModal.draft.style.fontFamily}
                            onChange={(e) =>
                              setEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      draft: {
                                        ...prev.draft,
                                        style: { ...prev.draft.style, fontFamily: e.target.value },
                                      },
                                    }
                                  : prev
                              )
                            }
                          >
                            <option value="Montserrat">Montserrat</option>
                            <option value="Playfair Display">Playfair Display</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-400 space-y-1">
                          <span>Weight</span>
                          <select
                            className={captionSelectClass}
                            value={editModal.draft.style.fontWeight}
                            onChange={(e) =>
                              setEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      draft: {
                                        ...prev.draft,
                                        style: { ...prev.draft.style, fontWeight: e.target.value },
                                      },
                                    }
                                  : prev
                              )
                            }
                          >
                            {["400", "600", "700", "800", "900"].map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </label>
                        {editModal.draft.style.mode === "default" && (
                          <label className="text-xs text-slate-400 space-y-1">
                            <span>Color</span>
                            <input
                              type="color"
                              className="w-full h-9 rounded bg-white border border-slate-300 p-1"
                              value={editModal.draft.style.color}
                              onChange={(e) =>
                                setEditModal((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        draft: {
                                          ...prev.draft,
                                          style: { ...prev.draft.style, color: e.target.value },
                                        },
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                        )}
                        <label className="text-xs text-slate-400 space-y-1">
                          <span>Font size ratio</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.05"
                            max="1"
                            className={captionInputClass}
                            value={editModal.draft.style.fontSizeRatio}
                            onChange={(e) =>
                              setEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      draft: {
                                        ...prev.draft,
                                        style: {
                                          ...prev.draft.style,
                                          fontSizeRatio:
                                            parseFloat(e.target.value) || prev.draft.style.fontSizeRatio,
                                        },
                                      },
                                    }
                                  : prev
                              )
                            }
                          />
                        </label>
                        <label className="text-xs text-slate-400 space-y-1">
                          <span>Letter spacing</span>
                          <input
                            type="number"
                            step="0.5"
                            className={captionInputClass}
                            value={editModal.draft.style.letterSpacing}
                            onChange={(e) =>
                              setEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      draft: {
                                        ...prev.draft,
                                        style: {
                                          ...prev.draft.style,
                                          letterSpacing: parseFloat(e.target.value) || 0,
                                        },
                                      },
                                    }
                                  : prev
                              )
                            }
                          />
                        </label>
                        <label className="text-xs text-slate-400 space-y-1">
                          <span>Reveal</span>
                          <select
                            className={captionSelectClass}
                            value={editModal.draft.style.animation}
                            onChange={(e) =>
                              setEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      draft: {
                                        ...prev.draft,
                                        style: { ...prev.draft.style, animation: e.target.value },
                                      },
                                    }
                                  : prev
                              )
                            }
                          >
                            <option value="word">Word by word</option>
                            <option value="chunk">Chunk/line</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-400 space-y-1">
                          <span>All caps</span>
                          <button
                            onClick={() =>
                              setEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      draft: {
                                        ...prev.draft,
                                        style: {
                                          ...prev.draft.style,
                                          uppercase: !prev.draft.style.uppercase,
                                        },
                                      },
                                    }
                                  : prev
                              )
                            }
                            className={`w-full px-3 py-2 rounded-md text-sm font-semibold border ${
                              editModal.draft.style.uppercase
                                ? "bg-emerald-700 text-white border-emerald-500"
                                : "bg-gray-800 text-slate-200 border-gray-700"
                            }`}
                          >
                            {editModal.draft.style.uppercase ? "Enabled" : "Disabled"}
                          </button>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={cancelEditModal}
                    className="px-3 py-1.5 text-xs rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEditModal}
                    className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {bulkEditModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4">
            <div className="w-full max-w-2xl bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Bulk edit captions</h3>
                  <p className="text-xs text-slate-500">
                    {bulkEditTargetKeys.length} selected · style settings only
                  </p>
                </div>
                <button
                  onClick={() => setBulkEditModal(null)}
                  className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2 border border-gray-800 rounded-md p-3 bg-gray-900/50">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={bulkEditModal.useGlobalStyle}
                    onChange={(e) =>
                      setBulkEditModal((prev) =>
                        prev ? { ...prev, useGlobalStyle: e.target.checked } : prev
                      )
                    }
                    className="rounded border-gray-600 bg-gray-800"
                  />
                  Use global style
                </label>
                <div className={bulkEditModal.useGlobalStyle ? "opacity-60 pointer-events-none" : ""}>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="text-xs text-slate-400 space-y-1">
                      <span>Style</span>
                      <select
                        className={captionSelectClass}
                        value={bulkEditModal.draft.mode}
                        onChange={(e) =>
                          setBulkEditModal((prev) =>
                            prev ? { ...prev, draft: { ...prev.draft, mode: e.target.value } } : prev
                          )
                        }
                      >
                        <option value="default">Default</option>
                        <option value="cutout">Cutout</option>
                        <option value="negative">Negative</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-400 space-y-1">
                      <span>Font</span>
                      <select
                        className={captionSelectClass}
                        value={bulkEditModal.draft.fontFamily}
                        onChange={(e) =>
                          setBulkEditModal((prev) =>
                            prev
                              ? { ...prev, draft: { ...prev.draft, fontFamily: e.target.value } }
                              : prev
                          )
                        }
                      >
                        <option value="Montserrat">Montserrat</option>
                        <option value="Playfair Display">Playfair Display</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-400 space-y-1">
                      <span>Weight</span>
                      <select
                        className={captionSelectClass}
                        value={bulkEditModal.draft.fontWeight}
                        onChange={(e) =>
                          setBulkEditModal((prev) =>
                            prev
                              ? { ...prev, draft: { ...prev.draft, fontWeight: e.target.value } }
                              : prev
                          )
                        }
                      >
                        {["400", "600", "700", "800", "900"].map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </label>
                    {bulkEditModal.draft.mode === "default" && (
                      <label className="text-xs text-slate-400 space-y-1">
                        <span>Color</span>
                        <input
                          type="color"
                          className="w-full h-9 rounded bg-white border border-slate-300 p-1"
                          value={bulkEditModal.draft.color}
                          onChange={(e) =>
                            setBulkEditModal((prev) =>
                              prev
                                ? { ...prev, draft: { ...prev.draft, color: e.target.value } }
                                : prev
                            )
                          }
                        />
                      </label>
                    )}
                    <label className="text-xs text-slate-400 space-y-1">
                      <span>Font size ratio</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.05"
                        max="1"
                        className={captionInputClass}
                        value={bulkEditModal.draft.fontSizeRatio}
                        onChange={(e) =>
                          setBulkEditModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  draft: {
                                    ...prev.draft,
                                    fontSizeRatio:
                                      parseFloat(e.target.value) || prev.draft.fontSizeRatio,
                                  },
                                }
                              : prev
                          )
                        }
                      />
                    </label>
                    <label className="text-xs text-slate-400 space-y-1">
                      <span>Letter spacing</span>
                      <input
                        type="number"
                        step="0.5"
                        className={captionInputClass}
                        value={bulkEditModal.draft.letterSpacing}
                        onChange={(e) =>
                          setBulkEditModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  draft: {
                                    ...prev.draft,
                                    letterSpacing: parseFloat(e.target.value) || 0,
                                  },
                                }
                              : prev
                          )
                        }
                      />
                    </label>
                    <label className="text-xs text-slate-400 space-y-1">
                      <span>Reveal</span>
                      <select
                        className={captionSelectClass}
                        value={bulkEditModal.draft.animation}
                        onChange={(e) =>
                          setBulkEditModal((prev) =>
                            prev
                              ? { ...prev, draft: { ...prev.draft, animation: e.target.value } }
                              : prev
                          )
                        }
                      >
                        <option value="word">Word by word</option>
                        <option value="chunk">Chunk/line</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-400 space-y-1">
                      <span>All caps</span>
                      <button
                        onClick={() =>
                          setBulkEditModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  draft: {
                                    ...prev.draft,
                                    uppercase: !prev.draft.uppercase,
                                  },
                                }
                              : prev
                          )
                        }
                        className={`w-full px-3 py-2 rounded-md text-sm font-semibold border ${
                          bulkEditModal.draft.uppercase
                            ? "bg-emerald-700 text-white border-emerald-500"
                            : "bg-gray-800 text-slate-200 border-gray-700"
                        }`}
                      >
                        {bulkEditModal.draft.uppercase ? "Enabled" : "Disabled"}
                      </button>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  onClick={() => {
                    applySelectedCaptionTextTransform((text) => text.toUpperCase(), bulkEditTargetKeys);
                    setBulkEditModal((prev) =>
                      prev ? { ...prev, draft: { ...prev.draft, uppercase: true } } : prev
                    );
                  }}
                  className="px-2 py-1 rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                >
                  Make text ALL CAPS
                </button>
                <button
                  onClick={() => {
                    applySelectedCaptionTextTransform((text) => {
                      const trimmed = text.trimStart();
                      if (!trimmed) return text;
                      const lowered = trimmed.toLowerCase();
                      const capped = lowered.replace(/^([a-z])/i, (m) => m.toUpperCase());
                      const leadingSpaces = text.length - trimmed.length;
                      return `${" ".repeat(leadingSpaces)}${capped}`;
                    }, bulkEditTargetKeys);
                    setBulkEditModal((prev) =>
                      prev ? { ...prev, draft: { ...prev.draft, uppercase: false } } : prev
                    );
                  }}
                  className="px-2 py-1 rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                >
                  Sentence case text
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setBulkEditModal(null)}
                  className="px-3 py-1.5 text-xs rounded-md bg-gray-800 text-slate-200 hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    applyBulkCaptionStyle(
                      bulkEditModal.draft,
                      bulkEditModal.useGlobalStyle,
                      bulkEditTargetKeys
                    );
                    setBulkEditModal(null);
                  }}
                  className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  Apply to selected
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default FormatBuilderPage;

