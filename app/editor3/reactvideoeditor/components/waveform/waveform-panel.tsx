"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, RefreshCcw, Save, Undo2 } from "lucide-react";
import { Button } from "../ui/button";

type SongInfo = {
  slug: string;
  path: string;
  displayName?: string;
  filename?: string;
};

type SavedWaveform = {
  volume?: number[];
  numPoints?: number;
  pointDuration?: number;
  savedAt?: string;
  restoredAt?: string;
  meta?: {
    durationSeconds?: number;
  };
  bands?: Record<string, number[]>;
  spectralFlux?: number[];
  onsets?: Array<{ time: number; strength: number }>;
  beats?: number[];
};

const DEFAULT_TARGET_POINTS = 600;

export const WaveformPanel: React.FC = () => {
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [waveformData, setWaveformData] = useState<SavedWaveform | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [targetPoints, setTargetPoints] = useState<number>(DEFAULT_TARGET_POINTS);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSong = useMemo(
    () => songs.find((song) => song.slug === selectedSlug) || null,
    [songs, selectedSlug]
  );

  const resetState = () => {
    setWaveformData(null);
    setHasBackup(false);
    setMessage(null);
    setError(null);
  };

  const fetchSongs = async () => {
    setSongsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/format-builder/songs");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load songs");
      }
      const list = Array.isArray(payload) ? payload : payload?.songs;
      if (Array.isArray(list)) {
        setSongs(list);
        if (!selectedSlug && list.length) {
          setSelectedSlug(list[0].slug);
        }
      } else {
        throw new Error("Unexpected songs response");
      }
    } catch (err: any) {
      setError(err?.message || "Unable to load songs");
    } finally {
      setSongsLoading(false);
    }
  };

  useEffect(() => {
    fetchSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const describeWaveform = (wf: SavedWaveform | null) => {
    if (!wf) return null;
    const numPoints = wf.numPoints ?? wf.volume?.length ?? 0;
    const duration =
      typeof wf.meta?.durationSeconds === "number"
        ? wf.meta.durationSeconds
        : undefined;
    return {
      numPoints,
      pointDuration: wf.pointDuration,
      duration,
    };
  };

  const loadOrAnalyzeWaveform = async (forceAnalyze: boolean) => {
    if (!selectedSong) return;
    setWaveformLoading(true);
    setError(null);
    setMessage(null);

    try {
      let data: SavedWaveform | null = null;
      let backup = false;

      if (!forceAnalyze) {
        const savedRes = await fetch(
          `/api/format-builder/waveform/get?slug=${encodeURIComponent(selectedSong.slug)}`
        );
        const savedPayload = await savedRes.json().catch(() => ({}));
        if (savedRes.ok && savedPayload?.waveformData) {
          data = savedPayload.waveformData as SavedWaveform;
          backup = Boolean(savedPayload?.hasBackup);
        } else {
          backup = Boolean(savedPayload?.hasBackup);
        }
      }

      if (!data) {
        const analyzeRes = await fetch("/api/format-builder/waveform", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            songPath: selectedSong.path,
            targetPoints,
          }),
        });
        const analyzePayload = await analyzeRes.json().catch(() => ({}));
        if (!analyzeRes.ok || !analyzePayload?.volume) {
          throw new Error(analyzePayload?.error || "Waveform analysis failed");
        }
        data = analyzePayload as SavedWaveform;
      }

      // Save and optionally create backup
      const saveRes = await fetch("/api/format-builder/waveform/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: selectedSong.slug,
          waveformData: data,
          previousWaveform: forceAnalyze ? waveformData : undefined,
        }),
      });
      const savePayload = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        throw new Error(savePayload?.error || "Failed to save waveform");
      }

      const mergedData: SavedWaveform = {
        ...data,
        savedAt: savePayload?.savedAt || data?.savedAt,
      };
      setWaveformData(mergedData);
      setHasBackup(Boolean(savePayload?.hasBackup || backup));
      setMessage(forceAnalyze ? "Waveform regenerated and saved." : "Waveform ready.");
    } catch (err: any) {
      setError(err?.message || "Waveform load failed");
      if (!forceAnalyze) {
        setWaveformData(null);
      }
    } finally {
      setWaveformLoading(false);
      setRegenerating(false);
    }
  };

  const handleUndo = async () => {
    if (!selectedSong) return;
    setWaveformLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/format-builder/waveform/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: selectedSong.slug }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.waveformData) {
        throw new Error(payload?.error || "Unable to restore waveform");
      }
      setWaveformData(payload.waveformData as SavedWaveform);
      setHasBackup(Boolean(payload?.hasBackup));
      setMessage("Restored previous waveform.");
    } catch (err: any) {
      setError(err?.message || "Undo failed");
    } finally {
      setWaveformLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedSong) {
      resetState();
      return;
    }
    loadOrAnalyzeWaveform(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSong]);

  const summary = describeWaveform(waveformData);

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Activity className="h-4 w-4" />
            Waveform manager
          </div>
          <p className="text-xs text-muted-foreground">
            Generate, refresh, or restore cached waveforms shared with the format builder.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={fetchSongs}
          disabled={songsLoading}
        >
          {songsLoading ? "Refreshing..." : "Refresh songs"}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground">Song</label>
        <select
          className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          value={selectedSlug ?? ""}
          onChange={(e) => setSelectedSlug(e.target.value || null)}
          disabled={songsLoading}
        >
          {songs.length === 0 && <option value="">No songs found</option>}
          {songs.map((song) => (
            <option key={song.slug} value={song.slug}>
              {song.displayName || song.filename || song.slug}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground">Target points</label>
        <input
          type="number"
          min={100}
          max={2000}
          step={50}
          value={targetPoints}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10);
            if (!Number.isNaN(next)) {
              setTargetPoints(next);
            }
          }}
          className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
        />
        <p className="text-[11px] text-muted-foreground">
          Higher numbers capture more detail. Cached results are saved to `data/waveform-data/`.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          onClick={() => loadOrAnalyzeWaveform(false)}
          disabled={!selectedSong || waveformLoading}
          variant="secondary"
          className="w-full"
        >
          <Save className="h-4 w-4 mr-2" />
          {waveformLoading ? "Loading…" : "Load or create"}
        </Button>
        <Button
          onClick={() => {
            setRegenerating(true);
            loadOrAnalyzeWaveform(true);
          }}
          disabled={!selectedSong || waveformLoading}
          variant="default"
          className="w-full"
        >
          <RefreshCcw className="h-4 w-4 mr-2" />
          {regenerating ? "Regenerating…" : "Regenerate"}
        </Button>
        <Button
          onClick={handleUndo}
          disabled={!selectedSong || waveformLoading || !hasBackup}
          variant="ghost"
          className="w-full"
        >
          <Undo2 className="h-4 w-4 mr-2" />
          Undo
        </Button>
      </div>

      {(message || error) && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            error
              ? "border-red-500/40 bg-red-950/60 text-red-100"
              : "border-emerald-500/40 bg-emerald-950/60 text-emerald-100"
          }`}
        >
          {error || message}
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">Waveform status</div>
          <div className="text-xs text-muted-foreground">
            {waveformLoading ? "Loading…" : waveformData ? "Ready" : "Not generated"}
          </div>
        </div>
        {waveformData ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Points</dt>
              <dd className="text-foreground">
                {summary?.numPoints ?? "–"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Point duration</dt>
              <dd className="text-foreground">
                {summary?.pointDuration ? `${summary.pointDuration.toFixed(4)}s` : "–"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="text-foreground">
                {summary?.duration ? `${summary.duration.toFixed(2)}s` : "–"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Backup</dt>
              <dd className="text-foreground">{hasBackup ? "Available" : "None"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Saved at</dt>
              <dd className="text-foreground">
                {waveformData.savedAt
                  ? new Date(waveformData.savedAt).toLocaleString()
                  : "–"}
              </dd>
            </div>
            {waveformData.restoredAt && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Restored at</dt>
                <dd className="text-foreground">
                  {new Date(waveformData.restoredAt).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            No waveform found for this song. Use “Load or create” to generate it.
          </div>
        )}
      </div>
    </div>
  );
};

export default WaveformPanel;
