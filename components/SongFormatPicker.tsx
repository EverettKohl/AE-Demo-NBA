"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";

const formatSeconds = (seconds) => {
  if (!seconds || Number.isNaN(seconds)) return "0:00";
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${mins}:${secs}`;
};

const badge = (label, value) => (
  <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/80 ring-1 ring-white/10">
    <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]" />
    <span className="uppercase tracking-[0.15em] text-[10px] text-white/60">{label}</span>
    <span>{value}</span>
  </span>
);

const SongFormatPicker = ({
  label = "Song format",
  helper = "Pick a track to score the edit.",
  formats = [],
  loading = false,
  selectedSong = "",
  onSelect,
  disabled = false,
}) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState("");

  const selectedFormat = useMemo(
    () => formats.find((format) => format.slug === selectedSong) || null,
    [formats, selectedSong]
  );

  useEffect(() => {
    // Reset audio when selection changes
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(selectedFormat?.duration || 0);
    setAudioError("");

    const audioEl = audioRef.current;
    if (!audioEl) return;

    audioEl.pause();
    audioEl.currentTime = 0;

    if (selectedFormat?.source) {
      audioEl.src = selectedFormat.source;
      audioEl.load();
    } else {
      audioEl.removeAttribute("src");
    }
  }, [selectedFormat]);

  const handleTogglePlayback = async () => {
    const audioEl = audioRef.current;
    if (!audioEl || !selectedFormat?.source) return;

    if (isPlaying) {
      audioEl.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audioEl.play();
      setIsPlaying(true);
      setAudioError("");
    } catch (err) {
      setAudioError("Unable to play preview — tap again to retry.");
    }
  };

  const handleTimeUpdate = () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const { currentTime: now, duration: total } = audioEl;
    setCurrentTime(now || 0);
    if (Number.isFinite(total) && total > 0) {
      setDuration(total);
      setProgress(Math.min(100, (now / total) * 100));
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(100);
  };

  const canPlay = Boolean(selectedFormat?.source) && !loading;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_10px_50px_rgba(0,0,0,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-white/60">{label}</p>
          <p className="text-xl font-semibold leading-tight">{selectedFormat?.displayName || "Select a song"}</p>
          <p className="text-xs text-white/60">{helper}</p>
        </div>
        <button
          type="button"
          onClick={handleTogglePlayback}
          disabled={!canPlay || disabled}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-400/80 ${
            isPlaying
              ? "bg-emerald-500/20 text-emerald-100 border border-emerald-400/60"
              : "bg-white/10 text-white/80 border border-white/15 hover:bg-white/15"
          } ${!canPlay || disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <span
            className={`h-2 w-2 rounded-full shadow-[0_0_0_4px_rgba(16,185,129,0.18)] ${
              isPlaying ? "bg-emerald-400 animate-pulse" : "bg-white/60"
            }`}
          />
          {isPlaying ? "Pause preview" : "Play preview"}
        </button>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/70">
            <LoadingSpinner size="sm" /> Loading formats…
          </div>
        ) : (
          <select
            value={selectedSong}
            onChange={(event) => onSelect?.(event.target.value)}
            disabled={disabled}
            className="w-full rounded-xl bg-black/50 border border-white/15 px-3 py-3 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {formats.map((format) => (
              <option key={format.slug} value={format.slug}>
                {format.displayName || format.slug}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-white/60">
          <span>{formatSeconds(currentTime)}</span>
          <span>{formatSeconds(duration || selectedFormat?.duration || 0)}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {badge("Duration", formatSeconds(selectedFormat?.duration || duration || 0))}
        {badge("BPM", selectedFormat?.bpm ?? "—")}
        {badge("Clips", selectedFormat?.totalClips ?? "—")}
        {selectedFormat?.beatCount ? badge("Beats", selectedFormat.beatCount) : null}
      </div>

      {audioError && <p className="mt-3 text-xs text-amber-300">{audioError}</p>}

      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
      />
    </div>
  );
};

export default SongFormatPicker;
