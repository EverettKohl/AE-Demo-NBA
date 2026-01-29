"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { SongSelector, EditTester } from "@/components/FormatBuilderV3";
import ClipPreviewPlayer from "@/components/ClipPreviewPlayer";
import ClipMapViewer from "@/components/ClipMapViewer";
import { fromQuickEdit3Plan } from "@/lib/clipMap/adapters";
import UnifiedTimeline, { WAVEFORM_LAYERS } from "@/components/FormatBuilderV3/UnifiedTimeline";
import {
  clampVolume,
  normalizeIntroBeat,
  normalizeMixSegments,
} from "@/lib/songEditScheduler";
import { TARGET_FPS, secondsToFrame, frameToSeconds, rapidRangesToFrames } from "@/lib/frameAccurateTiming";
import { getOptimalClipUrl } from "@/utils/cloudinary";

const DEFAULT_CLIP_VOLUME = 0;
const DEFAULT_MUSIC_VOLUME = 1;

const DEFAULT_CAPTION_STYLE = {
  mode: "default", // default | cutout | negative
  textEffect: "default",
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
  mode: style?.textEffect || style?.mode || DEFAULT_CAPTION_STYLE.mode,
  textEffect: style?.textEffect || style?.mode || DEFAULT_CAPTION_STYLE.textEffect,
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
          layer: word.layer || null,
          style: word.style ? ensureCaptionStyle(word.style) : null,
        }))
      : [],
    lines: Array.isArray(captions.lines)
      ? captions.lines.map((line) => ({
          text: line.text || "",
          startMs: Number(line.startMs) || 0,
          endMs: Number(line.endMs) || Number(line.startMs) || 0,
          useGlobalStyle: line.useGlobalStyle !== false,
          layer: line.layer || null,
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

const ensureFullSongCaptions = (captions, durationSeconds) => {
  const normalized =
    normalizeCaptions(captions) || {
      provider: "manual",
      status: "draft",
      words: [],
      lines: [],
      style: ensureCaptionStyle(captions?.style),
      displayRanges: [],
    };
  const durationMs = Math.max(0, Math.round((Number(durationSeconds) || 0) * 1000));
  if (!durationMs) return normalized;
  if (Array.isArray(normalized.lines) && normalized.lines.length) {
    return normalized;
  }
  return {
    ...normalized,
    lines: [
      {
        text: "",
        startMs: 0,
        endMs: durationMs,
        useGlobalStyle: true,
        style: null,
      },
    ],
  };
};

const MIN_SEGMENT_DURATION = 0.1;
const LAYER_TYPES = {
  BASE: "base",
  CUTOUT: "cutout",
  CAPTIONS: "captions",
  STILLS: "stills",
  WAVEFORM: "waveform",
};

const normalizeLayersFromFormat = (fmt = {}) => {
  const videoLayer = {
    id: "video",
    type: LAYER_TYPES.BASE,
    name: "Video",
    order: 0,
    visible: true,
    locked: false,
    segments: [],
    frameSegments: [],
  };
  const defaults = [videoLayer];
  if (fmt.cutoutEnabled) {
    defaults.push({
      id: "cutout",
      type: LAYER_TYPES.CUTOUT,
      name: "Cutout",
      order: 1,
      visible: true,
      locked: false,
      segments: [],
      frameSegments: [],
    });
  }
  if ((fmt.captions || fmt.captionVariants) && !fmt.captionsLayerRemoved) {
    defaults.push({
      id: "captions",
      type: LAYER_TYPES.CAPTIONS,
      name: "Captions",
      order: defaults.length,
      visible: true,
      locked: false,
      segments: [],
      frameSegments: [],
    });
  }
  if (Array.isArray(fmt.stills) && fmt.stills.length) {
    defaults.push({
      id: "stills",
      type: LAYER_TYPES.STILLS,
      name: "Stills",
      order: defaults.length,
      visible: true,
      locked: false,
      segments: [],
      frameSegments: [],
    });
  }
  defaults.push({
    id: "waveform",
    type: LAYER_TYPES.WAVEFORM,
    name: "Waveform",
    order: defaults.length,
    visible: true,
    locked: true,
    segments: [],
    frameSegments: [],
  });
  const incoming = Array.isArray(fmt.layers) ? fmt.layers : [];
  const merged = incoming.length
    ? incoming.map((l, idx) => ({
        id: l.id || l.type || `layer-${idx}`,
        type: l.type || LAYER_TYPES.BASE,
        name: l.name || l.label || l.type || `Layer ${idx + 1}`,
        order: Number.isFinite(l.order) ? l.order : idx,
        visible: l.visible !== false,
        locked: l.locked === true || l.type === LAYER_TYPES.WAVEFORM,
        segments: Array.isArray(l.segments) ? l.segments : [],
        frameSegments: Array.isArray(l.frameSegments) ? l.frameSegments : [],
      }))
    : defaults;
  const deduped = [];
  const seen = new Set();
  merged.forEach((l) => {
    const id = l.id || l.type || `layer-${deduped.length}`;
    if (seen.has(id)) return;
    seen.add(id);
    deduped.push({ ...l, id });
  });
  const sorted = deduped.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
  if (!sorted.some((l) => l.type === LAYER_TYPES.BASE)) {
    sorted.push({ ...videoLayer, order: sorted.length ? sorted[0].order + 1 : 0 });
  }
  if (!sorted.some((l) => l.type === LAYER_TYPES.WAVEFORM)) {
    sorted.push({
      id: "waveform",
      type: LAYER_TYPES.WAVEFORM,
      name: "Waveform",
      order: sorted.length ? sorted[0].order + 2 : 1,
      visible: true,
      locked: true,
    });
  }
  return sorted.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
};

const GUIDELINE_TAG_PRESETS = [
  { value: "like_dialogue", label: "Like dialogue" },
  { value: "like_visual", label: "Like visual" },
  { value: "iconic_clip", label: "Iconic clip" },
  { value: "iconic", label: "Iconic" },
  { value: "b_roll_clip", label: "B-roll clip" },
];

const formatSecondsLabel = (seconds) => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "0.000";
  }
  return seconds.toFixed(3);
};

const ImportSegmentDetails = ({ segment, clipMap }) => {
  const slot = useMemo(() => {
    if (!segment || !clipMap?.slots) return null;
    const idx = segment.index ?? segment.id ?? null;
    const byMetadata = clipMap.slots.find((s) => s.metadata?.segmentIndex === idx - 1 || s.metadata?.segmentIndex === idx);
    if (byMetadata) return byMetadata;
    const byOrder = clipMap.slots.find((s) => s.order === idx || s.order === idx - 1);
    return byOrder || clipMap.slots[0] || null;
  }, [clipMap?.slots, segment]);

  const assigned = slot?.assignedClip || segment?.payload?.asset || null;

  const previewUrl =
    assigned?.localPath ||
    assigned?.cloudinaryId ||
    assigned?.videoUrl ||
    assigned?.url ||
    segment?.payload?.asset?.localPath ||
    null;

  const label = slot ? `Slot ${slot.order + 1}` : segment ? `Segment ${segment.index || ""}` : "Segment";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">{label}</div>
          <div className="text-[11px] text-slate-400">
            {segment?.startSeconds?.toFixed?.(3) ?? ""}s → {segment?.endSeconds?.toFixed?.(3) ?? ""}s ·{" "}
            {(segment?.durationSeconds || Math.max(0, (segment?.endSeconds || 0) - (segment?.startSeconds || 0))).toFixed(2)}s
          </div>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-md text-xs font-semibold border border-emerald-400/60 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300">
            Edit
          </button>
          <button className="px-3 py-1.5 rounded-md text-xs font-semibold border border-indigo-400/60 bg-indigo-500/10 text-indigo-100 hover:border-indigo-300">
            Search
          </button>
          <button className="px-3 py-1.5 rounded-md text-xs font-semibold border border-amber-400/60 bg-amber-500/10 text-amber-100 hover:border-amber-300">
            Randomize
          </button>
        </div>
      </div>

      {assigned ? (
        <div className="text-xs text-slate-300 grid gap-1">
          {assigned.videoId && <div>Video ID: {assigned.videoId}</div>}
          {assigned.cloudinaryId && <div>Cloudinary: {assigned.cloudinaryId}</div>}
          {Number.isFinite(assigned.start) && Number.isFinite(assigned.end) && (
            <div>
              Clip: {assigned.start.toFixed(2)}s → {assigned.end.toFixed(2)}s ({Math.max(0, assigned.end - assigned.start).toFixed(2)}s)
            </div>
          )}
          {assigned.sourcePoolIndex !== undefined && assigned.sourcePoolIndex !== null && (
            <div>Pool index: {assigned.sourcePoolIndex}</div>
          )}
        </div>
      ) : (
        <div className="text-xs text-slate-500">No clip assigned to this segment.</div>
      )}

      <div className="rounded-md border border-gray-800 bg-black/40 p-2">
        {previewUrl ? (
          <video className="w-full rounded" src={previewUrl} controls preload="metadata" />
        ) : (
          <div className="text-xs text-slate-500 text-center py-6">Preview unavailable for this clip</div>
        )}
      </div>
    </div>
  );
};

const ImportClipPlayer = ({ segments, activeIndex, onChangeIndex }) => {
  const clip = segments[activeIndex] || null;
  const hasNext = activeIndex < segments.length - 1;
  const hasPrev = activeIndex > 0;

  const handleEnded = () => {
    if (hasNext) {
      onChangeIndex(activeIndex + 1);
    }
  };

  if (!clip) {
    return <div className="text-sm text-slate-500 text-center py-6">No clips available.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded-md bg-black/50 border border-gray-800 font-semibold">
            Clip {activeIndex + 1} / {segments.length}
          </span>
          <span className="text-slate-500">
            {clip.start.toFixed(2)}s → {clip.end.toFixed(2)}s ({clip.duration.toFixed(2)}s)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => hasPrev && onChangeIndex(activeIndex - 1)}
            disabled={!hasPrev}
            className={`px-2 py-1 rounded-md border text-xs font-semibold ${
              hasPrev
                ? "border-gray-700 bg-gray-800 text-slate-200 hover:bg-gray-700"
                : "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
            }`}
          >
            Prev
          </button>
          <button
            onClick={() => hasNext && onChangeIndex(activeIndex + 1)}
            disabled={!hasNext}
            className={`px-2 py-1 rounded-md border text-xs font-semibold ${
              hasNext
                ? "border-gray-700 bg-gray-800 text-slate-200 hover:bg-gray-700"
                : "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
            }`}
          >
            Next
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-700 bg-black overflow-hidden aspect-video">
        {clip.mp4Url ? (
          <ClipPreviewPlayer
            mp4Url={clip.mp4Url}
            startTime={clip.clip?.start ?? 0}
            endTime={clip.clip?.end ?? null}
            playing
            onEnded={handleEnded}
            showProgress
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
            No preview for this clip
          </div>
        )}
      </div>
    </div>
  );
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

const CompactSegmentInspector = ({
  segmentIndex,
  start,
  end,
  layerLabel,
  isPlaying,
  isSegmentPreviewing,
  segmentTimeDraft,
  setSegmentTimeDraft,
  onApplyTimes,
  onPlaySegment,
  pauseMusic,
  onTogglePause,
  clipVolume = 1,
  musicVolume = 1,
  onVolumeChange,
  rapidEnabled = false,
  onRapidToggle,
  onDeleteSegment,
  guidelineTags,
  guidelineTagOptions,
  onGuidelineToggle,
}) => {
  const [tagsOpen, setTagsOpen] = useState(false);
  const handleTimeBlur = () => onApplyTimes();
  const handleTimeKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onApplyTimes();
    }
  };
  const displayClipVolume = Math.round((clipVolume ?? 1) * 100);
  const displayMusicVolume = Math.round((musicVolume ?? 1) * 100);

  return (
    <div className="rounded-md border border-black/60 bg-[#0d0d0d] p-2 space-y-2 h-80 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-100">
        <span className="px-2 py-1 rounded border border-gray-700 bg-gray-900 font-semibold">
          Segment {segmentIndex + 1}
        </span>
        <span className="px-2 py-1 rounded border border-gray-700 bg-gray-900 font-mono">
          {start.toFixed(3)}s → {end.toFixed(3)}s
        </span>
        <span className="px-2 py-1 rounded border border-gray-700 bg-gray-900">{layerLabel}</span>
        <button
          onClick={onPlaySegment}
          className="px-2 py-1 rounded border border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-600 text-[11px] font-semibold"
        >
          {isSegmentPreviewing && isPlaying ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => onTogglePause(!pauseMusic)}
          className={`px-2 py-1 rounded border text-[11px] font-semibold ${
            pauseMusic
              ? "border-amber-500 bg-amber-700 text-white"
              : "border-gray-700 bg-gray-800 text-slate-200"
          }`}
        >
          {pauseMusic ? "Music paused" : "Pause music"}
        </button>
        <button
          onClick={() => setTagsOpen((o) => !o)}
          className="px-2 py-1 rounded border border-gray-700 bg-gray-800 text-[11px] text-slate-200 hover:bg-gray-700"
        >
          Tags
        </button>
        {typeof onRapidToggle === "function" && (
          <button
            onClick={(e) => onRapidToggle(e)}
            className={`px-2 py-1 rounded border text-[11px] font-semibold ${
              rapidEnabled
                ? "border-purple-500 bg-purple-800/70 text-white"
                : "border-gray-700 bg-gray-800 text-slate-200"
            }`}
          >
            {rapidEnabled ? "Rapid on" : "Rapid off"}
          </button>
        )}
        {typeof onDeleteSegment === "function" && (
          <button
            onClick={onDeleteSegment}
            className="px-2 py-1 rounded border border-red-600 bg-red-800/70 text-white text-[11px] font-semibold hover:bg-red-700"
          >
            Delete
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Start (s)</span>
          <input
            className="w-28 rounded bg-white text-black border border-white px-2 py-1 text-[12px]"
            value={segmentTimeDraft.start}
            onChange={(e) => setSegmentTimeDraft((prev) => ({ ...prev, start: e.target.value }))}
            onBlur={handleTimeBlur}
            onKeyDown={handleTimeKeyDown}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">End (s)</span>
          <input
            className="w-28 rounded bg-white text-black border border-white px-2 py-1 text-[12px]"
            value={segmentTimeDraft.end}
            onChange={(e) => setSegmentTimeDraft((prev) => ({ ...prev, end: e.target.value }))}
            onBlur={handleTimeBlur}
            onKeyDown={handleTimeKeyDown}
          />
        </label>
      </div>

      {typeof onVolumeChange === "function" && (
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-200">
          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Clip volume</span>
              <span className="text-slate-200 font-semibold">{displayClipVolume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={clipVolume ?? 1}
              onChange={(e) => onVolumeChange("clipVolume", parseFloat(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Music volume</span>
              <span className="text-slate-200 font-semibold">{displayMusicVolume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={musicVolume ?? 1}
              onChange={(e) => onVolumeChange("musicVolume", parseFloat(e.target.value))}
              className="w-full accent-amber-500"
            />
          </label>
        </div>
      )}

      {tagsOpen && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-200">
          {guidelineTagOptions.map((preset) => {
            const isActive = guidelineTags.includes(preset.value);
            return (
              <button
                key={preset.value}
                onClick={() => onGuidelineToggle(preset.value)}
                className={`px-2 py-1 rounded-full border font-semibold ${
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
      )}
    </div>
  );
};

const buildFormatFromPlan = (plan, videoUrl) => {
  if (!plan || !Array.isArray(plan.segments)) return null;
  const fps = Number(plan.fps) || Number(plan?.songFormat?.meta?.targetFps) || TARGET_FPS;
  const durationSeconds =
    Number(plan.totalFrames) && fps ? plan.totalFrames / fps : Number(plan?.songFormat?.meta?.durationSeconds) || 0;
  const segments = (plan.segments || []).map((seg, idx) => {
    const startSeconds = Number(seg.startSeconds) || Number(seg.start) || 0;
    const endSeconds = Number(seg.endSeconds) || Number(seg.end) || startSeconds;
    const startMs = Math.max(0, Math.round(startSeconds * 1000));
    const endMs = Math.max(startMs, Math.round(endSeconds * 1000));
    return {
      id: String(seg.id || idx + 1),
      startMs,
      endMs,
      payload: {
        type: seg.type || "beat",
        clipSlot: seg.beatMetadata?.clipSlot || null,
        rapidClipSlot: seg.rapidClipSlot || null,
        rapidRangeIndex: seg.rapidRangeIndex ?? null,
        guidelineTags: seg.beatMetadata?.guidelineTags || [],
        intent: seg.beatMetadata?.intent || null,
        asset: seg.asset || null,
      },
    };
  });
  const frameSegments = segments.map((seg, idx) => {
    const startSeconds = seg.startMs / 1000;
    const endSeconds = seg.endMs / 1000;
    const startFrame = secondsToFrame(startSeconds, fps);
    const endFrame = secondsToFrame(endSeconds, fps);
    return {
      id: String(seg.id || idx + 1),
      startFrame,
      endFrame,
      frameCount: Math.max(0, endFrame - startFrame),
      startMs: seg.startMs,
      endMs: seg.endMs,
      payload: { ...seg.payload },
    };
  });

  return {
    source: videoUrl,
    meta: {
      durationSeconds,
      targetFps: fps,
      totalFrames: plan.totalFrames || null,
    },
    schemaVersion: 3,
    layers: [
      {
        id: "video",
        type: "base",
        name: "Video",
        order: 2,
        visible: true,
        locked: false,
        segments,
        frameSegments,
      },
      {
        id: "waveform",
        type: "waveform",
        name: "Waveform",
        order: 0,
        visible: true,
        locked: true,
        segments: [],
        frameSegments: [],
      },
    ],
    captions: null,
    captionVariants: {},
    activeCaptionVariant: "lyrics",
    captionPlacements: {},
    layeredCaptions: false,
    waveformActiveLayers: { base: true },
    waveformLayerStrengths: {},
    createdAt: plan.createdAt || null,
    updatedAt: plan.updatedAt || null,
  };
};

const FormatBuilderPage = ({ initialSongSlug = null, initialJobId = null } = {}) => {
  // Song and format state
  const [selectedSong, setSelectedSong] = useState(null);
  const [format, setFormat] = useState(null);
  const [formatExists, setFormatExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [importJobId, setImportJobId] = useState(initialJobId || null);
  const [importError, setImportError] = useState(null);
  const [importPlan, setImportPlan] = useState(null);
  const [importClipIndex, setImportClipIndex] = useState(0);
  const [importIsPlaying, setImportIsPlaying] = useState(false);
  const importVideoRef = useRef(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [rangeDeleteStart, setRangeDeleteStart] = useState(null);
  const [rangeDeleteEnd, setRangeDeleteEnd] = useState(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  // Audio state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);
  const segmentPreviewActiveRef = useRef(false);
  const segmentPreviewEndRef = useRef(null);
  const [isSegmentPreviewing, setIsSegmentPreviewing] = useState(false);
  
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
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [captionsSaving, setCaptionsSaving] = useState(false);
  const [captionsError, setCaptionsError] = useState(null);
  // Keep raw user-typed values so we don't fight cursor/formatting while typing.
  // We still update the underlying ms values when input is parseable.
  const [captionTimeDrafts, setCaptionTimeDrafts] = useState({});
  const [captionPreviewOpen, setCaptionPreviewOpen] = useState(false);
  const [captionEditScope, setCaptionEditScope] = useState("all");
  const [showLegacyCaptionEditor, setShowLegacyCaptionEditor] = useState(false);
  const [selectedCaptionLine, setSelectedCaptionLine] = useState(null);
  const [selectedCaptionWord, setSelectedCaptionWord] = useState(null);
  const [selectedCaptionKeys, setSelectedCaptionKeys] = useState([]);
  const [lastCaptionSelectionIndex, setLastCaptionSelectionIndex] = useState(null);
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
  const [activeLayer, setActiveLayer] = useState("background"); // base | cutout
  const [layeredCaptions, setLayeredCaptions] = useState(false);
  const [waveformModalOpen, setWaveformModalOpen] = useState(false);
  const [captionVariants, setCaptionVariants] = useState({ lyrics: null, clip: null });
  const [activeCaptionVariant, setActiveCaptionVariant] = useState("lyrics");
  const [captionPlacements, setCaptionPlacements] = useState({ lyrics: "top", clip: "layered" });
  const [layers, setLayers] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [layerInspectorOpen, setLayerInspectorOpen] = useState(false);
  const [captionsLayerRemoved, setCaptionsLayerRemoved] = useState(false);
  const [stills, setStills] = useState([]);
  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.id === selectedLayerId) || null,
    [layers, selectedLayerId]
  );
  const activeLayerLabel = useMemo(() => {
    if (selectedLayer) {
      const typeLabel =
        selectedLayer.type === LAYER_TYPES.CUTOUT
          ? "Cutout"
          : selectedLayer.type === LAYER_TYPES.BASE
          ? "Base"
          : selectedLayer.type === LAYER_TYPES.CAPTIONS
          ? "Captions"
          : selectedLayer.type === LAYER_TYPES.STILLS
          ? "Stills"
          : selectedLayer.type || "Layer";
      return `${selectedLayer.name || selectedLayer.label || typeLabel} • ${typeLabel}`;
    }
    if (activeLayer === "foreground") return "Cutout layer";
    if (activeLayer === "background") return "Base layer";
    if (String(activeLayer).startsWith("caps")) return "Captions layer";
    if (activeLayer === "stills") return "Stills layer";
    return "Unknown layer";
  }, [activeLayer, selectedLayer]);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const selectedSegmentIndex = selectedSegment?.index ?? null;
  const selectedSegmentLane = selectedSegment?.lane ?? activeLayer;
  const [segmentTimeDraft, setSegmentTimeDraft] = useState({ start: "", end: "" });
  const [segmentTimeAdjustAdjacent, setSegmentTimeAdjustAdjacent] = useState(true);
  const [segmentTimeError, setSegmentTimeError] = useState(null);
  const [guidelineDropdownOpen, setGuidelineDropdownOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [waveformEnabled, setWaveformEnabled] = useState(true);

  useEffect(() => {
    setSegmentTimeAdjustAdjacent(true);
  }, [selectedSegmentIndex, selectedSegmentLane]);
  useEffect(() => {
    setGuidelineDropdownOpen(false);
  }, [selectedSegmentIndex, selectedSegmentLane]);
  const defaultWaveformActiveLayers = useMemo(
    () => ({
      volume: true,
      subBass: false,
      bass: false,
      lowMids: false,
      mids: false,
      highMids: false,
      treble: false,
      brilliance: false,
      spectralFlux: false,
      onsets: false,
    }),
    []
  );
  const defaultWaveformStrengths = useMemo(() => {
    const base = {};
    Object.keys(WAVEFORM_LAYERS).forEach((k) => {
      base[k] = 1;
    });
    return base;
  }, []);
  const [waveformActiveLayers, setWaveformActiveLayers] = useState(defaultWaveformActiveLayers);
  const [waveformLayerStrengths, setWaveformLayerStrengths] = useState(defaultWaveformStrengths);
  const rapidMatchTolerance = 1e-3;
  const [rapidModal, setRapidModal] = useState(null);

  const hydrateFromImport = useCallback(
    (data) => {
      if (!data?.videoUrl || !data?.plan) {
        setImportError("Import missing video or plan");
        setLoading(false);
        return;
      }
      const fmt = buildFormatFromPlan(data.plan, data.videoUrl);
      if (!fmt) {
        setImportError("Invalid import data");
        setLoading(false);
        return;
      }
      const normalizedLayers = normalizeLayersFromFormat(fmt);
      setImportPlan(data.plan || null);
      setSelectedSong({
        slug: data.jobId || "import",
        path: data.videoUrl,
        displayName: data.jobId || "Imported video",
        isImport: true,
      });
      setFormat(fmt);
      setFormatExists(true);
      setLayers(normalizedLayers);
      setSelectedLayerId(normalizedLayers[0]?.id || null);
      setCaptionsEnabled(false);
      setCaptionVariants({ lyrics: null, clip: null });
      setActiveCaptionVariant("lyrics");
      setCaptionPlacements({ lyrics: "top", clip: "layered" });
      setLayeredCaptions(false);
      setOverlayVisibility((prev) => ({ ...prev, lyrics: false, wordLyrics: false }));
      setWaveformActiveLayers(fmt.waveformActiveLayers || defaultWaveformActiveLayers);
      setWaveformLayerStrengths(fmt.waveformLayerStrengths || defaultWaveformStrengths);
      setStills([]);
      setWaveformData(null);
      setWaveformSaved(false);
      setHasWaveformBackup(false);
      setWaveformLoading(false);
      setImportError(null);
      setError(null);
      setHasUnsavedChanges(false);
      setDuration(fmt.meta?.durationSeconds || 0);
      setLoading(false);
    },
    [defaultWaveformActiveLayers, defaultWaveformStrengths, normalizeLayersFromFormat]
  );

  // Undo/redo stacks
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const isApplyingUndoRef = useRef(false);
  const lastSnapshotRef = useRef({
    format: null,
    layers: null,
    waveformActiveLayers: null,
    waveformLayerStrengths: null,
  });

  const fps = useMemo(() => {
    return format?.meta?.targetFps || TARGET_FPS;
  }, [format?.meta?.targetFps]);

  const minRapidInterval = useMemo(() => 1 / (fps || TARGET_FPS), [fps]);
  const defaultRapidInterval = useMemo(() => Math.max(0.1, minRapidInterval), [minRapidInterval]);
  const isImportMode = Boolean(importJobId && selectedSong?.isImport);
  const clipMapImport = useMemo(
    () => (importPlan ? fromQuickEdit3Plan(importPlan) : null),
    [importPlan]
  );
  const clipTimelineSegments = useMemo(() => {
    if (!clipMapImport?.slots?.length) return [];
    let cursor = 0;
    return clipMapImport.slots.map((slot, idx) => {
      const clip = slot.assignedClip || slot.upstream?.asset || null;
      const duration =
        typeof slot.targetDuration === "number" && slot.targetDuration > 0
          ? slot.targetDuration
          : clip && typeof clip.start === "number" && typeof clip.end === "number"
          ? Math.max(0, clip.end - clip.start)
          : 1;
      const start = typeof slot.songTime === "number" ? slot.songTime : cursor;
      const end = start + duration;
      cursor = end;

      let mp4Url = null;
      if (clip?.localPath) {
        mp4Url = clip.localPath;
      } else if (clip?.cloudinaryId && typeof clip.start === "number" && typeof clip.end === "number") {
        try {
          const { url } = getOptimalClipUrl(clip.cloudinaryId, clip.start, clip.end, { fps: clipMapImport.fps || 30 });
          mp4Url = url;
        } catch (err) {
          mp4Url = null;
        }
      }

      return {
        id: slot.id,
        order: slot.order,
        start,
        end,
        duration,
        slot,
        clip,
        mp4Url,
        type: "clip",
        label: `Clip ${idx + 1}`,
      };
    });
  }, [clipMapImport]);

  const songDuration = useMemo(() => {
    if (isImportMode && clipTimelineSegments.length) {
      return clipTimelineSegments[clipTimelineSegments.length - 1].end;
    }
    if (format?.meta?.durationSeconds) {
      return format.meta.durationSeconds;
    }
    return duration || 0;
  }, [format?.meta?.durationSeconds, duration, isImportMode, clipTimelineSegments]);

  useEffect(() => {
    if (!importJobId) return;
    let cancelled = false;
    const loadImport = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/editor-imports/${importJobId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load import");
        }
        const data = await res.json();
        if (cancelled) return;
        hydrateFromImport(data);
      } catch (err) {
        if (cancelled) return;
        setImportError(err.message || "Failed to load import");
        setLoading(false);
      }
    };
    loadImport();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromImport, importJobId]);

  // Auto-fit timeline width on load/format change
  useEffect(() => {
    if (!duration) return;
    const PX_PER_SECOND = 80;
    const containerWidth =
      typeof window !== "undefined" ? Math.max(600, window.innerWidth - 120) : 1200;
    const fitZoom = Math.max(0.5, Math.min(8, containerWidth / (duration * PX_PER_SECOND)));
    setTimelineZoom(fitZoom);
  }, [duration]);

  const cutoutEnabled = useMemo(() => {
    const hasCutoutLayer = layers.some((l) => l.type === LAYER_TYPES.CUTOUT);
    if (layers.length) return hasCutoutLayer;
    return Boolean(format?.cutoutEnabled);
  }, [layers, format?.cutoutEnabled]);
  const hasCaptionsLayer = useMemo(
    () => layers.some((l) => l.type === LAYER_TYPES.CAPTIONS),
    [layers]
  );

  useEffect(() => {
    if (hasCaptionsLayer && captionsLayerRemoved) {
      setCaptionsLayerRemoved(false);
    }
  }, [hasCaptionsLayer, captionsLayerRemoved]);

  const foregroundDefaults = useMemo(
    () => ({
      beatGrid: [],
      beatGridFrames: [],
      beatGridFramePairs: [],
      beatMetadata: [],
      rapidClipRanges: [],
      rapidClipFrames: [],
      clipSegments: [],
      segments: [],
      frameSegments: [],
    }),
    []
  );

  const hydrateForeground = useCallback(
    (fg = {}) => ({
      ...foregroundDefaults,
      ...fg,
      beatGrid: [],
      beatGridFrames: [],
      beatGridFramePairs: [],
      beatMetadata: [],
      rapidClipRanges: [],
      rapidClipFrames: [],
      clipSegments: [],
      segments: Array.isArray(fg.segments) ? fg.segments : [],
      frameSegments: Array.isArray(fg.frameSegments) ? fg.frameSegments : [],
    }),
    [foregroundDefaults]
  );

  const foregroundLayer = useMemo(() => {
    if (!format?.foreground) return foregroundDefaults;
    return hydrateForeground(format.foreground);
  }, [format?.foreground, foregroundDefaults, hydrateForeground]);

  const isForegroundLayer = cutoutEnabled && activeLayer === "foreground";

  // Track changes for undo/redo (skip while applying undo/redo)
  useEffect(() => {
    if (isApplyingUndoRef.current) {
      isApplyingUndoRef.current = false;
      lastSnapshotRef.current = { format, layers, waveformActiveLayers, waveformLayerStrengths };
      return;
    }
    const prev = lastSnapshotRef.current;
    if (prev.format || prev.layers || prev.waveformActiveLayers || prev.waveformLayerStrengths) {
      undoStackRef.current.push(prev);
      redoStackRef.current = [];
    }
    lastSnapshotRef.current = { format, layers, waveformActiveLayers, waveformLayerStrengths };
  }, [format, layers, waveformActiveLayers, waveformLayerStrengths]);

  const layerBeatMetadata = isForegroundLayer
    ? foregroundLayer.beatMetadata || []
    : format?.beatMetadata || [];

  const layerRapidClipRanges = isForegroundLayer
    ? foregroundLayer.rapidClipRanges || []
    : format?.rapidClipRanges || [];

  useEffect(() => {
    if (!cutoutEnabled && activeLayer === "foreground") {
      setActiveLayer("background");
    }
  }, [cutoutEnabled, activeLayer]);

  // Keep derived layer flags in sync with format + overlays
  useEffect(() => {
    setFormat((prev) => (prev ? { ...prev, cutoutEnabled } : prev));
  }, [cutoutEnabled]);

  useEffect(() => {
    const nextCaptionsEnabled = hasCaptionsLayer;
    setCaptionsEnabled((prev) => (prev === nextCaptionsEnabled ? prev : nextCaptionsEnabled));
    setOverlayVisibility((prev) => {
      const nextLyricsVisible = nextCaptionsEnabled && Boolean(format?.captions);
      const nextWordsVisible = nextCaptionsEnabled && Boolean(format?.captions);
      if (prev.lyrics === nextLyricsVisible && prev.wordLyrics === nextWordsVisible) return prev;
      return {
        ...prev,
        lyrics: nextLyricsVisible,
        wordLyrics: nextWordsVisible,
      };
    });
  }, [hasCaptionsLayer, format?.captions]);

  useEffect(() => {
    const anyLayeredPlacement = Object.values(captionPlacements || {}).includes("layered");
    const nextLayered =
      cutoutEnabled && hasCaptionsLayer && anyLayeredPlacement;
    setLayeredCaptions((prev) => (prev === nextLayered ? prev : nextLayered));
  }, [captionPlacements, cutoutEnabled, hasCaptionsLayer]);

  const handleLayerSwitch = useCallback(
    (layer) => {
      if (layer === "foreground" && !cutoutEnabled) {
        return;
      }
      setActiveLayer(layer);
    },
    [cutoutEnabled]
  );

  const handleSelectLayer = useCallback(
    (lane) => {
      if (!lane) return;
      setSelectedLayerId(lane.id || null);
      setLayerInspectorOpen(true);
      setSelectedSegment(null);
      setSelectedCaptionLine(null);
      setSelectedCaptionWord(null);
      setSelectedCaptionKeys([]);
      if (lane.type === LAYER_TYPES.CUTOUT) {
        setActiveLayer("foreground");
      } else if (lane.type === LAYER_TYPES.BASE) {
        setActiveLayer("background");
      } else if (lane.type === LAYER_TYPES.CAPTIONS) {
        setActiveLayer("caps-top");
      } else if (lane.type === LAYER_TYPES.STILLS) {
        setActiveLayer("stills");
      }
    },
    []
  );

  const handleDeleteLayer = useCallback(
    (layerId) => {
      if (!layerId) return;
      setLayers((prev) => prev.filter((l) => l.id !== layerId));
      setSelectedLayerId((prev) => (prev === layerId ? null : prev));
      setSelectedSegment(null);
      setSelectedCaptionLine(null);
      setSelectedCaptionWord(null);
      setSelectedCaptionKeys([]);
      setActiveLayer("background");
      const deletedLayer = layers.find((l) => l.id === layerId);
      if (deletedLayer?.type === LAYER_TYPES.CAPTIONS) {
        setCaptionsLayerRemoved(true);
      }
      setHasUnsavedChanges(true);
    },
    [layers]
  );

  const handleSelectSegment = useCallback(
    (segment) => {
      if (!segment) {
        setSelectedSegment(null);
        return;
      }
      if (isImportMode && segment?.payload?.payload?.slot) {
        const slot = segment.payload.payload.slot;
        const idx = clipTimelineSegments.findIndex((s) => s.id === slot.id);
        if (idx >= 0) {
          setImportClipIndex(idx);
          setCurrentTime(segment.start);
        }
        setSelectedSegment(segment);
        return;
      }
      setLayerInspectorOpen(false);
      setSelectedLayerId(null);
      const normalizedLane =
        segment.lane === "fg"
          ? "foreground"
          : segment.lane === "bg"
          ? "background"
          : segment.lane;
      const layerIdForLane = (() => {
        if (normalizedLane === "foreground") {
          return layers.find((l) => l.type === LAYER_TYPES.CUTOUT)?.id || null;
        }
        if (normalizedLane === "background") {
          return layers.find((l) => l.type === LAYER_TYPES.BASE)?.id || null;
        }
        if (String(normalizedLane).startsWith("caps")) {
          return layers.find((l) => l.type === LAYER_TYPES.CAPTIONS)?.id || null;
        }
        if (normalizedLane === "stills") {
          return layers.find((l) => l.type === LAYER_TYPES.STILLS)?.id || null;
        }
        return null;
      })();
      if (layerIdForLane) {
        segment = { ...segment, laneId: layerIdForLane };
      }
      if (String(normalizedLane).startsWith("caps")) {
        setSelectedCaptionLine(segment.index ?? null);
        setSelectedCaptionWord(null);
        setSelectedCaptionKeys(segment.index !== undefined ? [`line-${segment.index}`] : []);
        setSelectedSegment({ ...segment, lane: normalizedLane });
        return;
      }
      if (normalizedLane === "stills") {
        setSelectedSegment({ ...segment, lane: normalizedLane });
        return;
      }
      setSelectedSegment({ ...segment, lane: normalizedLane });
      if (normalizedLane === "foreground" && cutoutEnabled) {
        setActiveLayer("foreground");
      } else if (normalizedLane === "background") {
        setActiveLayer("background");
      }
    },
    [clipTimelineSegments, cutoutEnabled, isImportMode, layers]
  );

  const toFrameSegments = useCallback(
    (segments) => {
      const fps = format?.meta?.targetFps || TARGET_FPS;
      return (segments || []).map((seg, idx) => {
        const startSeconds = (Number(seg.startMs) || 0) / 1000;
        const endSeconds = (Number(seg.endMs) || Number(seg.startMs) || 0) / 1000;
        const startFrame = secondsToFrame(startSeconds, fps);
        const endFrame = secondsToFrame(endSeconds, fps);
        return {
          ...seg,
          index: idx + 1,
          startSeconds,
          endSeconds,
          durationSeconds: Math.max(0, endSeconds - startSeconds),
          startFrame,
          endFrame,
          frameCount: Math.max(0, endFrame - startFrame),
        };
      });
    },
    [format?.meta?.targetFps]
  );

  const captionSegmentsToCaptions = useCallback(
    (segments = []) => {
      const lines = (segments || []).map((seg) => ({
        text: seg.payload?.text || "",
        captionMode: seg.payload?.captionMode || "preset",
        startMs: Math.round(seg.startMs || 0),
        endMs: Math.round(seg.endMs || seg.startMs || 0),
        originalText: seg.payload?.originalText || seg.payload?.text || "",
        layer: seg.payload?.layer || null,
      }));
      return {
        provider: "manual",
        status: "draft",
        lines,
        style: ensureCaptionStyle(format?.captions?.style),
        displayRanges: [],
      };
    },
    [format?.captions?.style]
  );

  const applyLayerPayloadPatch = useCallback(
    (layerId, patch) => {
      if (!layerId) return;
      let nextSegmentsCache = null;
      let targetType = null;
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.id !== layerId) return layer;
          targetType = layer.type;
          const segs = Array.isArray(layer.segments) ? [...layer.segments] : [];
          const nextSegs = segs.map((seg) => ({
            ...seg,
            payload:
              typeof patch === "function"
                ? patch(seg.payload || {}, seg)
                : { ...(seg.payload || {}), ...(patch || {}) },
          }));
          nextSegmentsCache = nextSegs;
          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        })
      );
      if (targetType === LAYER_TYPES.CAPTIONS && nextSegmentsCache) {
        const nextCaptions = captionSegmentsToCaptions(nextSegmentsCache);
        setFormat((prev) =>
          prev
            ? {
                ...prev,
                captions: nextCaptions,
                captionVariants: {
                  ...(prev.captionVariants || {}),
                  [activeCaptionVariant]: nextCaptions,
                },
              }
            : prev
        );
        setCaptionVariants((prev) => ({
          ...prev,
          [activeCaptionVariant]: nextCaptions,
        }));
      }
      setHasUnsavedChanges(true);
    },
    [activeCaptionVariant, captionSegmentsToCaptions, setFormat, toFrameSegments]
  );

  const createFullLengthSegment = useCallback(
    (layerId, layerType) => {
      const effectiveDurationSeconds = Math.max(
        format?.meta?.durationSeconds || 0,
        songDuration || 0,
        duration || 0
      );
      const durationMs = Math.max(1000, Math.round(effectiveDurationSeconds * 1000) || 0);
      const basePayload =
        layerType === LAYER_TYPES.CAPTIONS
          ? { captionMode: "preset", text: "" }
          : {};
      return [
        {
          id: `${layerId}-seg-1`,
          startMs: 0,
          endMs: durationMs,
          payload: basePayload,
        },
      ];
    },
    [duration, format?.meta?.durationSeconds, songDuration]
  );

  const handleSelectLayerSegmentFromGlobal = useCallback(
    (layer, segment, idx) => {
      if (!layer) return;
      const lane =
        layer.type === LAYER_TYPES.CUTOUT
          ? "foreground"
          : layer.type === LAYER_TYPES.BASE
          ? "background"
          : layer.type === LAYER_TYPES.CAPTIONS
          ? "caps-top"
          : layer.type === LAYER_TYPES.STILLS
          ? "stills"
          : null;
      if (!lane) return;
      handleSelectSegment({
        id: segment?.id || idx,
        index: segment?.index ?? idx,
        lane,
        laneId: layer.id,
        type: segment?.type,
      });
    },
    [handleSelectSegment]
  );

  const handleApplySelectedSegmentToLayer = useCallback(() => {
    if (!selectedLayer) return;
    const segs = Array.isArray(selectedLayer.segments) ? selectedLayer.segments : [];
    if (!segs.length) return;
    const matchIdx = (() => {
      if (selectedSegment?.id) {
        const found = segs.findIndex(
          (s, idx) => s.id === selectedSegment.id || String(s.id) === String(selectedSegment.id)
        );
        if (found >= 0) return found;
      }
      if (Number.isInteger(selectedSegment?.index) && selectedSegment.index >= 0 && selectedSegment.index < segs.length) {
        return selectedSegment.index;
      }
      if (
        Number.isInteger(selectedSegment?.index) &&
        selectedSegment.index - 1 >= 0 &&
        selectedSegment.index - 1 < segs.length
      ) {
        return selectedSegment.index - 1;
      }
      return 0;
    })();
    const template = segs[matchIdx] || segs[0];
    const templatePayload = template?.payload || {};
    applyLayerPayloadPatch(selectedLayer.id, templatePayload);
  }, [applyLayerPayloadPatch, selectedLayer, selectedSegment]);

  const handleAddFullSegmentForLayer = useCallback(
    (layerId, layerType) => {
      if (!layerId) return;
      const freshSegs = createFullLengthSegment(layerId, layerType);
      setLayers((prev) =>
        prev.map((layer) =>
          layer.id === layerId
            ? { ...layer, segments: freshSegs, frameSegments: toFrameSegments(freshSegs) }
            : layer
        )
      );
      if (layerType === LAYER_TYPES.CAPTIONS) {
        const nextCaptions = captionSegmentsToCaptions(freshSegs);
        setFormat((prev) =>
          prev
            ? {
                ...prev,
                captions: nextCaptions,
                captionVariants: { ...(prev.captionVariants || {}), [activeCaptionVariant]: nextCaptions },
              }
            : prev
        );
        setCaptionVariants((prev) => ({
          ...prev,
          [activeCaptionVariant]: nextCaptions,
        }));
      }
      setHasUnsavedChanges(true);
    },
    [activeCaptionVariant, captionSegmentsToCaptions, createFullLengthSegment, setFormat, toFrameSegments]
  );

  // Keep layer selection in sync with selected segment (including external selects)
  useEffect(() => {
    if (!selectedSegment) return;
    const lane =
      selectedSegment.lane === "fg"
        ? "foreground"
        : selectedSegment.lane === "bg"
        ? "background"
        : selectedSegment.lane;
    if (lane === "foreground" && cutoutEnabled) {
      setActiveLayer("foreground");
    } else if (lane === "background") {
      setActiveLayer("background");
    }
  }, [selectedSegment, cutoutEnabled]);

  const captionsToCaptionSegments = useCallback(
    (captions, defaultDurationMs = 0) => {
      const lines = Array.isArray(captions?.lines) ? captions.lines : [];
      if (!lines.length && defaultDurationMs > 0) {
        return [
          {
            id: "cap-1",
            startMs: 0,
            endMs: defaultDurationMs,
            payload: { captionMode: "preset", text: "" },
          },
        ];
      }
      return lines
        .map((line, idx) => ({
          id: line.id || `cap-${idx + 1}`,
          startMs: Math.max(0, Math.round(line.startMs || 0)),
          endMs: Math.max(Math.round(line.endMs || line.startMs || 0), Math.round(line.startMs || 0)),
          payload: {
            captionMode: line.captionMode || "preset",
            text: line.text || "",
            originalText: line.originalText || line.text || "",
            layer: line.layer || null,
          },
        }))
        .filter((seg) => seg.endMs > seg.startMs);
    },
    []
  );

  const ensureCaptionsLayer = useCallback(
    (incomingLayers, segments = []) => {
      if (captionsLayerRemoved) return incomingLayers;
      const hasCaptions = incomingLayers.some((l) => l.type === LAYER_TYPES.CAPTIONS);
      if (hasCaptions) return incomingLayers;
      return [
        ...incomingLayers,
        {
          id: "captions",
          type: LAYER_TYPES.CAPTIONS,
          name: "Captions",
          order: incomingLayers.length ? incomingLayers[0].order + 1 : 1,
          visible: true,
          locked: false,
          segments,
          frameSegments: toFrameSegments(segments),
        },
      ];
    },
    [captionsLayerRemoved, toFrameSegments]
  );

  const updateCaptionLayer = useCallback(
    (mutator) => {
      let nextSegmentsCache = null;
      setLayers((prev) => {
        const next = prev.map((layer) => {
          if (layer.type !== LAYER_TYPES.CAPTIONS) return layer;
          const segs = Array.isArray(layer.segments) ? [...layer.segments] : [];
          const nextSegs = mutator(segs);
          nextSegmentsCache = nextSegs;
          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        });
        return ensureCaptionsLayer(next, []);
      });
      setFormat((prev) => {
        if (!prev) return prev;
        const captionsLayer = layers.find((l) => l.type === LAYER_TYPES.CAPTIONS);
        const segs =
          nextSegmentsCache ||
          mutator(captionsLayer?.segments || []);
        return {
          ...prev,
          captions: captionSegmentsToCaptions(segs),
          captionVariants: {
            ...(prev.captionVariants || {}),
            [activeCaptionVariant]: captionSegmentsToCaptions(segs),
          },
        };
      });
      if (nextSegmentsCache) {
        setCaptionVariants((prev) => ({
          ...prev,
          [activeCaptionVariant]: captionSegmentsToCaptions(nextSegmentsCache),
        }));
      }
      setHasUnsavedChanges(true);
    },
    [activeCaptionVariant, captionSegmentsToCaptions, ensureCaptionsLayer, layers, setFormat, toFrameSegments]
  );

  const updateSegmentPayload = useCallback(
    (layerType, segmentIndex, mutator) => {
      if (!layerType || segmentIndex === null || segmentIndex === undefined) return;
      let nextSegmentsCache = null;
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.type !== layerType) return layer;
          const segs = Array.isArray(layer.segments) ? [...layer.segments] : [];
          if (!segs[segmentIndex]) return layer;
          const nextSegs = [...segs];
          const prevSeg = segs[segmentIndex];
          const nextPayload =
            typeof mutator === "function"
              ? mutator(prevSeg.payload || {}, prevSeg, segmentIndex)
              : prevSeg.payload || {};
          nextSegs[segmentIndex] = { ...prevSeg, payload: nextPayload };
          nextSegmentsCache = nextSegs;
          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        })
      );
      if (layerType === LAYER_TYPES.CAPTIONS && nextSegmentsCache) {
        setFormat((prev) =>
          prev
            ? {
                ...prev,
                captions: captionSegmentsToCaptions(nextSegmentsCache),
                captionVariants: {
                  ...(prev.captionVariants || {}),
                  [activeCaptionVariant]: captionSegmentsToCaptions(nextSegmentsCache),
                },
              }
            : prev
        );
        setCaptionVariants((prev) => ({
          ...prev,
          [activeCaptionVariant]: captionSegmentsToCaptions(nextSegmentsCache),
        }));
      }
      setHasUnsavedChanges(true);
    },
    [activeCaptionVariant, captionSegmentsToCaptions, toFrameSegments]
  );

  const splitSegmentAt = useCallback(
    (timeSeconds, lane = activeLayer) => {
      const targetType =
        lane === "foreground"
          ? LAYER_TYPES.CUTOUT
          : lane === "background"
          ? LAYER_TYPES.BASE
          : lane === "stills"
          ? LAYER_TYPES.STILLS
          : String(lane).startsWith("caps")
          ? LAYER_TYPES.CAPTIONS
          : null;
      if (!targetType || !Number.isFinite(timeSeconds)) return;
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.type !== targetType) return layer;
          const segs = Array.isArray(layer.segments) ? [...layer.segments] : [];
          const targetIndex = segs.findIndex((seg) => {
            const s = (Number(seg.startMs) || 0) / 1000;
            const e = (Number(seg.endMs) || Number(seg.startMs) || 0) / 1000;
            return timeSeconds > s + 1e-6 && timeSeconds < e - 1e-6;
          });
          if (targetIndex === -1) return layer;
          const seg = segs[targetIndex];
          const startMs = Number(seg.startMs) || 0;
          const endMs = Number(seg.endMs) || startMs;
          const splitMs = Math.round(timeSeconds * 1000);
          if (splitMs <= startMs || splitMs >= endMs) return layer;
          const first = { ...seg, endMs: splitMs };
          const second = {
            ...seg,
            startMs: splitMs,
            id: seg.id ? `${seg.id}-b` : `seg-${targetIndex + 2}`,
          };
          const nextSegs = [...segs.slice(0, targetIndex), first, second, ...segs.slice(targetIndex + 1)];
          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        })
      );
      setHasUnsavedChanges(true);
    },
    [activeLayer, toFrameSegments]
  );

  const adjustRapidRangesDuration = useCallback(
    (ranges = [], durationSec) => {
      return (ranges || []).map((r) => {
        const start = Math.max(0, Math.min(r.start ?? 0, durationSec));
        const end = Math.max(start + MIN_SEGMENT_DURATION, Math.min(r.end ?? start, durationSec));
        return { ...r, start, end };
      });
    },
    []
  );

  const updateRapidRangesForLayer = useCallback(
    (layer, mutator) => {
      setFormat((prev) => {
        if (!prev) return prev;
        const durationSec = prev.meta?.durationSeconds ?? songDuration ?? 0;
        const targetFps = prev.meta?.targetFps || fps || TARGET_FPS;
        if (layer === "foreground") {
          const fg = prev.foreground || {};
          const current = Array.isArray(fg.rapidClipRanges) ? fg.rapidClipRanges : [];
          const nextRanges = adjustRapidRangesDuration(mutator(current), durationSec);
          return {
            ...prev,
            cutoutEnabled: true,
            foreground: {
              ...fg,
              rapidClipRanges: nextRanges,
              rapidClipFrames: rapidRangesToFrames(nextRanges, targetFps),
            },
          };
        }
        const current = Array.isArray(prev.rapidClipRanges) ? prev.rapidClipRanges : [];
        const nextRanges = adjustRapidRangesDuration(mutator(current), durationSec);
        return {
          ...prev,
          rapidClipRanges: nextRanges,
          rapidClipFrames: rapidRangesToFrames(nextRanges, targetFps),
        };
      });
      setHasUnsavedChanges(true);
    },
    [adjustRapidRangesDuration, fps, songDuration]
  );

  const handleClipPairFieldChange = useCallback(() => {}, []);

  const getSegmentBounds = useCallback(
    (segmentIdx, laneOverride = null) => {
      const lane = laneOverride || activeLayer;
      const targetType = (() => {
        if (lane === "foreground") return LAYER_TYPES.CUTOUT;
        if (lane === "background") return LAYER_TYPES.BASE;
        if (String(lane).startsWith("caps")) return LAYER_TYPES.CAPTIONS;
        if (lane === "stills") return LAYER_TYPES.STILLS;
        return null;
      })();
      const layer = layers.find((l) => l.type === targetType);
      const seg = layer?.segments?.[segmentIdx];
      const startMs = Number(seg?.startMs) || 0;
      const endMs = Number(seg?.endMs) || startMs;
      return {
        start: startMs / 1000,
        end: endMs / 1000,
      };
    },
    [activeLayer, layers]
  );

  const updateSegmentTimes = useCallback(
    (segmentIdx, lane, newStart, newEnd, adjustAdjacent = true) => {
      const durationSec = songDuration || 0;
      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
        return "Start and End must be numbers.";
      }
      if (newStart < 0 || newEnd > durationSec) {
        return `Timestamps must be within 0s-${formatSecondsLabel(durationSec)}s.`;
      }
      if (newEnd - newStart < MIN_SEGMENT_DURATION) {
        return `Segment must be at least ${MIN_SEGMENT_DURATION.toFixed(1)}s long.`;
      }

      const targetType =
        lane === "foreground"
          ? LAYER_TYPES.CUTOUT
          : lane === "background"
          ? LAYER_TYPES.BASE
          : lane === "stills"
          ? LAYER_TYPES.STILLS
          : String(lane).startsWith("caps")
          ? LAYER_TYPES.CAPTIONS
          : null;
      if (!targetType) return "Unknown lane.";

      let error = null;
      let updatedCaptionSegments = null;
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.type !== targetType) return layer;
          const segs = Array.isArray(layer.segments) ? [...layer.segments] : [];
          if (!segs[segmentIdx]) {
            error = "Segment not found.";
            return layer;
          }
          const nextSegs = [...segs];
          nextSegs[segmentIdx] = {
            ...segs[segmentIdx],
            startMs: Math.round(newStart * 1000),
            endMs: Math.round(newEnd * 1000),
          };
          if (adjustAdjacent) {
            if (segmentIdx > 0) {
              const prevSeg = nextSegs[segmentIdx - 1];
              nextSegs[segmentIdx - 1] = {
                ...prevSeg,
                endMs: Math.round(newStart * 1000),
              };
            }
            if (segmentIdx < nextSegs.length - 1) {
              const nxtSeg = nextSegs[segmentIdx + 1];
              nextSegs[segmentIdx + 1] = {
                ...nxtSeg,
                startMs: Math.round(newEnd * 1000),
              };
            }
          }
          // Validate ordering and minimum durations
          const sorted = [...nextSegs].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
          const isSameOrder = sorted.every((s, i) => s === nextSegs[i]);
          if (!isSameOrder) {
            error = "Segment boundaries would overlap; choose different times.";
            return layer;
          }
          for (let i = 0; i < nextSegs.length; i += 1) {
            const s = nextSegs[i];
            if ((s.endMs || 0) - (s.startMs || 0) < MIN_SEGMENT_DURATION * 1000 - 1) {
              error = `Segment ${i + 1} would be shorter than ${MIN_SEGMENT_DURATION.toFixed(1)}s.`;
              return layer;
            }
            if (s.endMs > durationSec * 1000 + 1e-3) {
              error = "Segment exceeds duration.";
              return layer;
            }
          }

          if (targetType === LAYER_TYPES.CAPTIONS) {
            updatedCaptionSegments = nextSegs;
          }

          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        })
      );

      if (error) return error;
      if (targetType === LAYER_TYPES.CAPTIONS && updatedCaptionSegments) {
        setFormat((prev) =>
          prev
            ? {
                ...prev,
                captions: captionSegmentsToCaptions(updatedCaptionSegments),
                captionVariants: {
                  ...(prev.captionVariants || {}),
                  [activeCaptionVariant]: captionSegmentsToCaptions(updatedCaptionSegments),
                },
              }
            : prev
        );
        setCaptionVariants((prev) => ({
          ...prev,
          [activeCaptionVariant]: captionSegmentsToCaptions(updatedCaptionSegments),
        }));
      }
      setHasUnsavedChanges(true);
      return null;
    },
    [activeCaptionVariant, captionSegmentsToCaptions, songDuration, toFrameSegments]
  );

  const overlapsSegment = useCallback(
    (range, start, end) =>
      Number.isFinite(range?.start) &&
      Number.isFinite(range?.end) &&
      range.start <= end + rapidMatchTolerance &&
      range.end >= start - rapidMatchTolerance,
    [rapidMatchTolerance]
  );

  const findRapidForSegment = useCallback(
    (layer, segmentIdx) => {
      const { start, end } = getSegmentBounds(segmentIdx, layer);
      const isForeground = layer === "foreground";
      const ranges = isForeground ? foregroundLayer?.rapidClipRanges || [] : format?.rapidClipRanges || [];
      let best = null;
      let bestOverlap = -Infinity;
      ranges.forEach((r) => {
        if (!overlapsSegment(r, start, end)) return;
        const overlapAmount = Math.min(r.end, end) - Math.max(r.start, start);
        if (overlapAmount > bestOverlap) {
          bestOverlap = overlapAmount;
          best = r;
        }
      });
      return { match: best, start, end };
    },
    [foregroundLayer, format?.rapidClipRanges, getSegmentBounds, overlapsSegment]
  );

  const handleSegmentRapidToggle = useCallback(
    (segmentIdx, enabled, laneOverride = null, intervalOverride = null) => {
      const lane = laneOverride || selectedSegmentLane || activeLayer;
      if (!["foreground", "background"].includes(lane)) return;
      const { start, end } = getSegmentBounds(segmentIdx, lane);
      const intervalValue = Math.max(
        minRapidInterval,
        intervalOverride ?? defaultRapidInterval
      );
      if (!enabled) {
        updateRapidRangesForLayer(lane, (current) =>
          (current || []).filter((r) => !overlapsSegment(r, start, end))
        );
        return;
      }
      updateRapidRangesForLayer(lane, (current) => {
        const next = Array.isArray(current) ? [...current] : [];
        const payload = { start, end, interval: intervalValue };
        const withoutOverlaps = next.filter((r) => !overlapsSegment(r, start, end));
        return [...withoutOverlaps, payload];
      });
    },
    [
      activeLayer,
      defaultRapidInterval,
      getSegmentBounds,
      minRapidInterval,
      overlapsSegment,
      selectedSegmentLane,
      updateRapidRangesForLayer,
    ]
  );

  const handleSegmentRapidFieldChange = useCallback(
    (segmentIdx, field, value, laneOverride = null) => {
      if (field !== "interval") return;
      const lane = laneOverride || selectedSegmentLane || activeLayer;
      if (!["foreground", "background"].includes(lane)) return;
      const { start, end } = getSegmentBounds(segmentIdx, lane);
      const numeric = Number(value);
      const intervalValue = Math.max(
        minRapidInterval,
        Number.isFinite(numeric) ? numeric : defaultRapidInterval
      );
      updateRapidRangesForLayer(lane, (current) => {
        const next = Array.isArray(current) ? [...current] : [];
        const updated = { start, end, interval: intervalValue };
        const withoutOverlaps = next.filter((r) => !overlapsSegment(r, start, end));
        return [...withoutOverlaps, updated];
      });
    },
    [
      activeLayer,
      defaultRapidInterval,
      getSegmentBounds,
      minRapidInterval,
      overlapsSegment,
      selectedSegmentLane,
      updateRapidRangesForLayer,
    ]
  );

  // Rapid range CRUD (non-segment-specific)
  const handleAddRapidRange = useCallback(
    (range, laneOverride = null) => {
      if (!range) return;
      const lane = laneOverride || selectedSegmentLane || activeLayer;
      if (!["foreground", "background"].includes(lane)) return;
      const payload = {
        start: Number(range.start) || 0,
        end: Number(range.end) || Number(range.start) || 0,
        interval: Math.max(
          minRapidInterval,
          Number.isFinite(range.interval) ? range.interval : defaultRapidInterval
        ),
      };
      updateRapidRangesForLayer(lane, (current) => [...(current || []), payload]);
    },
    [activeLayer, defaultRapidInterval, minRapidInterval, selectedSegmentLane, updateRapidRangesForLayer]
  );

  const handleRemoveRapidRange = useCallback(
    (index, laneOverride = null) => {
      const lane = laneOverride || selectedSegmentLane || activeLayer;
      if (!["foreground", "background"].includes(lane)) return;
      updateRapidRangesForLayer(lane, (current) =>
        (current || []).filter((_, i) => i !== index)
      );
    },
    [activeLayer, selectedSegmentLane, updateRapidRangesForLayer]
  );

  const handleUpdateRapidRange = useCallback(
    (index, updatedRange, laneOverride = null) => {
      const lane = laneOverride || selectedSegmentLane || activeLayer;
      if (!["foreground", "background"].includes(lane)) return;
      updateRapidRangesForLayer(lane, (current) => {
        const next = Array.isArray(current) ? [...current] : [];
        if (!next[index]) return next;
        next[index] = {
          ...next[index],
          ...updatedRange,
          interval: Math.max(
            minRapidInterval,
            Number.isFinite(updatedRange?.interval)
              ? updatedRange.interval
              : next[index].interval ?? defaultRapidInterval
          ),
        };
        return next;
      });
    },
    [activeLayer, defaultRapidInterval, minRapidInterval, selectedSegmentLane, updateRapidRangesForLayer]
  );

  const openRapidModalForSegment = useCallback(
    (segmentIdx, laneOverride = null, anchorRect = null) => {
      if (segmentIdx === null || segmentIdx === undefined) return;
      const lane = laneOverride || selectedSegmentLane || activeLayer;
      if (!["foreground", "background"].includes(lane)) return;
      const { match } = findRapidForSegment(lane, segmentIdx);
      const rect =
        anchorRect && typeof window !== "undefined"
          ? {
              top: anchorRect.top + window.scrollY,
              bottom: anchorRect.bottom + window.scrollY,
              left: anchorRect.left + window.scrollX,
              width: anchorRect.width,
            }
          : null;
      setRapidModal({
        segmentIdx,
        lane,
        interval: Math.max(match?.interval ?? defaultRapidInterval, minRapidInterval),
        hasExisting: Boolean(match),
        rect,
      });
    },
    [activeLayer, defaultRapidInterval, findRapidForSegment, minRapidInterval, selectedSegmentLane]
  );

  const closeRapidModal = useCallback(() => setRapidModal(null), []);

  const handleRapidModalSave = useCallback(() => {
    if (!rapidModal) return;
    const safeInterval = Number.isFinite(rapidModal.interval)
      ? rapidModal.interval
      : defaultRapidInterval;
    handleSegmentRapidFieldChange(
      rapidModal.segmentIdx,
      "interval",
      safeInterval,
      rapidModal.lane
    );
    setRapidModal(null);
  }, [defaultRapidInterval, handleSegmentRapidFieldChange, rapidModal]);

  const handleRapidModalDisable = useCallback(() => {
    if (!rapidModal) return;
    handleSegmentRapidToggle(rapidModal.segmentIdx, false, rapidModal.lane);
    setRapidModal(null);
  }, [handleSegmentRapidToggle, rapidModal]);

  const handleRapidModalIntervalChange = useCallback((val) => {
    setRapidModal((prev) =>
      prev ? { ...prev, interval: val } : prev
    );
  }, []);

  const rapidModalStyle = useMemo(() => {
    if (!rapidModal?.rect) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }
    return {
      top: rapidModal.rect.bottom + 8,
      left: rapidModal.rect.left + rapidModal.rect.width / 2,
      transform: "translateX(-50%)",
    };
  }, [rapidModal]);

  const rapidModalBounds = useMemo(() => {
    if (!rapidModal) return null;
    return getSegmentBounds(rapidModal.segmentIdx, rapidModal.lane);
  }, [getSegmentBounds, rapidModal]);

  const handlePlaySegment = useCallback(() => {
    if (selectedSegmentIndex === null || selectedSegmentIndex === undefined) return;
    if (!audioRef.current) return;
    // If already previewing this segment, pause
    if (segmentPreviewActiveRef.current) {
      audioRef.current.pause();
      segmentPreviewActiveRef.current = false;
      segmentPreviewEndRef.current = null;
      setIsSegmentPreviewing(false);
      setIsPlaying(false);
      return;
    }
    const { start, end } = getSegmentBounds(selectedSegmentIndex, selectedSegmentLane);
    // Snap to frame for maximal accuracy
    const frameStart = Math.max(0, Math.round(start * fps));
    const frameEnd = Math.max(frameStart + 1, Math.round(end * fps)); // ensure at least 1 frame
    const preciseStart = frameStart / fps;
    const preciseEnd = frameEnd / fps;
    segmentPreviewActiveRef.current = true;
    segmentPreviewEndRef.current = preciseEnd;
    audioRef.current.pause();
    audioRef.current.currentTime = preciseStart;
    audioRef.current
      .play()
      .then(() => {
        setIsPlaying(true);
        setCurrentTime(preciseStart);
        setIsSegmentPreviewing(true);
      })
      .catch(() => {
        segmentPreviewActiveRef.current = false;
        segmentPreviewEndRef.current = null;
        setIsSegmentPreviewing(false);
      });
  }, [getSegmentBounds, selectedSegmentIndex, selectedSegmentLane]);

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
      const layerType = activeLayer === "foreground" ? LAYER_TYPES.CUTOUT : LAYER_TYPES.BASE;
      updateSegmentPayload(layerType, index, (prev = {}) => {
        const next = { ...prev };
        if (patch.clipSlot) {
          next.clipSlot = { ...(prev.clipSlot || {}), ...patch.clipSlot };
          next.clipVolume = patch.clipSlot.clipVolume ?? next.clipVolume;
          next.musicVolume = patch.clipSlot.musicVolume ?? next.musicVolume;
          next.pauseMusic = patch.clipSlot.pauseMusic ?? next.pauseMusic;
          next.resumeMode = patch.clipSlot.resumeMode ?? next.resumeMode;
        }
        if (patch.guidelineTags) {
          next.guidelineTags = patch.guidelineTags;
        }
        return next;
      });
    },
    [activeLayer, updateSegmentPayload]
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
          resumeMode: pauseMusic ? "clip_end" : "segment",
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
      const layerType = activeLayer === "foreground" ? LAYER_TYPES.CUTOUT : LAYER_TYPES.BASE;
      updateSegmentPayload(layerType, index, (prev = {}) => {
        const tags = new Set(prev.guidelineTags || []);
        if (tags.has(tag)) {
          tags.delete(tag);
        } else {
          tags.add(tag);
        }
        return { ...prev, guidelineTags: Array.from(tags) };
      });
    },
    [activeLayer, updateSegmentPayload]
  );

  const handlePauseToggle = useCallback(
    (index, pauseMusic) => {
      handleBeatMetadataChange(index, {
        clipSlot: {
          pauseMusic,
          resumeMode: pauseMusic ? "clip_end" : "segment",
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

  const handleLayerGlobalVolumeChange = useCallback(
    (layerId, field, value) => {
      if (!layerId || !["clipVolume", "musicVolume"].includes(field)) return;
      const numericValue = Math.max(0, Math.min(1, Number(value)));
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.id !== layerId) return layer;
          const nextSegs = (layer.segments || []).map((seg) => ({
            ...seg,
            payload: {
              ...(seg.payload || {}),
              [field]: numericValue,
              clipSlot: {
                ...(seg.payload?.clipSlot || {}),
                [field]: numericValue,
              },
            },
          }));
          return { ...layer, segments: nextSegs, frameSegments: toFrameSegments(nextSegs) };
        })
      );
      setHasUnsavedChanges(true);
    },
    [toFrameSegments]
  );

  const applyGlobalVolumes = useCallback(
    ({ clipVolume, musicVolume }) => {
      setLayers((prev) =>
        prev.map((layer) => {
          if (![LAYER_TYPES.BASE, LAYER_TYPES.CUTOUT].includes(layer.type)) return layer;
          const nextSegs = (layer.segments || []).map((seg) => ({
            ...seg,
            payload: {
              ...(seg.payload || {}),
              clipVolume,
              musicVolume,
              clipSlot: {
                ...(seg.payload?.clipSlot || {}),
                clipVolume,
                musicVolume,
              },
            },
          }));
          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        })
      );
      setFormat((prev) =>
        prev
          ? {
              ...prev,
              introBeat: mergeIntroBeatState(prev.introBeat, {
                clipSlot: {
                  clipVolume,
                  musicVolume,
                },
              }),
            }
          : prev
      );
      setHasUnsavedChanges(true);
    },
    [mergeIntroBeatState, toFrameSegments]
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
      setWaveformActiveLayers(defaultWaveformActiveLayers);
      setWaveformLayerStrengths(defaultWaveformStrengths);
      setLayeredCaptions(false);
      setLayers([]);
      setSelectedLayerId(null);
      setStills([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/format-builder-v3/get?slug=${song.slug}`);
      if (!res.ok) throw new Error("Failed to load format");
      const data = await res.json();

      setFormatExists(data.exists);
      const captionsRemoved = Boolean(data.format?.captionsLayerRemoved);
      setCaptionsLayerRemoved(captionsRemoved);
      const normalizedLayers = normalizeLayersFromFormat(data.format || {});
      const normalizedCaptions = normalizeCaptions(data.format?.captions);
      const incomingCaptionVariants = data.format?.captionVariants || {};
      const clipCaptions = normalizeCaptions(incomingCaptionVariants.clip);
      const initialCaptionVariants = { lyrics: normalizedCaptions, clip: clipCaptions };
      const resolvedActiveVariant =
        data.format?.activeCaptionVariant === "clip" && clipCaptions ? "clip" : "lyrics";
      const activeCaptions =
        resolvedActiveVariant === "clip" && clipCaptions ? clipCaptions : normalizedCaptions;
      const incomingPlacements = data.format?.captionPlacements || {};
      const initialCaptionPlacements = {
        lyrics: incomingPlacements.lyrics || (data.format?.layeredCaptions ? "layered" : "top"),
        clip: incomingPlacements.clip || "layered",
      };
      const anyLayered =
        initialCaptionPlacements.lyrics === "layered" || initialCaptionPlacements.clip === "layered";

      const nextFormat = {
        ...data.format,
        source: song.path,
        beatGrid: [],
        beatGridFrames: [],
        beatGridFramePairs: [],
        beatMetadata: [],
        rapidClipRanges: Array.isArray(data.format?.rapidClipRanges)
          ? data.format.rapidClipRanges
          : [],
        rapidClipFrames: Array.isArray(data.format?.rapidClipFrames)
          ? data.format.rapidClipFrames
          : [],
        meta: {
          ...(data.format?.meta || {}),
          targetFps: data.format?.meta?.targetFps || TARGET_FPS,
        },
        layers: normalizedLayers,
        captions: activeCaptions,
        captionVariants: initialCaptionVariants,
        activeCaptionVariant: resolvedActiveVariant,
        captionPlacements: initialCaptionPlacements,
        layeredCaptions: anyLayered,
        schemaVersion: data.format?.schemaVersion || 3,
        waveformActiveLayers: data.format?.waveformActiveLayers || defaultWaveformActiveLayers,
        waveformLayerStrengths: data.format?.waveformLayerStrengths || defaultWaveformStrengths,
        stills: Array.isArray(data.format?.stills) ? data.format.stills : [],
        foreground: {
          ...(data.format?.foreground || {}),
          beatGrid: [],
          beatGridFrames: [],
          beatGridFramePairs: [],
          beatMetadata: [],
          rapidClipRanges: Array.isArray(data.format?.foreground?.rapidClipRanges)
            ? data.format.foreground.rapidClipRanges
            : [],
          rapidClipFrames: Array.isArray(data.format?.foreground?.rapidClipFrames)
            ? data.format.foreground.rapidClipFrames
            : [],
        },
      };

      const durationMs = Math.max(0, Math.round((nextFormat.meta?.durationSeconds || 0) * 1000));
      const existingCaptionLayer = normalizedLayers.find((l) => l.type === LAYER_TYPES.CAPTIONS);
      const captionSegs =
        existingCaptionLayer?.segments && existingCaptionLayer.segments.length
          ? existingCaptionLayer.segments
          : captionsToCaptionSegments(activeCaptions, durationMs);
      const hydratedCaptionVariants = {
        ...initialCaptionVariants,
        [resolvedActiveVariant]: captionSegmentsToCaptions(captionSegs),
      };
      const layersWithCaptions = captionsRemoved
        ? normalizeLayersFromFormat({
            ...nextFormat,
            captionsLayerRemoved: true,
            layers: normalizedLayers,
          })
        : normalizeLayersFromFormat({
            ...nextFormat,
            captionsLayerRemoved: false,
            layers: ensureCaptionsLayer(normalizedLayers, captionSegs),
          }).map((layer) =>
            layer.type === LAYER_TYPES.CAPTIONS
              ? { ...layer, segments: captionSegs, frameSegments: toFrameSegments(captionSegs) }
              : layer
          );

      setFormat({
        ...nextFormat,
        captions: captionSegmentsToCaptions(captionSegs),
        captionVariants: hydratedCaptionVariants,
      });
      setLayers(layersWithCaptions);
      setSelectedLayerId(layersWithCaptions[0]?.id || null);
      setStills(Array.isArray(data.format?.stills) ? data.format.stills : []);
      setCaptionVariants(hydratedCaptionVariants);
      setActiveCaptionVariant(resolvedActiveVariant);
      setCaptionPlacements(initialCaptionPlacements);
      setLayeredCaptions(anyLayered);
      setWaveformActiveLayers(
        data.format?.waveformActiveLayers || defaultWaveformActiveLayers
      );
      setWaveformLayerStrengths(
        data.format?.waveformLayerStrengths || defaultWaveformStrengths
      );
      setCaptionsEnabled(Boolean(activeCaptions));
      setOverlayVisibility((prev) => ({
        ...prev,
        marks: true,
        rapidRanges: true,
        lyrics: Boolean(activeCaptions && captionsEnabled),
        wordLyrics: Boolean(activeCaptions && captionsEnabled),
      }));
      setHasUnsavedChanges(false);
    } catch (err) {
      setError(err.message);
      setFormat(null);
    } finally {
      setLoading(false);
    }
  }, [
    activeCaptionVariant,
    captionPlacements,
    captionSegmentsToCaptions,
    captionsEnabled,
    captionsToCaptionSegments,
    defaultWaveformActiveLayers,
    defaultWaveformStrengths,
    ensureCaptionsLayer,
    layeredCaptions,
    normalizeLayersFromFormat,
    toFrameSegments,
  ]);

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
      const savedRes = await fetch(`/api/format-builder-v3/waveform/get?slug=${song.slug}`);
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
      const res = await fetch("/api/format-builder-v3/waveform", {
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
      const saveRes = await fetch("/api/format-builder-v3/waveform/save", {
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
      setCaptionVariants((prevVariants) => {
        const activeKey = activeCaptionVariant || "lyrics";
        const base =
          normalizeCaptions(prevVariants[activeKey] || format?.captions) || {
            provider: "manual",
            status: "draft",
            requestedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            words: [],
            lines: [],
            style: ensureCaptionStyle(format?.captions?.style),
          };
        const nextRaw = typeof updater === "function" ? updater(base) : updater;
        const next = normalizeCaptions(nextRaw);
        const nextVariants = { ...prevVariants, [activeKey]: next };
        const nextSegments = captionsToCaptionSegments(
          next,
          Math.max(0, Math.round((format?.meta?.durationSeconds || 0) * 1000))
        );
        setLayers((prev) => {
          const mapped = (prev || []).map((layer) => {
            if (layer.type !== LAYER_TYPES.CAPTIONS) return layer;
            return {
              ...layer,
              segments: nextSegments,
              frameSegments: toFrameSegments(nextSegments),
            };
          });
          return ensureCaptionsLayer(mapped, nextSegments);
        });
        setFormat((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            captions: next,
            captionVariants: nextVariants,
            activeCaptionVariant: activeKey,
          };
        });
        setHasUnsavedChanges(true);
        return nextVariants;
      });
    },
    [activeCaptionVariant, captionsToCaptionSegments, ensureCaptionsLayer, format?.captions, toFrameSegments]
  );

  const handleActiveCaptionVariantChange = useCallback(
    (variant) => {
      const nextVariant = variant === "clip" ? "clip" : "lyrics";
      setActiveCaptionVariant(nextVariant);
      const nextCaptions = captionVariants[nextVariant] || null;
      const nextSegments = captionsToCaptionSegments(
        nextCaptions,
        Math.max(0, Math.round((format?.meta?.durationSeconds || 0) * 1000))
      );
      setLayers((prev) => {
        const mapped = (prev || []).map((layer) =>
          layer.type === LAYER_TYPES.CAPTIONS
            ? { ...layer, segments: nextSegments, frameSegments: toFrameSegments(nextSegments) }
            : layer
        );
        return ensureCaptionsLayer(mapped, nextSegments);
      });
      setFormat((prev) =>
        prev
          ? {
              ...prev,
              captions: nextCaptions,
              captionVariants,
              activeCaptionVariant: nextVariant,
            }
          : prev
      );
      const placement = captionPlacements[nextVariant] || "top";
      setLayeredCaptions(placement === "layered");
      setHasUnsavedChanges(true);
    },
    [captionPlacements, captionVariants, captionsToCaptionSegments, ensureCaptionsLayer, format?.meta?.durationSeconds, toFrameSegments]
  );

  const handleCaptionPlacementChange = useCallback(
    (placement) => {
      const normalized = placement === "layered" ? "layered" : "top";
      setCaptionPlacements((prev) => {
        const next = { ...prev, [activeCaptionVariant]: normalized };
        const anyLayered = Object.values(next).includes("layered");
        setLayeredCaptions(anyLayered);
        setFormat((prevFormat) =>
          prevFormat
            ? {
                ...prevFormat,
                captionPlacements: {
                  ...(prevFormat.captionPlacements || {}),
                  [activeCaptionVariant]: normalized,
                },
                layeredCaptions: anyLayered,
              }
            : prevFormat
        );
        setHasUnsavedChanges(true);
        return next;
      });
    },
    [activeCaptionVariant]
  );

  const handleCaptionBoundaryMove = useCallback(
    (index, edge, timeSeconds, laneKey = "caps-top") => {
      if (index === undefined || index === null) return;
      const timeMs = Math.max(0, Math.round((Number(timeSeconds) || 0) * 1000));
      updateCaptions((current) => {
        const lines = Array.isArray(current.lines) ? [...current.lines] : [];
        if (!lines[index]) return current;
        const updated = { ...lines[index], layer: laneKey === "caps-layered" ? "layered" : "top" };
        if (edge === "start") {
          updated.startMs = Math.min(timeMs, updated.endMs ?? timeMs);
        } else {
          updated.endMs = Math.max(timeMs, updated.startMs ?? timeMs);
        }
        lines[index] = updated;
        return { ...current, lines, updatedAt: new Date().toISOString() };
      });
    },
    [updateCaptions]
  );

  const handleCaptionEntryLayerToggle = useCallback(
    (type, index, layer) => {
      const normalized = layer === "layered" ? "layered" : "top";
      updateCaptionLayer((segs) => {
        const next = [...segs];
        if (!next[index]) return segs;
        next[index] = {
          ...next[index],
          payload: { ...(next[index].payload || {}), layer: normalized },
        };
        return next;
      });
      setSelectedSegment((prev) =>
        prev && String(prev.lane).startsWith("caps")
          ? { ...prev, lane: normalized === "layered" ? "caps-layered" : "caps-top" }
          : prev
      );
      setSelectedCaptionKeys([`${type}-${index}`]);
      setHasUnsavedChanges(true);
    },
    [updateCaptionLayer]
  );

  const handleApplySegmentTimes = useCallback(() => {
    if (selectedSegmentIndex === null) return;
    const startSeconds = parseSecondsInput(segmentTimeDraft.start);
    const endSeconds = parseSecondsInput(segmentTimeDraft.end);
    if (startSeconds === null || endSeconds === null) {
      setSegmentTimeError("Start and End must be valid numbers.");
      return;
    }
    if (String(selectedSegmentLane).startsWith("caps")) {
      const err = updateSegmentTimes(
        selectedSegmentIndex,
        selectedSegmentLane,
        startSeconds,
        endSeconds,
        segmentTimeAdjustAdjacent
      );
      setSegmentTimeError(err);
      return;
    }
    const err = updateSegmentTimes(
      selectedSegmentIndex,
      selectedSegmentLane,
      startSeconds,
      endSeconds,
      segmentTimeAdjustAdjacent
    );
    setSegmentTimeError(err);
  }, [
    segmentTimeDraft.start,
    segmentTimeDraft.end,
    segmentTimeAdjustAdjacent,
    selectedSegmentIndex,
    selectedSegmentLane,
    updateSegmentTimes,
  ]);

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

  const handleCaptionSegmentTextChange = useCallback(
    (index, text) => {
      updateCaptionLayer((segs) => {
        if (!segs[index]) return segs;
        const prev = segs[index];
        const payload = prev.payload || {};
        const next = [...segs];
        next[index] = {
          ...prev,
          payload: {
            ...payload,
            text,
            originalText: payload.originalText || text,
          },
        };
        return next;
      });
    },
    [updateCaptionLayer]
  );

  const handleCaptionSegmentModeChange = useCallback(
    (index, mode) => {
      const normalized = ["preset", "lyrics", "clip"].includes(mode) ? mode : "preset";
      updateCaptionLayer((segs) => {
        if (!segs[index]) return segs;
        const prev = segs[index];
        const payload = prev.payload || {};
        const next = [...segs];
        next[index] = {
          ...prev,
          payload: {
            ...payload,
            captionMode: normalized,
          },
        };
        return next;
      });
    },
    [updateCaptionLayer]
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
      const res = await fetch("/api/format-builder-v3/captions/generate", {
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
      setCaptionVariants((prev) => ({ ...prev, lyrics: normalizedCaptions }));
      setActiveCaptionVariant("lyrics");
      setFormat((prev) => ({
        ...(data.format || prev || {}),
        captions: normalizedCaptions,
        captionVariants: { ...(prev?.captionVariants || {}), lyrics: normalizedCaptions },
        activeCaptionVariant: "lyrics",
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

  const handleGenerateClipCaptions = useCallback(() => {
    if (!selectedSong) return;
    const alignChoice = window
      .prompt("Generate clip captions aligned to base or cutout layer? (base/cutout)", "base")
      ?.trim()
      .toLowerCase();
    if (!alignChoice) return;
    const alignCutout = alignChoice.startsWith("c");
    const targetLayerType = alignCutout ? LAYER_TYPES.CUTOUT : LAYER_TYPES.BASE;
    const targetLayer = layers.find((l) => l.type === targetLayerType);
    const layerSegments = Array.isArray(targetLayer?.segments) ? [...targetLayer.segments] : [];
    const segments = layerSegments
      .filter((seg) => Number.isFinite(seg.startMs) && Number.isFinite(seg.endMs) && seg.endMs > seg.startMs)
      .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    const durationSec = songDuration || format?.meta?.durationSeconds || 0;
    const defaultDurationMs = Math.max(0, Math.round(durationSec * 1000));
    const loremWords =
      "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(
        " "
      );
    const buildText = (seconds) => {
      const wordCount = Math.max(3, Math.round(seconds * 2));
      const words = [];
      for (let i = 0; i < wordCount; i += 1) {
        words.push(loremWords[i % loremWords.length]);
      }
      return words.join(" ");
    };
    const clipCaptions = normalizeCaptions({
      provider: "lorem-generator",
      status: "ready",
      requestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      alignedLayer: alignCutout ? "cutout" : "base",
      lines:
        segments.length > 0
          ? segments.map((seg) => {
              const startSec = (Number(seg.startMs) || 0) / 1000;
              const endSec = (Number(seg.endMs) || Number(seg.startMs) || 0) / 1000;
              const duration = Math.max(0, endSec - startSec);
              const text = buildText(duration);
              return {
                text,
                originalText: text,
                captionMode: "clip",
                startMs: Math.round(seg.startMs || 0),
                endMs: Math.round(seg.endMs || seg.startMs || 0),
                useGlobalStyle: true,
              };
            })
          : [
              {
                text: buildText(Math.max(durationSec, 1)),
                originalText: buildText(Math.max(durationSec, 1)),
                captionMode: "clip",
                startMs: 0,
                endMs: defaultDurationMs || 1000,
                useGlobalStyle: true,
              },
            ],
      words: [],
      style: ensureCaptionStyle(format?.captions?.style),
      displayRanges: [],
    });
    setCaptionVariants((prev) => ({ ...prev, clip: clipCaptions }));
    setActiveCaptionVariant("clip");
    setCaptionsEnabled(true);
    const placement = captionPlacements.clip || (alignCutout ? "layered" : "top");
    setCaptionPlacements((prev) => ({ ...prev, clip: placement }));
    setLayeredCaptions(placement === "layered");
    const nextSegments = captionsToCaptionSegments(clipCaptions, defaultDurationMs);
    setLayers((prev) =>
      prev.map((layer) =>
        layer.type === LAYER_TYPES.CAPTIONS
          ? { ...layer, segments: nextSegments, frameSegments: toFrameSegments(nextSegments) }
          : layer
      )
    );
    setFormat((prev) =>
      prev
        ? {
            ...prev,
            captions: clipCaptions,
            captionVariants: { ...(prev.captionVariants || {}), clip: clipCaptions },
            activeCaptionVariant: "clip",
            captionPlacements: { ...(prev.captionPlacements || {}), clip: placement },
            layeredCaptions: placement === "layered",
          }
        : prev
    );
    setOverlayVisibility((prev) => ({ ...prev, lyrics: true, wordLyrics: true }));
    setHasUnsavedChanges(true);
  }, [
    captionPlacements,
    captionsToCaptionSegments,
    format?.captions?.style,
    layers,
    selectedSong,
    songDuration,
    toFrameSegments,
  ]);

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
      const res = await fetch("/api/format-builder-v3/captions/save", {
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
      setCaptionVariants((prev) => ({ ...prev, [activeCaptionVariant || "lyrics"]: normalizedCaptions }));
      setFormat((prev) => ({
        ...(prev || {}),
        ...(data.format || {}),
        captions: normalizedCaptions,
        captionVariants: {
          ...(prev?.captionVariants || {}),
          [activeCaptionVariant || "lyrics"]: normalizedCaptions,
        },
        activeCaptionVariant: activeCaptionVariant || "lyrics",
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
  }, [activeCaptionVariant, captionPlacements, format?.captions, selectedSong, validateCaptionTimeDrafts]);

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
        const saveRes = await fetch("/api/format-builder-v3/captions/save", {
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
        captionVariants: {
          ...(prev?.captionVariants || {}),
          [activeCaptionVariant || "lyrics"]: normalizedCaptions,
        },
        captionPlacements: prev?.captionPlacements || captionPlacements,
        activeCaptionVariant: activeCaptionVariant || "lyrics",
        }));
        setHasUnsavedChanges(false);
        setCaptionTimeDrafts({});
      }
      const res = await fetch("/api/format-builder-v3/render", {
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
      const res = await fetch("/api/format-builder-v3/waveform", {
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
      const saveRes = await fetch("/api/format-builder-v3/waveform/save", {
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
      const res = await fetch("/api/format-builder-v3/waveform/undo", {
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
    const baseLayer = layers.find((l) => l.type === LAYER_TYPES.BASE);
    const firstSeg = baseLayer?.segments?.[0];
    const payload = firstSeg?.payload || {};
    setGlobalVolumes({
      clipVolume: clampVolume(
        payload.clipVolume ?? payload.clipSlot?.clipVolume,
        DEFAULT_CLIP_VOLUME
      ),
      musicVolume: clampVolume(
        payload.musicVolume ?? payload.clipSlot?.musicVolume,
        DEFAULT_MUSIC_VOLUME
      ),
    });
    globalVolumesInitializedRef.current = true;
  }, [format, layers]);

  // Add split at current time for the active layer
  const handleAddMark = useCallback(() => {
    const time = audioRef.current?.currentTime ?? currentTime;
    splitSegmentAt(time, activeLayer);
  }, [activeLayer, currentTime, splitSegmentAt]);

  // Legacy no-op placeholders for mark move/delete
  const handleMarkMove = useCallback(() => {}, []);
  const handleMarkDelete = useCallback(() => {}, []);

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

  // Legacy timing grid support removed; rely on per-layer segments only.
  const sortedBeatGrid = useMemo(() => [], []);

  const layerBeatGrid = sortedBeatGrid;

  const markSelectionOptions = useMemo(() => {
    return sortedBeatGrid.map((time, idx) => ({
      value: idx,
      label: `Segment ${idx + 1} — ${formatSecondsLabel(time)}s`,
    }));
  }, [sortedBeatGrid]);

  const deleteRangeCount = useMemo(() => 0, []);

  const canDeleteMarkRange = useMemo(() => false, []);

  useEffect(() => {
    if (rangeDeleteStart !== null) setRangeDeleteStart(null);
    if (rangeDeleteEnd !== null) setRangeDeleteEnd(null);
  }, [rangeDeleteStart, rangeDeleteEnd]);

  const handleDeleteMarkRange = useCallback(() => {
    setRangeDeleteStart(null);
    setRangeDeleteEnd(null);
  }, []);

  const beatEntries = useMemo(() => [], []);

  const guidelineEntries = useMemo(() => [], []);

  const guidelineTagOptions = useMemo(() => GUIDELINE_TAG_PRESETS, []);

  const beatLabelMap = useMemo(() => ({}), []);

  const captionStyle = useMemo(
    () => ensureCaptionStyle(format?.captions?.style),
    [format?.captions?.style]
  );

  const captionDisplayRanges = useMemo(() => {
    return Array.isArray(format?.captions?.displayRanges) ? format.captions.displayRanges : [];
  }, [format?.captions?.displayRanges]);

  const captionSegmentsDetailed = useMemo(() => {
    const placementFallback = captionPlacements[activeCaptionVariant] || "top";
    const captionsLayer = layers.find((l) => l.type === LAYER_TYPES.CAPTIONS);
    const segs = Array.isArray(captionsLayer?.segments) ? captionsLayer.segments : [];
    return segs.map((seg, idx) => {
      const startMs = Math.round(seg.startMs || 0);
      const endMs = Math.round(seg.endMs || seg.startMs || 0);
      const payload = seg.payload || {};
      return {
        ...seg,
        index: idx,
        startMs,
        endMs,
        startSeconds: startMs / 1000,
        endSeconds: endMs / 1000,
        captionMode: payload.captionMode || "preset",
        text: payload.text || "",
        originalText: payload.originalText || payload.text || "",
        layer: payload.layer || placementFallback,
      };
    });
  }, [activeCaptionVariant, captionPlacements, layers]);

  const currentSegmentContext = useMemo(() => {
    if (selectedSegmentIndex === null) return null;
    const targetLayerType =
      selectedSegmentLane === "foreground"
        ? LAYER_TYPES.CUTOUT
        : selectedSegmentLane === "background"
        ? LAYER_TYPES.BASE
        : String(selectedSegmentLane).startsWith("caps")
        ? LAYER_TYPES.CAPTIONS
        : LAYER_TYPES.STILLS;
    const targetLayer = layers.find((l) => l.type === targetLayerType);
    const inspectedSeg = targetLayer?.segments?.[selectedSegmentIndex] || null;
    const segPayload = inspectedSeg?.payload || {};
    const meta =
      selectedSegmentLane === "foreground" || selectedSegmentLane === "background"
        ? layerBeatMetadata[selectedSegmentIndex] || {}
        : {};
    const { start, end } = getSegmentBounds(selectedSegmentIndex, selectedSegmentLane);
    const { match: rapidMatch } = findRapidForSegment(selectedSegmentLane, selectedSegmentIndex);
    const guidelineTags = segPayload.guidelineTags || [];
    const isIntroSegment = false;
    const isCaptionLane = String(selectedSegmentLane).startsWith("caps");
    const inspectedCaptionSegment = isCaptionLane ? captionSegmentsDetailed[selectedSegmentIndex] : null;
    return {
      targetLayerType,
      targetLayer,
      inspectedSeg,
      segPayload,
      meta,
      start,
      end,
      rapidMatch,
      guidelineTags,
      isIntroSegment,
      isCaptionLane,
      inspectedCaptionSegment,
    };
  }, [
    captionSegmentsDetailed,
    findRapidForSegment,
    getSegmentBounds,
    layerBeatMetadata,
    layers,
    selectedSegmentIndex,
    selectedSegmentLane,
  ]);

  const handleSelectCaptionSegmentFromList = useCallback(
    (idx) => {
      const captionsLayerId =
        layers.find((l) => l.type === LAYER_TYPES.CAPTIONS)?.id || "captions";
      setSelectedLayerId(captionsLayerId);
      setSelectedSegment({ index: idx, lane: "captions" });
    },
    [layers]
  );

  const handleCaptionSegmentPayloadChange = useCallback(
    (idx, field, value) => {
      updateSegmentPayload(LAYER_TYPES.CAPTIONS, idx, (payload = {}) => ({
        ...payload,
        [field]: value,
      }));
    },
    [updateSegmentPayload]
  );

  const handleCaptionSegmentResetText = useCallback(
    (idx) => {
      updateSegmentPayload(LAYER_TYPES.CAPTIONS, idx, (payload = {}) => ({
        ...payload,
        text: payload.originalText || payload.text || "",
      }));
    },
    [updateSegmentPayload]
  );

  const handleCaptionSegmentTimeChange = useCallback(
    (idx, field, text) => {
      const seconds = parseSecondsInput(text);
      if (seconds === null) return;
      const seg = captionSegmentsDetailed[idx];
      if (!seg) return;
      const start = field === "start" ? seconds : (seg.startMs || 0) / 1000;
      const end = field === "end" ? seconds : (seg.endMs || seg.startMs || 0) / 1000;
      const err = updateSegmentTimes(idx, "captions", start, end, segmentTimeAdjustAdjacent);
      setSegmentTimeError(err);
    },
    [captionSegmentsDetailed, segmentTimeAdjustAdjacent, updateSegmentTimes]
  );

  const handleAddCaptionSegment = useCallback(() => {
    const durationMs = Math.max(0, Math.round((songDuration || 0) * 1000));
    const last = captionSegmentsDetailed[captionSegmentsDetailed.length - 1];
    const startMs = last ? Math.round(last.endMs || 0) : 0;
    const defaultEnd = startMs + 2000;
    const endMs = Math.min(durationMs || defaultEnd, defaultEnd);
    if (endMs <= startMs) return;
    const placement = captionPlacements[activeCaptionVariant] || "top";
    updateCaptionLayer((segs = []) => {
      const next = [...segs];
      next.push({
        id: `cap-${next.length + 1}`,
        startMs,
        endMs,
        payload: {
          captionMode: activeCaptionVariant === "clip" ? "clip" : "preset",
          text: "",
          originalText: "",
          layer: placement,
        },
      });
      return next;
    });
    setSelectedSegment({ index: captionSegmentsDetailed.length, lane: "captions" });
  }, [
    activeCaptionVariant,
    captionPlacements,
    captionSegmentsDetailed,
    songDuration,
    updateCaptionLayer,
  ]);

  const handleRemoveCaptionSegment = useCallback(
    (idx) => {
      updateCaptionLayer((segs = []) => {
        if (!segs[idx]) return segs;
        const next = [...segs];
        next.splice(idx, 1);
        return next;
      });
      setSelectedSegment(null);
    },
    [updateCaptionLayer]
  );

  const captionLines = useMemo(() => {
    if (!format?.captions?.lines) return [];
    return format.captions.lines.map((line, idx) => ({
      ...line,
      layer: line.layer || null,
      type: "line",
      index: idx,
      text: line.text || "",
      startSeconds: (Number(line.startMs) || 0) / 1000,
      endSeconds: (Number(line.endMs) || 0) / 1000,
    }));
  }, [format?.captions?.lines]);

  const captionWords = useMemo(() => {
    if (!format?.captions?.words) return [];
    return format.captions.words.map((word, idx) => ({
      ...word,
      layer: word.layer || null,
      type: "word",
      index: idx,
      text: word.text || "",
      startSeconds: (Number(word.startMs) || 0) / 1000,
      endSeconds: (Number(word.endMs) || 0) / 1000,
    }));
  }, [format?.captions?.words]);

  useEffect(() => {
    if (selectedSegmentIndex === null) {
      setSegmentTimeDraft({ start: "", end: "" });
      setSegmentTimeError(null);
      return;
    }
    if (String(selectedSegmentLane).startsWith("caps") && captionSegmentsDetailed[selectedSegmentIndex]) {
      const line = captionSegmentsDetailed[selectedSegmentIndex];
      setSegmentTimeDraft({
        start: formatSecondsInput(line.startMs),
        end: formatSecondsInput(line.endMs),
      });
      setSegmentTimeError(null);
      return;
    }
    const { start, end } = getSegmentBounds(selectedSegmentIndex, selectedSegmentLane);
    setSegmentTimeDraft({
      start: formatSecondsInput(start * 1000),
      end: formatSecondsInput(end * 1000),
    });
    setSegmentTimeError(null);
  }, [captionSegmentsDetailed, getSegmentBounds, selectedSegmentIndex, selectedSegmentLane]);

  const combinedCaptionEntries = useMemo(() => {
    const entries = captionSegmentsDetailed.map((seg) => ({
      type: "line",
      data: {
        ...seg,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text,
        captionMode: seg.captionMode,
        originalText: seg.originalText,
        layer: seg.layer,
      },
    }));
    return entries.sort((a, b) => {
      const aStart = a.data.startMs ?? 0;
      const bStart = b.data.startMs ?? 0;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = a.data.endMs ?? aStart;
      const bEnd = b.data.endMs ?? bStart;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return 0;
    });
  }, [captionSegmentsDetailed]);

  const captionTimelineEntries = useMemo(
    () => captionSegmentsDetailed.map((seg) => ({ ...seg, startMs: seg.startMs, endMs: seg.endMs })),
    [captionSegmentsDetailed]
  );

  const getSegmentsForLayerType = useCallback(
    (layerType) => {
      const layer = (layers || []).find((l) => l.type === layerType);
      if (!layer || !Array.isArray(layer.segments)) return [];
      return layer.segments
        .map((seg, idx) => {
          const start = (Number(seg.startMs) || 0) / 1000;
          const end = (Number(seg.endMs) || Number(seg.startMs) || 0) / 1000;
          const isCaptionsLayer = layer.type === LAYER_TYPES.CAPTIONS;
          const captionMode = seg.payload?.captionMode || "preset";
          const captionText = seg.payload?.text || "";
          const displayIndex = Number.isInteger(seg.index) ? seg.index + 1 : idx + 1;
          const captionLabel = captionText
            ? `${captionMode ? `[${captionMode}] ` : ""}${captionText}`
            : captionMode
            ? `[${captionMode}]`
            : "";
          return {
            index: idx,
            displayIndex,
            start,
            end,
            type: seg.type || "segment",
            text: isCaptionsLayer ? captionLabel : seg.payload?.label || seg.payload?.text || "",
            payload: seg.payload || {},
          };
        })
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
    },
    [layers]
  );

  const segmentsFromBeatGrid = useCallback(
    (grid = []) => {
      const durationSec =
        songDuration || format?.meta?.durationSeconds || 0;
      const sorted = Array.isArray(grid)
        ? [...grid].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
        : [];
      const times = [0, ...sorted, durationSec];
      const segs = [];
      for (let i = 0; i < times.length - 1; i += 1) {
        const startMs = Math.round(times[i] * 1000);
        const endMs = Math.round(times[i + 1] * 1000);
        if (endMs > startMs) {
          segs.push({
            id: `seg-${i + 1}`,
            startMs,
            endMs,
            payload: {},
          });
        }
      }
      return segs;
    },
    [format?.meta?.durationSeconds, songDuration]
  );

  const baseSegments = useMemo(
    () => getSegmentsForLayerType(LAYER_TYPES.BASE),
    [getSegmentsForLayerType]
  );
  const foregroundSegments = useMemo(
    () => (cutoutEnabled ? getSegmentsForLayerType(LAYER_TYPES.CUTOUT) : []),
    [cutoutEnabled, getSegmentsForLayerType]
  );
  const captionSegments = useMemo(
    () => getSegmentsForLayerType(LAYER_TYPES.CAPTIONS),
    [getSegmentsForLayerType]
  );

  const stillSegments = useMemo(
    () =>
      (stills || [])
        .map((s, i) => {
          const start = (Number(s.startMs) || 0) / 1000;
          const end = (Number(s.endMs) || Number(s.startMs) || 0) / 1000;
          return {
            index: s.index ?? i,
            start,
            end,
            type: "still",
            text: s.label || s.sourceId || `Still ${i + 1}`,
          };
        })
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start),
    [stills]
  );

  const sortedLayers = useMemo(
    () => (Array.isArray(layers) ? [...layers].sort((a, b) => (b.order ?? 0) - (a.order ?? 0)) : []),
    [layers]
  );

  const timelineLanes = useMemo(() => {
    if (isImportMode && clipTimelineSegments.length) {
      return [
        {
          id: "clips",
          type: "clip",
          label: "Clips",
          colorKey: "bg",
          segments: clipTimelineSegments.map((seg, idx) => ({
            id: seg.id || `clip-${idx}`,
            index: idx,
            start: seg.start,
            end: seg.end,
            type: "clip",
            text: seg.label,
            payload: seg,
          })),
        },
      ];
    }
    if (!sortedLayers.length) return null;
    return sortedLayers
      .filter((l) => l.visible !== false)
      .map((layer) => {
        switch (layer.type) {
          case LAYER_TYPES.BASE:
            return {
              id: layer.id,
              type: layer.type,
              label: layer.name || "Base",
              colorKey: "bg",
              segments: baseSegments,
            };
          case LAYER_TYPES.CUTOUT:
            if (!cutoutEnabled) return null;
            return {
              id: layer.id,
              type: layer.type,
              label: layer.name || "Cutout",
              colorKey: "fg",
              segments: foregroundSegments,
            };
          case LAYER_TYPES.CAPTIONS:
            return {
              id: layer.id,
              type: layer.type,
              label: layer.name || "Captions",
              colorKey: "caps-top",
              segments: captionSegments,
            };
          case LAYER_TYPES.STILLS:
            return {
              id: layer.id,
              type: layer.type,
              label: layer.name || "Stills",
              colorKey: "stills",
              segments: stillSegments,
            };
          case LAYER_TYPES.WAVEFORM:
            return {
              id: layer.id,
              type: layer.type,
              label: layer.name || "Waveform",
              colorKey: "waveform",
              segments: [],
            };
          default:
            return null;
        }
      })
      .filter(Boolean);
  }, [
    sortedLayers,
    baseSegments,
    cutoutEnabled,
    foregroundSegments,
    captionSegments,
    stillSegments,
    isImportMode,
    clipTimelineSegments,
  ]);

  const handleLaneReorder = useCallback(
    (nextLaneOrder) => {
      if (!Array.isArray(nextLaneOrder)) return;
      setLayers((prev) => {
        const orderMap = new Map(
          nextLaneOrder.map((lane, idx) => [lane.id, nextLaneOrder.length - idx - 1])
        );
        return prev.map((layer) =>
          orderMap.has(layer.id) ? { ...layer, order: orderMap.get(layer.id) } : layer
        );
      });
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleSegmentResize = useCallback(
    (laneId, segmentId, edge, newTimeSeconds, segmentIndex = null) => {
      const durationMs = Math.max(
        0,
        Math.round((format?.meta?.durationSeconds || duration || songDuration || 0) * 1000)
      );
      const minMs = Math.max(1, Math.round(MIN_SEGMENT_DURATION * 1000));
      const nextTimeMs = Math.max(0, Math.round((Number(newTimeSeconds) || 0) * 1000));

      let updatedCaptionSegments = null;
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.id !== laneId) return layer;
          const segs = Array.isArray(layer.segments) ? [...layer.segments] : [];
          const idx = Number.isInteger(segmentIndex)
            ? Math.max(0, Math.min(segmentIndex, segs.length - 1))
            : segs.findIndex((s, i) => {
                const matchesId = s.id === segmentId || String(s.id) === String(segmentId);
                const matchesIndex = s.index === segmentId || String(s.index) === String(segmentId);
                const matchesPosition = i === Number(segmentId) || i + 1 === Number(segmentId);
                return matchesId || matchesIndex || matchesPosition;
              });
          if (idx === -1) return layer;
          const prevSeg = segs[idx];
          const prevNeighbor = idx > 0 ? segs[idx - 1] : null;
          const nextNeighbor = idx < segs.length - 1 ? segs[idx + 1] : null;
          const prevNeighborEnd = idx > 0 ? Number(segs[idx - 1].endMs) || 0 : 0;
          const nextNeighborStart =
            idx < segs.length - 1 ? Number(segs[idx + 1].startMs) || durationMs : durationMs;
          const prevNeighborStart = prevNeighbor ? Number(prevNeighbor.startMs) || 0 : 0;
          const nextNeighborEnd = nextNeighbor ? Number(nextNeighbor.endMs) || durationMs : durationMs;
          const currentStartMs = Number(prevSeg.startMs) || 0;
          const currentEndMs = Number(prevSeg.endMs) || currentStartMs;
          const segDurationMs = Math.max(minMs, currentEndMs - currentStartMs);
          let startMs = currentStartMs;
          let endMs = currentEndMs;

          if (edge === "start") {
            startMs = Math.max(nextTimeMs, prevNeighborEnd);
            if (endMs - startMs < minMs) startMs = endMs - minMs;
            startMs = Math.max(0, startMs);
          } else if (edge === "end") {
            endMs = Math.min(Math.max(nextTimeMs, startMs + minMs), nextNeighborStart);
          } else if (edge === "move") {
            startMs = Math.max(prevNeighborEnd, nextTimeMs);
            endMs = startMs + segDurationMs;
            if (endMs > nextNeighborStart) {
              endMs = nextNeighborStart;
              startMs = Math.max(prevNeighborEnd, endMs - segDurationMs);
            }
            if (endMs - startMs < minMs) {
              endMs = startMs + minMs;
            }
            startMs = Math.max(0, startMs);
            endMs = Math.min(durationMs || endMs, endMs);
          }

          // Ensure we don't violate minimum durations on neighbors and keep segments contiguous
          if (prevNeighbor) {
            const minStartForNeighbor = prevNeighborStart + minMs;
            startMs = Math.max(startMs, minStartForNeighbor);
          }
          if (nextNeighbor) {
            const maxEndBeforeNext = nextNeighborEnd - minMs;
            endMs = Math.min(endMs, maxEndBeforeNext);
          }
          if (endMs - startMs < minMs) {
            endMs = startMs + minMs;
          }
          startMs = Math.max(0, startMs);
          endMs = Math.min(durationMs || endMs, endMs);

          const updatedSeg = { ...prevSeg, startMs, endMs };
          const nextSegs = [...segs];
          nextSegs[idx] = updatedSeg;

          // Keep adjacent segments touching the moved boundary
          if (prevNeighbor) {
            nextSegs[idx - 1] = { ...prevNeighbor, endMs: startMs };
          }
          if (nextNeighbor) {
            nextSegs[idx + 1] = { ...nextNeighbor, startMs: endMs };
          }

          if (layer.type === LAYER_TYPES.CAPTIONS) {
            updatedCaptionSegments = nextSegs;
          }
          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        })
      );
      if (updatedCaptionSegments) {
        setFormat((prev) =>
          prev
            ? {
                ...prev,
                captions: captionSegmentsToCaptions(updatedCaptionSegments),
                captionVariants: {
                  ...(prev.captionVariants || {}),
                  [activeCaptionVariant]: captionSegmentsToCaptions(updatedCaptionSegments),
                },
              }
            : prev
        );
        setCaptionVariants((prev) => ({
          ...prev,
          [activeCaptionVariant]: captionSegmentsToCaptions(updatedCaptionSegments),
        }));
      }
      setHasUnsavedChanges(true);
    },
    [
      activeCaptionVariant,
      captionSegmentsToCaptions,
      duration,
      format?.meta?.durationSeconds,
      songDuration,
      toFrameSegments,
    ]
  );

  const generateLayerId = useCallback(
    (type) => `${type || "layer"}-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  const handleAddLayer = useCallback(
    (type) => {
      const newId = generateLayerId(type);
      setLayers((prev) => {
        const highestOrder =
          prev.length > 0 ? Math.max(...prev.map((l) => l.order ?? 0)) : 0;
        const initialSegments =
          type === LAYER_TYPES.STILLS
            ? []
            : createFullLengthSegment(newId, type);
        const next = [
          ...prev,
          {
            id: newId,
            type,
            name:
              type === LAYER_TYPES.BASE
                ? "Video"
                : type === LAYER_TYPES.CUTOUT
                ? "Cutout"
                : type === LAYER_TYPES.CAPTIONS
                ? "Captions"
                : type === LAYER_TYPES.STILLS
                ? "Stills"
                : "Layer",
            order: highestOrder + 1,
            visible: true,
            locked: false,
            segments: initialSegments,
            frameSegments: toFrameSegments(initialSegments),
          },
        ];
        return next.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
      });
      setSelectedLayerId(newId);
      if (type === LAYER_TYPES.CUTOUT) {
        setFormat((prev) => {
          if (!prev) return prev;
          const nextForeground = hydrateForeground(prev.foreground || {});
          return { ...prev, cutoutEnabled: true, foreground: nextForeground };
        });
      }
      if (type === LAYER_TYPES.STILLS) {
        setStills((prev) => prev || []);
      }
      if (type === LAYER_TYPES.CAPTIONS) {
        const initialSegments = createFullLengthSegment(newId, LAYER_TYPES.CAPTIONS);
        setFormat((prev) =>
          prev
            ? {
                ...prev,
                captions: captionSegmentsToCaptions(initialSegments),
                captionVariants: {
                  ...(prev.captionVariants || {}),
                  [activeCaptionVariant]: captionSegmentsToCaptions(initialSegments),
                },
              }
            : prev
        );
        setCaptionVariants((prev) => ({
          ...prev,
          [activeCaptionVariant]: captionSegmentsToCaptions(initialSegments),
        }));
      }
      setHasUnsavedChanges(true);
    },
    [
      activeCaptionVariant,
      captionSegmentsToCaptions,
      createFullLengthSegment,
      generateLayerId,
      hydrateForeground,
      toFrameSegments,
    ]
  );

  const handleAddStill = useCallback(() => {
    setStills((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      next.push({
        id: `still-${Math.random().toString(36).slice(2, 8)}`,
        index: next.length,
        label: `Still ${next.length + 1}`,
        startMs: 0,
        endMs: 1000,
        sourceId: "",
        frameMs: 0,
        isCutout: false,
        sharedFrameId: null,
        pairing: null,
      });
      return next;
    });
    setHasUnsavedChanges(true);
  }, []);

  const handleStillChange = useCallback((idx, patch) => {
    setStills((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      if (!next[idx]) return next;
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    setHasUnsavedChanges(true);
  }, []);

  const findLineForWord = useCallback(
    (word) => {
      const start = word?.startMs ?? 0;
      const end = word?.endMs ?? start;
      let matchIdx = -1;
      let match = null;
      captionSegmentsDetailed.forEach((line, idx) => {
        const ls = line.startMs ?? 0;
        const le = line.endMs ?? ls;
        if (start >= ls - 1 && end <= le + 1) {
          if (match === null || Math.abs(start - ls) < Math.abs((match.startMs ?? 0) - ls)) {
            match = line;
            matchIdx = idx;
          }
        }
      });
      return match ? { line: match, index: matchIdx } : null;
    },
    [captionSegmentsDetailed]
  );

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
    if (isImportMode) {
      setImportIsPlaying((prev) => !prev);
      return;
    }
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      segmentPreviewActiveRef.current = false;
      segmentPreviewEndRef.current = null;
      setIsSegmentPreviewing(false);
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }, [isImportMode, isPlaying]);

  const handleRestart = useCallback(() => {
    if (isImportMode) {
      setCurrentTime(0);
      setImportClipIndex(0);
      const seg = clipTimelineSegments[0];
      if (seg && importVideoRef.current) {
        importVideoRef.current.currentTime = 0;
        importVideoRef.current.play().catch(() => {});
        setImportIsPlaying(true);
      }
      return;
    }
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
    setIsPlaying(true);
    setCurrentTime(0);
  }, [clipTimelineSegments, isImportMode]);

  // Global spacebar play/pause (always)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Space") return;
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      e.preventDefault();
      handlePlayPause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlePlayPause]);

  // Hotkey: add mark at playhead for active layer (KeyM)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "KeyM") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      e.preventDefault();
      handleAddMark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAddMark]);

  // Undo / Redo via Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z
  const applyUndo = useCallback(() => {
    if (!undoStackRef.current.length) return;
    const prev = undoStackRef.current.pop();
    redoStackRef.current.push({ format, layers, waveformActiveLayers, waveformLayerStrengths });
    isApplyingUndoRef.current = true;
    setFormat(prev.format);
    if (prev.layers) setLayers(prev.layers);
    if (prev.waveformActiveLayers) setWaveformActiveLayers(prev.waveformActiveLayers);
    if (prev.waveformLayerStrengths) setWaveformLayerStrengths(prev.waveformLayerStrengths);
    setHasUnsavedChanges(true);
  }, [layers, format, waveformActiveLayers, waveformLayerStrengths]);

  const applyRedo = useCallback(() => {
    if (!redoStackRef.current.length) return;
    const next = redoStackRef.current.pop();
    undoStackRef.current.push({ format, layers, waveformActiveLayers, waveformLayerStrengths });
    isApplyingUndoRef.current = true;
    setFormat(next.format);
    if (next.layers) setLayers(next.layers);
    if (next.waveformActiveLayers) setWaveformActiveLayers(next.waveformActiveLayers);
    if (next.waveformLayerStrengths) setWaveformLayerStrengths(next.waveformLayerStrengths);
    setHasUnsavedChanges(true);
  }, [layers, format, waveformActiveLayers, waveformLayerStrengths]);

  const handleWaveformLayerToggle = useCallback((key, value) => {
    setWaveformActiveLayers((prev) => ({
      ...prev,
      [key]: value,
    }));
    setHasUnsavedChanges(true);
  }, []);

  const handleWaveformStrengthChange = useCallback((key, value) => {
    const clamped = Math.min(Math.max(value || 1, 0.2), 100);
    setWaveformLayerStrengths((prev) => ({
      ...prev,
      [key]: clamped,
    }));
    setHasUnsavedChanges(true);
  }, []);

  const handleDeleteSegmentVideo = useCallback(
    (segmentIdx, lane) => {
      if (segmentIdx === null || segmentIdx === undefined) return;
      const targetType =
        lane === "foreground"
          ? LAYER_TYPES.CUTOUT
          : lane === "background"
          ? LAYER_TYPES.BASE
          : null;
      if (!targetType) return;
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.type !== targetType) return layer;
          const segs = Array.isArray(layer.segments) ? [...layer.segments] : [];
          if (segmentIdx < 0 || segmentIdx >= segs.length) return layer;
          const nextSegs = segs.filter((_, i) => i !== segmentIdx);
          return {
            ...layer,
            segments: nextSegs,
            frameSegments: toFrameSegments(nextSegs),
          };
        })
      );
      setSelectedSegment(null);
      setHasUnsavedChanges(true);
    },
    [toFrameSegments]
  );

  useEffect(() => {
    const onKey = (e) => {
      const isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey;
      const isRedo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && e.shiftKey;
      if (!isUndo && !isRedo) return;
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) {
        return; // allow native undo inside inputs
      }
      e.preventDefault();
      if (isUndo) applyUndo();
      else applyRedo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyUndo, applyRedo]);

  // Seek to time
  const handleSeek = useCallback(
    (time) => {
      if (isImportMode) {
        setCurrentTime(time);
        const idx = clipTimelineSegments.findIndex((seg) => time >= seg.start && time < seg.end);
        const nextIdx = idx >= 0 ? idx : clipTimelineSegments.length - 1;
        setImportClipIndex(Math.max(0, nextIdx));
        const seg = clipTimelineSegments[Math.max(0, nextIdx)];
        const video = importVideoRef.current;
        if (video && seg) {
          video.currentTime = Math.max(0, time - seg.start);
          if (importIsPlaying) {
            video.play().catch(() => {});
          }
        }
        return;
      }
      if (!audioRef.current) return;
      segmentPreviewActiveRef.current = false;
      segmentPreviewEndRef.current = null;
      setIsSegmentPreviewing(false);
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    },
    [clipTimelineSegments, importIsPlaying, isImportMode]
  );

  const handleExternalTimeUpdate = useCallback(
    (time) => {
      setCurrentTime(time);
      if (
        segmentPreviewActiveRef.current &&
        segmentPreviewEndRef.current !== null &&
        time >= segmentPreviewEndRef.current - 1e-3
      ) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = segmentPreviewEndRef.current;
        }
        segmentPreviewActiveRef.current = false;
        segmentPreviewEndRef.current = null;
        setIsPlaying(false);
        setIsSegmentPreviewing(false);
      }
    },
    []
  );

  // Arrow keys seek (frame-sized nudge; Shift for 1s)
  useEffect(() => {
    const onKey = (e) => {
      if (!audioRef.current) return;
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.code !== "ArrowLeft" && e.code !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : 1 / (fps || TARGET_FPS);
      const dir = e.code === "ArrowRight" ? 1 : -1;
      const durationSec = duration || audioRef.current.duration || 0;
      const next = Math.min(Math.max((audioRef.current.currentTime || 0) + dir * step, 0), durationSec || Infinity);
      handleSeek(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audioRef, duration, fps, handleSeek]);

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
      const captionLayer = layers.find((l) => l.type === LAYER_TYPES.CAPTIONS);
      const captionSegs = Array.isArray(captionLayer?.segments) ? captionLayer.segments : [];
      const normalizedCaptionPayload = hasCaptionsLayer
        ? captionSegmentsToCaptions(captionSegs)
        : format?.captions || null;
      const nextCaptionVariants = hasCaptionsLayer
        ? {
            ...captionVariants,
            [activeCaptionVariant]: normalizedCaptionPayload,
          }
        : captionVariants || {};
      const captionsActive = captionsEnabled && hasCaptionsLayer;
      const layeredCaptionsActive =
        cutoutEnabled &&
        hasCaptionsLayer &&
        (layeredCaptions || Object.values(captionPlacements || {}).includes("layered"));
      const payloadLayers = (layers || []).map((layer) =>
        layer.type === LAYER_TYPES.CAPTIONS
          ? {
              ...layer,
              frameSegments: toFrameSegments(layer.segments || []),
            }
          : layer
      );
      const targetFps = format.meta?.targetFps || TARGET_FPS;
      const backgroundRapidRanges = Array.isArray(format.rapidClipRanges)
        ? format.rapidClipRanges
        : [];
      const backgroundRapidFrames = rapidRangesToFrames(backgroundRapidRanges, targetFps);
      const foregroundRapidRanges = Array.isArray(format.foreground?.rapidClipRanges)
        ? format.foreground.rapidClipRanges
        : [];
      const foregroundRapidFrames = rapidRangesToFrames(foregroundRapidRanges, targetFps);
      const res = await fetch("/api/format-builder-v3/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: selectedSong.slug,
          format: {
            ...format,
            schemaVersion: format.schemaVersion || 3,
            cutoutEnabled: Boolean(cutoutEnabled),
            layeredCaptions: layeredCaptionsActive,
            captionVariants: nextCaptionVariants,
            activeCaptionVariant,
            captionPlacements,
            waveformActiveLayers,
            waveformLayerStrengths,
            captionsLayerRemoved: captionsLayerRemoved || !hasCaptionsLayer,
            layers: payloadLayers,
            stills,
            captions: normalizedCaptionPayload
              ? {
                  ...normalizedCaptionPayload,
                  enabled: captionsActive,
                }
              : format.captions,
            beatGrid: [],
            beatGridFrames: [],
            beatGridFramePairs: [],
            beatMetadata: [],
            rapidClipRanges: backgroundRapidRanges,
            rapidClipFrames: backgroundRapidFrames,
            foreground: {
              ...(format.foreground || {}),
              beatGrid: [],
              beatGridFrames: [],
              beatGridFramePairs: [],
              beatMetadata: [],
              rapidClipRanges: foregroundRapidRanges,
              rapidClipFrames: foregroundRapidFrames,
            },
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const data = await res.json();
      const normalizedLayers = normalizeLayersFromFormat(data.format);
      setFormat({ ...data.format, layers: normalizedLayers });
      setCaptionVariants(data.format.captionVariants || {});
      setActiveCaptionVariant(data.format.activeCaptionVariant || activeCaptionVariant);
      setWaveformActiveLayers(data.format.waveformActiveLayers || defaultWaveformActiveLayers);
      setWaveformLayerStrengths(data.format.waveformLayerStrengths || defaultWaveformStrengths);
      setLayeredCaptions(
        Boolean(
          data.format.layeredCaptions ||
            Object.values(data.format.captionPlacements || {}).includes("layered")
        )
      );
      setLayers(normalizedLayers);
      setSelectedLayerId((prev) => prev || normalizedLayers[0]?.id || null);
      setStills(Array.isArray(data.format.stills) ? data.format.stills : []);
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

  const handleResetBase = () => {
    if (!window.confirm("Reset base cuts and rapid ranges? They will be cleared on Save.")) return;
    setLayers((prev) =>
      prev.map((layer) =>
        layer.type === LAYER_TYPES.BASE
          ? { ...layer, segments: [], frameSegments: [] }
          : layer.type === LAYER_TYPES.CUTOUT
          ? { ...layer, segments: [], frameSegments: [] }
          : layer
      )
    );
    setHasUnsavedChanges(true);
  };

  const handleResetForeground = () => {
    if (!window.confirm("Reset cutout cuts and rapid ranges? They will be cleared on Save.")) return;
    setFormat((prev) => {
      if (!prev) return prev;
      const fg = prev.foreground || {};
      return {
        ...prev,
        cutoutEnabled: true,
        foreground: {
          ...fg,
          beatGrid: [],
          beatGridFrames: [],
          beatGridFramePairs: [],
          beatMetadata: [],
          rapidClipRanges: [],
          rapidClipFrames: [],
          clipSegments: [],
        },
      };
    });
    setHasUnsavedChanges(true);
  };

  const handleResetCaptions = () => {
    if (!window.confirm("Reset captions? They will be removed on Save.")) return;
    setFormat((prev) =>
      prev
        ? {
            ...prev,
            captions: null,
            captionVariants: { lyrics: null, clip: null },
            activeCaptionVariant: "lyrics",
          }
        : prev
    );
    setCaptionVariants({ lyrics: null, clip: null });
    setActiveCaptionVariant("lyrics");
    setCaptionPlacements({ lyrics: "top", clip: "layered" });
    setLayers((prev) => prev.filter((layer) => layer.type !== LAYER_TYPES.CAPTIONS));
    setSelectedCaptionLine(null);
    setSelectedCaptionWord(null);
    setSelectedCaptionKeys([]);
    setLastCaptionSelectionIndex(null);
    setOverlayVisibility((prev) => ({
      ...prev,
      lyrics: false,
      wordLyrics: false,
    }));
    setHasUnsavedChanges(true);
  };

  // Auto analyze song
  const handleAutoAnalyze = async () => {
    if (!selectedSong || !format) return;

    // Confirm if cuts already exist
    if (layerBeatGrid.length > 0) {
      const confirmed = window.confirm(
        `This will replace the existing ${layerBeatGrid.length} cuts with auto-detected segments for the ${
          isForegroundLayer ? "cutout" : "base"
        } layer. Continue?`
      );
      if (!confirmed) return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const res = await fetch("/api/format-builder-v3/analyze", {
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
      const segmentGrid = data.segmentGrid || data.beatGrid || [];

      const detectedSegments = segmentsFromBeatGrid(segmentGrid);
      const targetType = isForegroundLayer ? LAYER_TYPES.CUTOUT : LAYER_TYPES.BASE;
      setLayers((prev) =>
        prev.map((layer) =>
          layer.type === targetType
            ? {
                ...layer,
                segments: detectedSegments,
                frameSegments: toFrameSegments(detectedSegments),
              }
            : layer
        )
      );
      setFormat((prev) =>
        prev
          ? {
              ...prev,
              meta: {
                ...prev.meta,
                bpm: data.meta.bpm,
                bpmConfidence: data.meta.bpmConfidence,
              },
            }
          : prev
      );
      setHasUnsavedChanges(true);
      setSuccessMessage(
        `Auto-detected ${segmentGrid.length} segments` +
          (data.meta.bpm ? ` at ${data.meta.bpm} BPM` : "")
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const renderSegmentSettings = (options = {}) => {
    const { compact = false } = options;
    const gridGap = compact ? "gap-2" : "gap-3";
    const textSize = compact ? "text-[11px]" : "text-xs";
    const inputText = compact ? "text-[12px]" : "text-sm";
    const smallPad = compact ? "px-2 py-1" : "px-3 py-2";

    if (selectedSegmentIndex === null) {
      return <div className="text-sm text-slate-500">Select a segment to view timing.</div>;
    }

    if (selectedSegmentLane === "stills") {
      const still = stills[selectedSegmentIndex];
      if (!still) {
        return <div className="text-sm text-slate-500">Still not found.</div>;
      }
      return (
        <div className={`space-y-3 ${compact ? "text-xs" : "text-sm"}`}>
          <div className={`${textSize} font-semibold text-slate-300`}>Still {selectedSegmentIndex + 1}</div>
          <div className={`grid auto-rows-min grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${gridGap}`}>
            <label className={`flex flex-col gap-1 ${textSize} text-slate-300`}>
              Label
              <input
                className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 ${inputText}`}
                value={still.label || ""}
                onChange={(e) => handleStillChange(selectedSegmentIndex, { label: e.target.value })}
              />
            </label>
            <label className={`flex flex-col gap-1 ${textSize} text-slate-300`}>
              Source clip ID
              <input
                className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 ${inputText}`}
                value={still.sourceId || ""}
                onChange={(e) => handleStillChange(selectedSegmentIndex, { sourceId: e.target.value })}
              />
            </label>
            <label className={`flex flex-col gap-1 ${textSize} text-slate-300`}>
              Start (s)
              <input
                type="number"
                step="0.001"
                className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 ${inputText}`}
                value={(Number(still.startMs) || 0) / 1000}
                onChange={(e) =>
                  handleStillChange(selectedSegmentIndex, {
                    startMs: Math.max(0, parseFloat(e.target.value || "0") * 1000),
                  })
                }
              />
            </label>
            <label className={`flex flex-col gap-1 ${textSize} text-slate-300`}>
              End (s)
              <input
                type="number"
                step="0.001"
                className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 ${inputText}`}
                value={(Number(still.endMs) || Number(still.startMs) || 0) / 1000}
                onChange={(e) =>
                  handleStillChange(selectedSegmentIndex, {
                    endMs: Math.max(0, parseFloat(e.target.value || "0") * 1000),
                  })
                }
              />
            </label>
            <label className={`flex flex-col gap-1 ${textSize} text-slate-300`}>
              Frame (ms)
              <input
                type="number"
                className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 ${inputText}`}
                value={Number.isFinite(still.frameMs) ? still.frameMs : 0}
                onChange={(e) =>
                  handleStillChange(selectedSegmentIndex, {
                    frameMs: Math.max(0, parseFloat(e.target.value || "0")),
                  })
                }
              />
            </label>
            <label className={`flex items-center gap-2 ${textSize} text-slate-300`}>
              <input
                type="checkbox"
                checked={Boolean(still.isCutout)}
                onChange={(e) => handleStillChange(selectedSegmentIndex, { isCutout: e.target.checked })}
              />
              Use cutout source (alpha / ProRes 4444)
            </label>
            <label className={`flex flex-col gap-1 ${textSize} text-slate-300`}>
              Shared frame ID (optional)
              <input
                className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 ${inputText}`}
                value={still.sharedFrameId || ""}
                onChange={(e) => handleStillChange(selectedSegmentIndex, { sharedFrameId: e.target.value })}
                placeholder="Reuse another still's captured frame"
              />
            </label>
            <label className={`flex flex-col gap-1 ${textSize} text-slate-300`}>
              Pairing target (layer:segment)
              <input
                className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 ${inputText}`}
                value={
                  still.pairing && still.pairing.targetLayerId
                    ? `${still.pairing.targetLayerId}:${still.pairing.targetSegmentIndex ?? ""}`
                    : ""
                }
                onChange={(e) => {
                  const [layerId, segIdx] = (e.target.value || "").split(":");
                  handleStillChange(selectedSegmentIndex, {
                    pairing: layerId
                      ? {
                          targetLayerId: layerId,
                          targetSegmentIndex: Number.isFinite(parseInt(segIdx, 10))
                            ? parseInt(segIdx, 10)
                            : null,
                          mode: "startAtFrame",
                        }
                      : null,
                  });
                }}
                placeholder="layerId:segmentIndex"
              />
            </label>
          </div>
        </div>
      );
    }

    const targetLayerType =
      selectedSegmentLane === "foreground"
        ? LAYER_TYPES.CUTOUT
        : selectedSegmentLane === "background"
        ? LAYER_TYPES.BASE
        : String(selectedSegmentLane).startsWith("caps")
        ? LAYER_TYPES.CAPTIONS
        : LAYER_TYPES.STILLS;
    const targetLayer = layers.find((l) => l.type === targetLayerType);
    const inspectedSeg = targetLayer?.segments?.[selectedSegmentIndex] || null;
    const segPayload = inspectedSeg?.payload || {};
    const meta =
      selectedSegmentLane === "foreground" || selectedSegmentLane === "background"
        ? layerBeatMetadata[selectedSegmentIndex] || {}
        : {};
    const { start, end } = getSegmentBounds(selectedSegmentIndex, selectedSegmentLane);
    const { match: rapidMatch } = findRapidForSegment(selectedSegmentLane, selectedSegmentIndex);
    const clipSlot = segPayload || {};
    const guidelineTags = segPayload.guidelineTags || [];
    const isIntroSegment = false;
    const isCaptionLane = String(selectedSegmentLane).startsWith("caps");
    const inspectedCaptionSegment = isCaptionLane ? captionSegmentsDetailed[selectedSegmentIndex] : null;
    const handleTimeBlur = () => handleApplySegmentTimes();
    const handleTimeKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleApplySegmentTimes();
      }
    };

    return (
      <div
        className={`grid auto-rows-min grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${gridGap} ${
          compact ? "text-xs" : "text-sm"
        } text-white`}
      >
        {!isCaptionLane && targetLayerType !== LAYER_TYPES.STILLS && (
          <div className="col-span-full">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-100 rounded-md border border-black/60 bg-[#0b0b0b] p-2">
              <span className="px-2 py-1 rounded border border-gray-700 bg-gray-900 font-semibold">
                Segment {selectedSegmentIndex + 1}
              </span>
              <span className="px-2 py-1 rounded border border-gray-700 bg-gray-900 font-mono">
                {start.toFixed(3)}s → {end.toFixed(3)}s
              </span>
              <span className="px-2 py-1 rounded border border-gray-700 bg-gray-900">
                {selectedSegmentLane === "foreground" ? "Cutout layer" : "Base layer"}
              </span>
              <button
                onClick={handlePlaySegment}
                className="px-2 py-1 rounded border border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-600 text-[11px] font-semibold"
              >
                {isSegmentPreviewing && isPlaying ? "Pause" : "Play"}
              </button>
              <button
                onClick={() => handlePauseToggle(selectedSegmentIndex, !segPayload.pauseMusic)}
                className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                  segPayload.pauseMusic
                    ? "border-amber-500 bg-amber-700 text-white"
                    : "border-gray-700 bg-gray-800 text-slate-200"
                }`}
              >
                {segPayload.pauseMusic ? "Music paused" : "Pause music"}
              </button>
              <button
                onClick={(e) =>
                  openRapidModalForSegment(
                    selectedSegmentIndex,
                    selectedSegmentLane,
                    e.currentTarget.getBoundingClientRect()
                  )
                }
                className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                  rapidMatch
                    ? "border-purple-500 bg-purple-800/70 text-white"
                    : "border-gray-700 bg-gray-800 text-slate-200"
                }`}
              >
                {rapidMatch ? "Rapid on" : "Rapid off"}
              </button>
              <div className="relative">
                <button
                  onClick={() => setGuidelineDropdownOpen((o) => !o)}
                  className="px-2 py-1 rounded border border-gray-700 bg-gray-800 text-[11px] text-slate-200 hover:bg-gray-700"
                >
                  {guidelineTags.length ? `Tags (${guidelineTags.length})` : "Tags"}
                </button>
                {guidelineDropdownOpen && (
                  <div className="absolute z-30 mt-1 w-48 rounded border border-black/60 bg-[#0b0b0b] shadow-lg p-1 space-y-1">
                    {guidelineTagOptions.map((preset) => {
                      const isActive = guidelineTags.includes(preset.value);
                      return (
                        <button
                          key={preset.value}
                          onClick={() => handleGuidelineTagToggle(selectedSegmentIndex, preset.value)}
                          className={`w-full text-left px-2 py-1 rounded text-[11px] border ${
                            isActive
                              ? "bg-emerald-700/40 border-emerald-500 text-emerald-100"
                              : "bg-gray-800 border-gray-700 text-slate-300 hover:bg-gray-700"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleDeleteSegmentVideo(selectedSegmentIndex, selectedSegmentLane)}
                className="px-2 py-1 rounded border border-red-600 bg-red-800/70 text-white text-[11px] font-semibold hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {!compact && (
          <div className="col-span-full text-xs font-semibold">
            {isCaptionLane
              ? `Caption ${selectedSegmentIndex + 1}`
              : `Segment ${selectedSegmentIndex} • ${selectedSegmentLane === "foreground" ? "Cutout" : "Base"}`}
          </div>
        )}

        {isCaptionLane && inspectedCaptionSegment && (
          <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-3 border border-white/40 rounded-lg p-3 bg-black/50">
            <div className="space-y-2">
              <label className="text-xs text-white space-y-1">
                <span>Caption text</span>
                <input
                  className="w-full rounded bg-white text-black border border-white px-2 py-1 text-sm"
                  value={inspectedCaptionSegment.text}
                  onChange={(e) => handleCaptionSegmentTextChange(selectedSegmentIndex, e.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white">
                <button
                  onClick={() => handleCaptionSegmentResetText(selectedSegmentIndex)}
                  className="px-2 py-1 rounded border border-white text-white bg-transparent hover:bg-white/10"
                >
                  Reset to original
                </button>
                {inspectedCaptionSegment.originalText &&
                  inspectedCaptionSegment.originalText !== inspectedCaptionSegment.text && (
                    <span className="text-emerald-200 text-[10px]">Original: {inspectedCaptionSegment.originalText}</span>
                  )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white space-y-1">
                <span>Caption mode</span>
                <select
                  className="w-full rounded bg-black border border-white px-2 py-1 text-sm text-white"
                  value={inspectedCaptionSegment.captionMode}
                  onChange={(e) => handleCaptionSegmentModeChange(selectedSegmentIndex, e.target.value)}
                >
                  <option value="preset">Preset</option>
                  <option value="lyrics">Lyrics</option>
                  <option value="clip">Clip</option>
                </select>
              </label>
              <div className="text-[11px] text-slate-300 space-y-1">
                <div>Start: {formatSecondsLabel(inspectedCaptionSegment.startSeconds)}s</div>
                <div>End: {formatSecondsLabel(inspectedCaptionSegment.endSeconds)}s</div>
              </div>
            </div>
          </div>
        )}

        {!compact && (
          <div className="col-span-full text-xs text-white">
            {start.toFixed(3)}s → {end.toFixed(3)}s
          </div>
        )}

        <div
          className={
            compact
              ? "col-span-full flex flex-wrap items-end gap-2"
              : "col-span-full grid grid-cols-1 md:grid-cols-4 gap-2 items-end"
          }
        >
          <label className={`${textSize} text-white space-y-1`}>
            <span>Start (s)</span>
            <input
              className={`w-full rounded bg-white text-black border border-white ${smallPad} ${inputText}`}
              value={segmentTimeDraft.start}
              onChange={(e) => setSegmentTimeDraft((prev) => ({ ...prev, start: e.target.value }))}
              onBlur={handleTimeBlur}
              onKeyDown={handleTimeKeyDown}
            />
          </label>
          <label className={`${textSize} text-white space-y-1`}>
            <span>End (s)</span>
            <input
              className={`w-full rounded bg-white text-black border border-white ${smallPad} ${inputText}`}
              value={segmentTimeDraft.end}
              onChange={(e) => setSegmentTimeDraft((prev) => ({ ...prev, end: e.target.value }))}
              onBlur={handleTimeBlur}
              onKeyDown={handleTimeKeyDown}
            />
          </label>
          <label className={`${textSize} text-slate-300 space-y-1`}>
            <div className="flex items-center justify-between">
              <span>Clip vol</span>
              <span className="text-slate-200 font-semibold">
                {Math.round((clipSlot.clipVolume ?? 1) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={clipSlot.clipVolume ?? 1}
              onChange={(e) =>
                isIntroSegment
                  ? handleIntroClipVolumeChange("clipVolume", parseFloat(e.target.value))
                  : handleClipVolumeChange(selectedSegmentIndex, "clipVolume", parseFloat(e.target.value))
              }
              className="w-40 h-1 accent-emerald-500"
            />
          </label>
          <label className={`${textSize} text-slate-300 space-y-1`}>
            <div className="flex items-center justify-between">
              <span>Music vol</span>
              <span className="text-slate-200 font-semibold">
                {Math.round((clipSlot.musicVolume ?? 1) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={clipSlot.musicVolume ?? 1}
              onChange={(e) =>
                isIntroSegment
                  ? handleIntroClipVolumeChange("musicVolume", parseFloat(e.target.value))
                  : handleClipVolumeChange(selectedSegmentIndex, "musicVolume", parseFloat(e.target.value))
              }
              className="w-40 h-1 accent-amber-500"
            />
          </label>
          {!compact && segmentTimeError && (
            <div className="text-[11px] text-red-300 flex items-center">{segmentTimeError}</div>
          )}
        </div>

        {/* Layer toggles and max clip controls removed for compact view */}

        {/* Rapid range controls removed */}

        {/* Delete segment control removed */}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white overflow-hidden">
      {/* Header */}
      <header className="border-b border-black/60 bg-[#0b0b0b]">
        <div className="w-full px-3 lg:px-4 py-2">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-slate-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
                Format Builder 2
              </h1>
              <p className="text-xs text-slate-400">
                Edge-to-edge editor for timing and segments
              </p>
            </div>
            {hasUnsavedChanges && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-900/60 text-amber-100 border border-amber-700">
                Unsaved
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="w-full px-2 lg:px-3 py-3 space-y-3 overflow-hidden">
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

        {/* Song selector and mode */}
        <div className="bg-[#121212] border border-black/60 rounded-lg p-2 shadow-inner">
          <div className="flex items-stretch gap-2">
            <div className="flex-1 min-w-0">
              {isImportMode ? (
                <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-sm">
                  <div className="text-emerald-200 font-semibold">Imported video</div>
                  <div className="text-emerald-100/80 break-words">
                    Job: {importJobId}
                    {selectedSong?.path ? ` · Source: ${selectedSong.path}` : ""}
                  </div>
                </div>
              ) : (
                <SongSelector
                  selectedSong={selectedSong}
                  onSelect={handleSongSelect}
                  disabled={loading}
                  defaultSlug={initialSongSlug}
                />
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-black/60 bg-[#0b0b0b]">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">Mode</span>
              <span className="px-3 py-1.5 text-xs font-semibold rounded-md border bg-amber-600 text-white border-amber-500">
                Editor
              </span>
            </div>
          </div>
        </div>

        {importError && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm flex flex-col gap-2">
            <div className="text-red-200 font-semibold">Unable to load imported video</div>
            <div className="text-red-100/80 break-words">{importError}</div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-1.5 rounded-md bg-white/10 text-white border border-white/20 hover:bg-white/15"
                onClick={() => {
                  setImportJobId(null);
                  setImportError(null);
                  setImportPlan(null);
                  // No legacy sample fallback; user must pick a valid song source.
                }}
              >
                Retry import
              </button>
            </div>
          </div>
        )}

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
          <div>
            <div className="bg-[#111111] border border-black/60 rounded-lg p-2 shadow-inner">
              <div className="flex items-center gap-1.5 flex-nowrap whitespace-nowrap overflow-hidden text-[10px] leading-tight">
                <button
                  onClick={handleResetBase}
                  className="px-2.5 py-1 bg-red-900/60 hover:bg-red-900/70 text-red-100 font-semibold rounded-md transition-colors border border-red-800 flex-0"
                >
                  Reset Base
                </button>
                <button
                  onClick={handleRenderCaptions}
                  disabled={renderLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-semibold rounded-md transition-colors border border-emerald-700 flex-0"
                >
                  {renderLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Rendering...
                    </>
                  ) : (
                    <div className="space-y-3">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M5 3l14 9-14 9V3z" />
                      </svg>
                      Re-render video
                    </div>
                  )}
                </button>

                <div className="h-6 w-px bg-black/40 flex-0" />

                <button
                  onClick={handlePlayPause}
                  className="flex items-center justify-center w-9 h-9 rounded-md border border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm flex-0"
                >
                  {isPlaying ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <div className="flex items-center gap-1.5 rounded-md border border-black/50 bg-[#161616] px-2 py-1 flex-0">
                  <span className="text-[10px] text-slate-400 font-semibold">Time</span>
                  <span className="px-1.5 py-0.5 rounded bg-black/60 font-mono text-amber-100 border border-black/50">
                    {formatSecondsLabel(currentTime)}s
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-md border border-black/50 bg-[#161616] px-2 py-1 flex-0">
                  <span className="text-[10px] text-slate-400 font-semibold">Target</span>
                  <span className="px-1.5 py-0.5 rounded font-semibold border border-amber-500/60 bg-amber-900/30 text-amber-100">
                    {activeLayerLabel}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-md border border-black/50 bg-[#161616] px-2 py-1 flex-0">
                  <span className="text-[10px] text-slate-400 font-semibold">Editing</span>
                  <span
                    className={`px-2 py-0.5 rounded font-semibold border ${
                      activeLayer === "foreground"
                        ? "bg-emerald-900/70 text-emerald-100 border-emerald-700"
                        : "bg-amber-900/70 text-amber-100 border-amber-700"
                    }`}
                  >
                    {activeLayer === "foreground" ? "Cutout layer" : "Base layer"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 rounded-md border border-black/50 bg-[#161616] px-2 py-1 flex-0">
                  <span className="text-[10px] text-slate-400 font-semibold">Add layer</span>
                  <select
                    className="bg-black text-white px-2 py-1 rounded border border-gray-700 text-[10px]"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        handleAddLayer(val);
                        e.target.value = "";
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    <option value={LAYER_TYPES.BASE}>Video</option>
                    <option value={LAYER_TYPES.CUTOUT}>Cutout</option>
                    <option value={LAYER_TYPES.CAPTIONS}>Captions</option>
                    <option value={LAYER_TYPES.STILLS}>Stills</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 border border-black/60 rounded-md bg-[#0d0d0d] px-2 py-1 flex-0">
                  <span className="px-1.5 py-0.5 rounded border border-black/50 bg-black/60">Space: Play/Pause</span>
                  <span className="px-1.5 py-0.5 rounded border border-black/50 bg-black/60">M: Add Mark</span>
                  <span className="px-1.5 py-0.5 rounded border border-black/50 bg-black/60">←/→ Seek</span>
                </div>

                <button
                  onClick={() => setWaveformModalOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-900/60 hover:bg-indigo-800 text-indigo-100 rounded border border-indigo-700/70 transition-colors flex-0"
                  title="Waveform status and actions"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h2l2 12 2-10 2 10 2-12 2 12h2" />
                  </svg>
                  Waveform
                  {waveformLoading && (
                    <span className="text-[10px] text-slate-200">Loading…</span>
                  )}
                  {!waveformLoading && waveformData && (
                    <span className="text-[10px] text-emerald-200">
                      Ready{waveformData.savedAt ? ` • ${new Date(waveformData.savedAt).toLocaleDateString()}` : ""}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-3">
                <div className="bg-[#121212] border border-black/60 rounded-lg p-2 shadow-inner">
                  <div className="grid grid-rows-[minmax(450px,1fr)_auto] gap-2 min-h-[620px]">
                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-2 items-stretch overflow-hidden">
                      <div className="flex flex-col h-full min-h-0 gap-2">

                        {sortedLayers.some((l) => l.type === LAYER_TYPES.STILLS) && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200 border border-black/60 rounded-md p-2 bg-[#0d0d0d] shrink-0">
                            <span className="text-slate-400 font-semibold">Stills</span>
                            <button
                              onClick={handleAddStill}
                              className="px-3 py-1 rounded border border-emerald-600 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-100"
                            >
                              Add still
                            </button>
                            <span className="text-slate-500">
                              Total: {stills?.length ? stills.length : 0}
                            </span>
                          </div>
                        )}

                        <div className="flex-1 min-h-0 rounded-lg border border-black/60 bg-[#121212] p-3 overflow-hidden">
                          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
                            <div className="flex items-center gap-2">
                              <span className="uppercase tracking-wide text-[11px] text-slate-500">Inspector</span>
                              {selectedLayer && (
                                <span className="px-2 py-1 rounded border border-gray-700 bg-gray-900/80 text-slate-100 text-[11px]">
                                  {selectedLayer.name || selectedLayer.label || "Layer"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {selectedLayer && (
                                <button
                                  onClick={() => setLayerInspectorOpen(true)}
                                  className={`px-2 py-1 rounded-md border text-[11px] font-semibold ${
                                    layerInspectorOpen
                                      ? "bg-emerald-700 text-white border-emerald-500"
                                      : "bg-gray-800 text-slate-200 border-gray-700 hover:bg-gray-700"
                                  }`}
                                >
                                  Layer settings
                                </button>
                              )}
                              <button
                                onClick={() => setLayerInspectorOpen(false)}
                                className={`px-2 py-1 rounded-md border text-[11px] font-semibold ${
                                  !layerInspectorOpen
                                    ? "bg-emerald-700 text-white border-emerald-500"
                                    : "bg-gray-800 text-slate-200 border-gray-700 hover:bg-gray-700"
                                }`}
                              >
                                Segment settings
                              </button>
                            </div>
                          </div>

                          <div className="h-full overflow-y-auto">
                            {layerInspectorOpen ? (
                              <>
                                <div className="text-xs text-slate-400 mb-2">Global Layer Setting</div>
                                <div className="rounded-md border border-gray-800 bg-gray-950/80 p-3 mb-4">
                                  {selectedLayer ? (
                                    <>
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="space-y-0.5">
                                          <div className="text-sm text-white font-semibold">
                                            {selectedLayer.name || selectedLayer.label || "Selected layer"}
                                          </div>
                                          <div className="text-xs text-slate-400">
                                            {selectedLayer.type} • {Array.isArray(selectedLayer.segments) ? selectedLayer.segments.length : 0} segments
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={handleApplySelectedSegmentToLayer}
                                            disabled={!Array.isArray(selectedLayer.segments) || !selectedLayer.segments.length}
                                            className="px-3 py-1.5 rounded-md text-xs font-semibold border border-amber-500 bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                          >
                                            Apply selected segment settings to layer
                                          </button>
                                          <button
                                            onClick={() => {
                                              if (!selectedLayer?.id) return;
                                              const ok = window.confirm(
                                                `Delete layer “${selectedLayer.name || selectedLayer.label || "Layer"}”? This removes the layer and its settings. Generated lyric data will be kept.`
                                              );
                                              if (!ok) return;
                                              handleDeleteLayer(selectedLayer.id);
                                            }}
                                            className="px-3 py-1.5 rounded-md text-xs font-semibold border border-red-500 bg-red-900/60 text-red-100 hover:bg-red-800"
                                          >
                                            Delete layer
                                          </button>
                                        </div>
                                      </div>
                                      {(selectedLayer.type === LAYER_TYPES.CUTOUT || selectedLayer.type === LAYER_TYPES.BASE) && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-200 mt-3">
                                          <label className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-400">Clip volume</span>
                                              <span className="text-slate-200 font-semibold">
                                                {Math.round((selectedLayer.segments?.[0]?.payload?.clipVolume ?? 1) * 100)}%
                                              </span>
                                            </div>
                                            <input
                                              type="range"
                                              min="0"
                                              max="1"
                                              step="0.01"
                                              value={selectedLayer.segments?.[0]?.payload?.clipVolume ?? 1}
                                              onChange={(e) => handleLayerGlobalVolumeChange(selectedLayer.id, "clipVolume", e.target.value)}
                                              className="w-full accent-emerald-500"
                                            />
                                          </label>
                                          <label className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-400">Music volume</span>
                                              <span className="text-slate-200 font-semibold">
                                                {Math.round((selectedLayer.segments?.[0]?.payload?.musicVolume ?? 1) * 100)}%
                                              </span>
                                            </div>
                                            <input
                                              type="range"
                                              min="0"
                                              max="1"
                                              step="0.01"
                                              value={selectedLayer.segments?.[0]?.payload?.musicVolume ?? 1}
                                              onChange={(e) => handleLayerGlobalVolumeChange(selectedLayer.id, "musicVolume", e.target.value)}
                                              className="w-full accent-amber-500"
                                            />
                                          </label>
                                        </div>
                                      )}
                                      <div className="text-[11px] text-slate-400 mt-2">
                                        Click a layer&apos;s grab handle to select it. Updates here apply to every segment in this layer.
                                      </div>
                                      {selectedLayer.type === LAYER_TYPES.CAPTIONS && (
                                        <div className="text-[11px] text-indigo-200 mt-1">
                                          Caption-wide edits mirror the caption segment controls below.
                                        </div>
                                      )}
                                      <div className="mt-3 space-y-1 max-h-48 overflow-y-auto pr-1">
                                        {Array.isArray(selectedLayer.segments) && selectedLayer.segments.length ? (
                                          selectedLayer.segments.map((seg, idx) => {
                                            const startLabel = formatSecondsLabel((Number(seg.startMs) || 0) / 1000);
                                            const endLabel = formatSecondsLabel((Number(seg.endMs) || Number(seg.startMs) || 0) / 1000);
                                            return (
                                              <div
                                                key={seg.id || idx}
                                                className="flex items-center justify-between gap-2 rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5"
                                              >
                                                <div className="flex flex-col">
                                                  <span className="text-xs text-slate-200 font-semibold">
                                                    Segment {Number.isInteger(seg.displayIndex) ? seg.displayIndex : (Number.isInteger(seg.index) ? seg.index + 1 : idx + 1)}
                                                  </span>
                                                  <span className="text-[11px] text-slate-400 font-mono">
                                                    {startLabel}s → {endLabel}s
                                                  </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    onClick={() => handleSelectLayerSegmentFromGlobal(selectedLayer, seg, idx)}
                                                    className="px-2 py-1 rounded text-[11px] bg-gray-800 text-slate-200 hover:bg-gray-700 border border-gray-700"
                                                  >
                                                    Open segment
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })
                                        ) : (
                                          <div className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/60 px-3 py-2">
                                            <div className="flex flex-col">
                                              <span className="text-sm text-slate-500">No segments on this layer.</span>
                                              <span className="text-[11px] text-slate-400">Add a full-length segment covering the whole song.</span>
                                            </div>
                                            <button
                                              onClick={() => handleAddFullSegmentForLayer(selectedLayer.id, selectedLayer.type)}
                                              className="px-3 py-1.5 text-xs rounded-md bg-emerald-700 text-white hover:bg-emerald-600"
                                            >
                                              Add full-length segment
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-sm text-slate-500">
                                      Select a layer name or grab handle to view global settings.
                                    </div>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="flex flex-col h-full overflow-hidden">
                                <div className="text-xs text-slate-400 mb-2">Segment Setting</div>
                                <div className="flex-1 min-h-0 overflow-y-auto border border-black/60 rounded-md bg-[#0b0b0b] p-2">
                                  {isImportMode && clipMapImport && selectedSegment ? (
                                    <ImportSegmentDetails
                                      segment={selectedSegment}
                                      clipMap={clipMapImport}
                                    />
                                  ) : (
                                    renderSegmentSettings()
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col h-full min-h-0 gap-2">
                        <div className="flex-1 rounded-md border border-black/60 bg-[#0b0b0b] p-3 h-full shadow-inner flex items-center justify-center min-h-[360px]">
                          <div className="w-full h-full max-w-[720px]">
                            {isImportMode && clipTimelineSegments.length ? (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between text-xs text-slate-300">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-1 rounded-md bg-black/50 border border-gray-800 font-semibold">
                                      Clip {importClipIndex + 1} / {clipTimelineSegments.length}
                                    </span>
                                    <span className="text-slate-500">
                                      {clipTimelineSegments[importClipIndex]?.start.toFixed(2)}s →{" "}
                                      {clipTimelineSegments[importClipIndex]?.end.toFixed(2)}s (
                                      {clipTimelineSegments[importClipIndex]?.duration.toFixed(2)}s)
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => setImportClipIndex((i) => Math.max(0, i - 1))}
                                      disabled={importClipIndex === 0}
                                      className={`px-2 py-1 rounded-md border text-xs font-semibold ${
                                        importClipIndex === 0
                                          ? "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
                                          : "border-gray-700 bg-gray-800 text-slate-200 hover:bg-gray-700"
                                      }`}
                                    >
                                      Prev
                                    </button>
                                    <button
                                      onClick={() =>
                                        setImportClipIndex((i) => Math.min(clipTimelineSegments.length - 1, i + 1))
                                      }
                                      disabled={importClipIndex >= clipTimelineSegments.length - 1}
                                      className={`px-2 py-1 rounded-md border text-xs font-semibold ${
                                        importClipIndex >= clipTimelineSegments.length - 1
                                          ? "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
                                          : "border-gray-700 bg-gray-800 text-slate-200 hover:bg-gray-700"
                                      }`}
                                    >
                                      Next
                                    </button>
                                  </div>
                                </div>

                                <div className="rounded-xl border border-gray-700 bg-black overflow-hidden aspect-video relative">
                                  {clipTimelineSegments[importClipIndex]?.mp4Url ? (
                                    <video
                                      ref={importVideoRef}
                                      key={`${clipTimelineSegments[importClipIndex].id}-${clipTimelineSegments[importClipIndex].start}`}
                                      src={clipTimelineSegments[importClipIndex].mp4Url}
                                      controls={false}
                                      className="w-full h-full"
                                      preload="auto"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                                      No preview for this clip
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <EditTester
                                songPath={selectedSong.path}
                                marks={baseSegments.slice(1).map((s) => s.start)}
                                rapidClipRanges={format?.rapidClipRanges || []}
                                foregroundMarks={foregroundSegments.slice(1).map((s) => s.start)}
                                foregroundRapidClipRanges={foregroundLayer?.rapidClipRanges || []}
                                foregroundEnabled={cutoutEnabled}
                                fps={format.meta?.targetFps || 30}
                                externalAudioRef={audioRef}
                                externalIsPlaying={isPlaying}
                                onExternalPlayChange={setIsPlaying}
                                onExternalTimeUpdate={handleExternalTimeUpdate}
                                onExternalDuration={setDuration}
                                captions={captionsEnabled ? format?.captions : null}
                                captionsEnabled={captionsEnabled}
                                layeredCaptions={captionsEnabled && layeredCaptions}
                                captionStyle={captionStyle}
                                hideControls
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full border border-black/60 rounded-md bg-[#0c0c0c] p-2">
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
                        onLaneReorder={handleLaneReorder}
                        onSegmentResize={handleSegmentResize}
                        onSelectLayer={handleSelectLayer}
                        selectedLayerId={selectedLayerId}
                        rapidRangesByLane={{
                          background: format?.rapidClipRanges || [],
                          foreground: foregroundLayer?.rapidClipRanges || [],
                        }}
                      />
                    </div>
                  </div>
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
                              value={captionPlacements[activeCaptionVariant] || (layeredCaptions ? "layered" : "top")}
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
                          <span className="text-slate-500">
                            • {captionSegmentsDetailed.length} caption segments
                          </span>
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
                          onClick={handleGenerateClipCaptions}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-indigo-700 text-white text-sm font-semibold hover:bg-indigo-600 disabled:opacity-60"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          Generate clip captions
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
                        <button
                          onClick={() => setShowLegacyCaptionEditor((v) => !v)}
                          className="px-3 py-1.5 rounded-md bg-gray-800 text-slate-200 text-sm font-semibold hover:bg-gray-700"
                        >
                          {showLegacyCaptionEditor ? "Hide legacy editor" : "Legacy editor"}
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
                    </div>
                    {showLegacyCaptionEditor && (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
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
                      </>
                    )}
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
                              <option value="default">Default (previewed)</option>
                              <option value="cutout">Cutout (preview limited)</option>
                              <option value="negative">Negative (not available in preview window)</option>
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
                                className="w-full h-9 rounded bg-white text-black border border-slate-300 p-1"
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

                  {selectedLayer?.type === LAYER_TYPES.CAPTIONS && (
                  <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                        Caption segments ({captionSegmentsDetailed.length})
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-[11px] text-slate-400">
                          <input
                            type="checkbox"
                            checked={segmentTimeAdjustAdjacent}
                            onChange={(e) => setSegmentTimeAdjustAdjacent(e.target.checked)}
                          />
                          Adjust neighbors
                        </label>
                        <button
                          onClick={handleAddCaptionSegment}
                          className="px-3 py-1 text-xs rounded-md bg-emerald-700 text-white hover:bg-emerald-600"
                        >
                          Add segment
                        </button>
                      </div>
                    </div>
                    {segmentTimeError && (
                      <div className="text-xs text-red-300">{segmentTimeError}</div>
                    )}
                    {captionSegmentsDetailed.length === 0 ? (
                      <div className="text-sm text-slate-500">
                        No caption segments yet. Generate captions or add a segment to begin.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {captionSegmentsDetailed.map((seg, idx) => (
                          <div
                            key={seg.id || idx}
                            className="border border-gray-800 rounded-md bg-gray-900/60 p-2 space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs text-slate-300 font-semibold">
                                Segment {idx + 1} · {formatSecondsLabel(seg.startSeconds)}s →{" "}
                                {formatSecondsLabel(seg.endSeconds)}s
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleSelectCaptionSegmentFromList(idx)}
                                  className="px-2 py-1 text-[11px] rounded bg-gray-800 text-slate-200 hover:bg-gray-700"
                                >
                                  Select in timeline
                                </button>
                                <button
                                  onClick={() => handleRemoveCaptionSegment(idx)}
                                  className="px-2 py-1 text-[11px] rounded bg-red-900/60 text-red-100 border border-red-700 hover:bg-red-800"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              <label className="text-[11px] text-slate-400 space-y-1">
                                <span>Start (s)</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className={captionInputClass}
                                  value={formatSecondsInput(seg.startMs)}
                                  onChange={(e) =>
                                    handleCaptionSegmentTimeChange(idx, "start", e.target.value)
                                  }
                                />
                              </label>
                              <label className="text-[11px] text-slate-400 space-y-1">
                                <span>End (s)</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className={captionInputClass}
                                  value={formatSecondsInput(seg.endMs)}
                                  onChange={(e) =>
                                    handleCaptionSegmentTimeChange(idx, "end", e.target.value)
                                  }
                                />
                              </label>
                              <label className="text-[11px] text-slate-400 space-y-1">
                                <span>Mode</span>
                                <select
                                  className={captionSelectClass}
                                  value={seg.captionMode || "preset"}
                                  onChange={(e) =>
                                    handleCaptionSegmentPayloadChange(
                                      idx,
                                      "captionMode",
                                      e.target.value
                                    )
                                  }
                                >
                                  <option value="preset">Preset</option>
                                  <option value="lyrics">Lyrics</option>
                                  <option value="clip">Clip</option>
                                </select>
                              </label>
                              <label className="text-[11px] text-slate-400 space-y-1">
                                <span>Placement</span>
                                <select
                                  className={captionSelectClass}
                                  value={seg.layer || captionPlacements[activeCaptionVariant] || "top"}
                                  onChange={(e) =>
                                    handleCaptionSegmentPayloadChange(idx, "layer", e.target.value)
                                  }
                                >
                                  <option value="top">Top</option>
                                  <option value="layered">Layered</option>
                                </select>
                              </label>
                              <label className="text-[11px] text-slate-400 space-y-1 md:col-span-2 lg:col-span-3">
                                <div className="flex items-center justify-between">
                                  <span>Text</span>
                                  {seg.originalText && seg.originalText !== seg.text && (
                                    <button
                                      onClick={() => handleCaptionSegmentResetText(idx)}
                                      className="text-[11px] text-emerald-300 hover:text-emerald-200"
                                    >
                                      Reset to original
                                    </button>
                                  )}
                                </div>
                                <textarea
                                  className={`${captionInputClass} h-20 resize-none`}
                                  value={seg.text}
                                  onChange={(e) =>
                                    handleCaptionSegmentPayloadChange(idx, "text", e.target.value)
                                  }
                                />
                                {seg.originalText && (
                                  <div className="text-[10px] text-slate-500">
                                    Original: {seg.originalText}
                                  </div>
                                )}
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  )}

                {selectedLayer?.type === LAYER_TYPES.CAPTIONS && showLegacyCaptionEditor && (
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
                                  {/* Removed per-item layer toggle row */}
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
                                  {entry.type === "word" && (
                                    <div className="flex flex-col text-[11px] text-slate-300 md:col-span-2 gap-1">
                                      {(() => {
                                        const ctx = findLineForWord(entry.data);
                                        if (!ctx) return <span>No line context</span>;
                                        return (
                                          <>
                                            <span>
                                              Line {ctx.index + 1} · {formatSecondsLabel((ctx.line.startMs ?? 0) / 1000)}s →{" "}
                                              {formatSecondsLabel((ctx.line.endMs ?? ctx.line.startMs ?? 0) / 1000)}s
                                            </span>
                                            <button
                                              onClick={() => handleConvertWordToLine(entry.data.index)}
                                              className="px-2 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-xs"
                                            >
                                              Convert to line (merge words in this range)
                                            </button>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  )}
                                  {entry.type === "line" && (
                                    <div className="flex flex-col text-[11px] text-slate-300 md:col-span-2 gap-1">
                                      <span>
                                        {entry.data.text ? entry.data.text.length : 0} chars · {formatSecondsLabel((entry.data.startMs ?? 0) / 1000)}s →{" "}
                                        {formatSecondsLabel((entry.data.endMs ?? entry.data.startMs ?? 0) / 1000)}s
                                      </span>
                                      <button
                                        onClick={() => handleConvertLineToWords(entry.data.index)}
                                        className="px-2 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-xs"
                                      >
                                        Convert to words (split this line)
                                      </button>
                                    </div>
                                  )}
                                  {/* Removed per-entry layer display/toggle */}
                                  {entry.type === "word" && (
                                    <div className="flex flex-col text-[11px] text-slate-300 md:col-span-2 gap-1">
                                      {(() => {
                                        const ctx = findLineForWord(entry.data);
                                        if (!ctx) return <span>No line context</span>;
                                        return (
                                          <>
                                            <span>
                                              Line {ctx.index + 1} · {formatSecondsLabel((ctx.line.startMs ?? 0) / 1000)}s →{" "}
                                              {formatSecondsLabel((ctx.line.endMs ?? ctx.line.startMs ?? 0) / 1000)}s
                                            </span>
                                            <button
                                              onClick={() => handleConvertWordToLine(entry.data.index)}
                                              className="px-2 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-xs"
                                            >
                                              Convert to line (merge words in this range)
                                            </button>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  )}
                                  {entry.type === "line" && (
                                    <div className="flex flex-col text-[11px] text-slate-300 md:col-span-2 gap-1">
                                      <span>
                                        {entry.data.text ? entry.data.text.length : 0} chars · {formatSecondsLabel((entry.data.startMs ?? 0) / 1000)}s →{" "}
                                        {formatSecondsLabel((entry.data.endMs ?? entry.data.startMs ?? 0) / 1000)}s
                                      </span>
                                      <button
                                        onClick={() => handleConvertLineToWords(entry.data.index)}
                                        className="px-2 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-xs"
                                      >
                                        Convert to words (split this line)
                                      </button>
                                    </div>
                                  )}
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
                )}

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

              {selectedLayer && (selectedLayer.type === LAYER_TYPES.BASE || selectedLayer.type === LAYER_TYPES.CUTOUT) && (
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-3 space-y-3">
                  {isImportMode && clipMapImport ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white">Clip map (imported)</h3>
                        <span className="text-[11px] text-slate-400">From Quick Edit</span>
                      </div>
                      <ClipMapViewer clipMap={clipMapImport} overrides={{}} setOverrides={() => {}} readonly />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 mb-2">
                        <h3 className="text-sm font-semibold text-white">Segment Guidelines & Scheduling</h3>
                        <p className="text-xs text-slate-500">
                          Tag segments with guideline tags, dialogue/visual/iconic/B-roll needs, and pause/trim rules.
                        </p>
                      </div>

                      <div className="mb-3 rounded-lg border border-gray-800/80 bg-gray-900/60 p-2 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Global Segment Levels</h4>
                            <p className="text-xs text-slate-500">
                              Adjust once to update Segment 0 and every segment below. Fine-tune individual segments afterward if needed.
                            </p>
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            {Math.round(globalVolumes.clipVolume * 100)}% clip · {Math.round(globalVolumes.musicVolume * 100)}% music
                          </div>
                        </div>

                        <div className="grid gap-2 md:grid-cols-2">
                          <label className="text-xs text-slate-400 space-y-1">
                            <div className="flex items-center justify-between">
                              <span>Clip loudness (dialogue, fx, VO)</span>
                              <span className="text-slate-300 font-mono">{(globalVolumes.clipVolume * 100).toFixed(0)}%</span>
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
                              <span className="text-slate-300 font-mono">{(globalVolumes.musicVolume * 100).toFixed(0)}%</span>
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
                        <div className="space-y-3">
                          <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                            {guidelineEntries.map((entry) => (
                              <div
                                key={entry.isIntro ? "segment-guideline-intro" : `segment-guideline-${entry.index}`}
                                className="border border-gray-800 rounded-lg p-2 bg-gray-900/50 space-y-2"
                              >
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                  <div className="text-xs font-semibold text-slate-200">
                                    Segment {entry.displayIndex} · {entry.time.toFixed(3)}s → {(entry.time + entry.duration).toFixed(3)}s
                                    <span className="ml-2 text-xs text-slate-400">{entry.duration.toFixed(2)}s window</span>
                                    {entry.isIntro && entry.metadata?.label && (
                                      <span className="ml-2 text-xs font-semibold text-amber-300">{entry.metadata.label}</span>
                                    )}
                                  </div>
                                  <label className="text-xs text-slate-400 flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={entry.metadata?.clipSlot?.pauseMusic || false}
                                      onChange={(e) =>
                                        entry.isIntro ? handleIntroPauseToggle(e.target.checked) : handlePauseToggle(entry.index, e.target.checked)
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
                                      {guidelineTagOptions.map((preset) => {
                                        const isActive = entry.metadata?.guidelineTags?.includes(preset.value) || false;
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
                                    <div className="flex items-center justify-between">
                                      <span>Clip volume</span>
                                      <span className="text-slate-300">
                                        {(((entry.metadata?.clipSlot?.clipVolume ?? 1) * 100) || 0).toFixed(0)}%
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
                                          ? handleIntroClipVolumeChange("clipVolume", parseFloat(e.target.value))
                                          : handleClipVolumeChange(entry.index, "clipVolume", parseFloat(e.target.value))
                                      }
                                      className="w-full"
                                    />
                                  </label>
                                  <label className="text-xs text-slate-400 space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span>Music under this segment</span>
                                      <span className="text-slate-300">
                                        {(((entry.metadata?.clipSlot?.musicVolume ?? 1) * 100) || 0).toFixed(0)}%
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
                                          ? handleIntroClipVolumeChange("musicVolume", parseFloat(e.target.value))
                                          : handleClipVolumeChange(entry.index, "musicVolume", parseFloat(e.target.value))
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
                              Add cuts to plan guidelines beyond Cut 0.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
        </div>
      )}

        {/* Empty state */}
        {!selectedSong && !loading && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🎵</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Select a Song to Get Started
            </h2>
            <p className="text-slate-400 max-w-md mx-auto">
              Choose a song from the dropdown above to begin creating a segment map.
              Add cuts in real-time while the song plays, or define rapid clip ranges.
            </p>
          </div>
        )}

        {/* Rapid interval modal */}
        {rapidModal && (
          <div className="fixed inset-0 z-50 pointer-events-none">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
              onClick={closeRapidModal}
            />
            <div
              className="absolute pointer-events-auto w-[280px] sm:w-[320px] bg-gray-950 border border-purple-600/60 rounded-lg shadow-2xl p-4 space-y-3"
              style={rapidModalStyle}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">Rapid segment</div>
                  <div className="text-xs text-slate-400">
                    {rapidModal.lane === "foreground" ? "Cutout layer" : "Base video"}
                  </div>
                </div>
                <button
                  onClick={closeRapidModal}
                  className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded"
                >
                  ✕
                </button>
              </div>
              {rapidModalBounds && (
                <div className="text-xs text-slate-300">
                  {rapidModalBounds.start.toFixed(3)}s → {rapidModalBounds.end.toFixed(3)}s
                </div>
              )}
              <label className="flex flex-col gap-1 text-xs text-slate-200">
                Interval (s)
                <input
                  type="number"
                  step="0.01"
                  min={minRapidInterval}
                  value={rapidModal.interval ?? ""}
                  onChange={(e) =>
                    handleRapidModalIntervalChange(parseFloat(e.target.value) || 0)
                  }
                  className="rounded-md border border-purple-600/70 bg-white text-black px-3 py-2 text-sm focus:outline-none focus:border-purple-400"
                />
                <span className="text-[11px] text-slate-400">
                  Min interval: {minRapidInterval.toFixed(3)}s (or one frame)
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2 justify-end">
                {rapidModal.hasExisting && (
                  <button
                    onClick={handleRapidModalDisable}
                    className="px-3 py-2 text-xs font-semibold rounded border border-red-600 bg-red-900 text-white hover:bg-red-800"
                  >
                    Disable rapid
                  </button>
                )}
                <button
                  onClick={closeRapidModal}
                  className="px-3 py-2 text-xs font-semibold rounded border border-gray-700 bg-gray-800 text-slate-200 hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRapidModalSave}
                  className="px-3 py-2 text-xs font-semibold rounded border border-purple-500 bg-purple-700 text-white hover:bg-purple-600"
                >
                  Save
                </button>
              </div>
            </div>
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
                          <option value="default">Default (previewed)</option>
                          <option value="cutout">Cutout (preview limited)</option>
                          <option value="negative">Negative (not available in preview window)</option>
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
                              className="w-full h-9 rounded bg-white text-black border border-slate-300 p-1"
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

      {/* Waveform modal */}
      {waveformModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="w-full max-w-md bg-[#0c0c0c] border border-gray-800 rounded-xl p-4 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Waveform</h3>
              <button
                onClick={() => setWaveformModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded"
              >
                Close
              </button>
            </div>
            <div className="text-sm text-slate-300 space-y-1">
              <div className="flex items-center gap-2">
                {waveformLoading ? (
                  <>
                    <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
                    <span>{regeneratingWaveform ? "Regenerating waveform..." : "Loading waveform..."}</span>
                  </>
                ) : waveformData ? (
                  <>
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Waveform ready</span>
                    {waveformData.savedAt && (
                      <span className="text-slate-500">
                        • {new Date(waveformData.savedAt).toLocaleString()}
                      </span>
                    )}
                  </>
                ) : (
                  <span>No waveform data</span>
                )}
              </div>
              {hasWaveformBackup && (
                <p className="text-xs text-slate-500">Backup available</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasWaveformBackup && (
                <button
                  onClick={handleUndoWaveform}
                  disabled={waveformLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs bg-[#191919] hover:bg-[#222] disabled:opacity-50 text-slate-200 hover:text-white rounded border border-black/60 transition-colors"
                  title="Restore previous waveform"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  Undo
                </button>
              )}
              <button
                onClick={handleRegenerateWaveform}
                disabled={waveformLoading || regeneratingWaveform}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs bg-indigo-900/60 hover:bg-indigo-800 disabled:opacity-50 text-indigo-100 hover:text-white rounded border border-indigo-700/60 transition-colors"
                title="Re-analyze audio and regenerate waveform"
              >
                {regeneratingWaveform ? (
                  <>
                    <div className="w-3 h-3 border border-indigo-300 border-t-transparent rounded-full animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
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
                                      <option value="default">Default (previewed)</option>
                                      <option value="cutout">Cutout (preview limited)</option>
                                      <option value="negative">Negative (not available in preview window)</option>
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
                          className="w-full h-9 rounded bg-white text-black border border-slate-300 p-1"
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

