"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import SongFormatPicker from "@/components/SongFormatPicker";
import ClipMapViewer from "@/components/ClipMapViewer";
import { fromQuickEdit3Plan } from "@/lib/clipMap/adapters";

const defaultCounts = { intro: 1, body: 1, outro: 1 };

const groupParts = (parts = []) => {
  return parts.reduce(
    (acc, p) => {
      const t = (p.partType || "").toLowerCase();
      if (!acc[t]) acc[t] = [];
      acc[t].push(p);
      return acc;
    },
    { intro: [], body: [], outro: [] }
  );
};

const PartList = ({ label, items, loading, onSelect, selectedId, onDelete }) => {
  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70 flex items-center gap-2">
        <LoadingSpinner size="sm" /> Loading {label}…
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-white/50">No {label} generated yet.</p>
      ) : (
        items.map((part) => (
          <div
            key={part.id}
            className={`rounded-2xl border p-4 space-y-3 shadow-[0_10px_40px_rgba(0,0,0,0.35)] ${
              selectedId === part.id ? "border-emerald-400/70 bg-emerald-500/10" : "border-white/10 bg-white/5"
            }`}
            onClick={() => onSelect?.(part.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/60">{label}</p>
                <p className="text-lg font-semibold text-white">Seed {part.seed}</p>
              </div>
              <div className="flex items-center gap-2">
                {part.overrides && Object.keys(part.overrides).length > 0 && (
                  <span className="text-[10px] uppercase tracking-[0.2em] text-amber-200 bg-amber-500/10 border border-amber-400/40 px-2 py-1 rounded-full">
                    Edited
                  </span>
                )}
                <span className="text-xs uppercase tracking-[0.25em] text-emerald-300">{part.status || "ready"}</span>
              </div>
            </div>
            <div className="text-xs text-white/60 space-y-1">
              <p>Duration: {part.durationSeconds?.toFixed(2)}s</p>
              <p>
                Beat range: {part.boundaries?.startUnitIdx ?? "—"} → {part.boundaries?.endUnitIdx ?? "—"}
              </p>
            </div>
            {part.renderUrl && (
              <video controls className="w-full rounded-xl border border-white/10" src={part.renderUrl} />
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(part.id);
                }}
                className="flex-1 rounded-lg bg-white/10 text-white text-sm py-2 border border-white/15 hover:border-emerald-300/60"
              >
                Select
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(part.id);
                }}
                className="rounded-lg bg-rose-500/15 text-rose-200 text-sm px-3 py-2 border border-rose-400/40 hover:border-rose-300/70"
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const InstantEditHubPage = () => {
  const [formats, setFormats] = useState([]);
  const [selectedSong, setSelectedSong] = useState("");
  const [loadingFormats, setLoadingFormats] = useState(true);

  const [parts, setParts] = useState([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Load a song and generate parts.");
  const [counts, setCounts] = useState(defaultCounts);
  const [generating, setGenerating] = useState(false);
  const [chronoMode, setChronoMode] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [dirty, setDirty] = useState(false);
  const [clipError, setClipError] = useState(null);

  const grouped = useMemo(() => groupParts(parts), [parts]);
  const selectedPart = useMemo(() => parts.find((p) => p.id === selectedPartId) || null, [parts, selectedPartId]);
  const clipMap = useMemo(() => {
    if (!selectedPart?.plan) return null;
    try {
      return fromQuickEdit3Plan(selectedPart.plan);
    } catch (err) {
      return null;
    }
  }, [selectedPart]);

  const fetchFormats = useCallback(async () => {
    setLoadingFormats(true);
    try {
      const res = await fetch("/api/song-edit");
      if (!res.ok) throw new Error("Unable to load song formats");
      const payload = await res.json();
      const list = Array.isArray(payload.formats) ? payload.formats : [];
      setFormats(list);
      if (list.length) setSelectedSong((prev) => prev || list[0].slug);
    } catch (err) {
      setError(err.message || "Failed to load formats");
    } finally {
      setLoadingFormats(false);
    }
  }, []);

  const fetchParts = useCallback(
    async (slug) => {
      if (!slug) return;
      setLoadingParts(true);
      try {
        const res = await fetch(`/api/instant-variants?songSlug=${slug}`);
        if (!res.ok) throw new Error("Unable to load parts");
        const data = await res.json();
        setParts(Array.isArray(data?.parts) ? data.parts : []);
      } catch (err) {
        setError(err.message || "Failed to load parts");
        setParts([]);
      } finally {
        setLoadingParts(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchFormats();
  }, [fetchFormats]);

  useEffect(() => {
    if (selectedSong) {
      fetchParts(selectedSong);
    }
  }, [selectedSong, fetchParts]);

  useEffect(() => {
    setOverrides({});
    setDirty(false);
  }, [selectedPartId]);

  useEffect(() => {
    setDirty(Object.keys(overrides || {}).length > 0);
  }, [overrides]);

  const handleGenerate = useCallback(async () => {
    if (!selectedSong) return;
    setGenerating(true);
    setError("");
    setStatus("Generating parts…");
    try {
      const res = await fetch("/api/instant-variants/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songSlug: selectedSong,
          chronologicalOrder: chronoMode,
          counts,
          baseSeed: Date.now(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      setParts((prev) => [...(data.parts || []), ...prev]);
      setStatus("Parts generated.");
    } catch (err) {
      setError(err.message || "Generation failed");
      setStatus("Generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [selectedSong, chronoMode, counts]);

  const handleCountChange = (key, value) => {
    const num = Math.max(0, Number(value) || 0);
    setCounts((prev) => ({ ...prev, [key]: num }));
  };

  const introCount = grouped.intro.length;
  const bodyCount = grouped.body.length;
  const outroCount = grouped.outro.length;
  const possibleVariants = introCount * bodyCount * outroCount;

  const deleteAll = useCallback(async () => {
    if (!selectedSong) return;
    setGenerating(true);
    setStatus("Deleting all parts…");
    setError("");
    try {
      const res = await fetch(`/api/instant-variants?songSlug=${selectedSong}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      setParts([]);
      setSelectedPartId(null);
      setOverrides({});
      setDirty(false);
      setStatus("All parts deleted.");
    } catch (err) {
      setError(err.message || "Delete failed");
      setStatus("Delete failed.");
    } finally {
      setGenerating(false);
    }
  }, [selectedSong]);

  const deletePart = useCallback(
    async (partId) => {
      if (!partId || !selectedSong) return;
      try {
        const res = await fetch(`/api/instant-variants/part?songSlug=${selectedSong}&partId=${partId}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Delete failed");
        setParts((prev) => prev.filter((p) => p.id !== partId));
        if (selectedPartId === partId) {
          setSelectedPartId(null);
          setOverrides({});
          setDirty(false);
        }
      } catch (err) {
        setError(err.message || "Delete failed");
      }
    },
    [selectedSong, selectedPartId]
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">Instant Hub</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold">Build parts, not full edits</h1>
          <p className="text-lg text-white/70 max-w-3xl">
            Generate intro, body, and outro independently using the same beat-aware logic as Quick Edit 3. No slicing,
            no combined variants—just reusable parts.
          </p>
        </header>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
          <div className="space-y-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <SongFormatPicker
                  label="Song"
                  helper="Pick your soundtrack to generate parts."
                  formats={formats}
                  loading={loadingFormats}
                  selectedSong={selectedSong}
                  onSelect={setSelectedSong}
                  disabled={generating}
                />
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-white/80 flex-1">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Intro</p>
                    <p className="text-xl font-semibold">{introCount}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Body</p>
                    <p className="text-xl font-semibold">{bodyCount}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Outro</p>
                    <p className="text-xl font-semibold">{outroCount}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Possible variants</p>
                    <p className="text-xl font-semibold">{possibleVariants || 0}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={deleteAll}
                  disabled={generating || !selectedSong}
                  className="rounded-lg px-4 py-3 text-sm font-semibold border border-rose-400/60 text-rose-200 bg-rose-500/10 hover:border-rose-300/80 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Delete all
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="grid grid-cols-3 gap-3 flex-1 min-w-[240px]">
                  {["intro", "body", "outro"].map((key) => (
                    <div key={key} className="space-y-1">
                      <label className="text-xs uppercase tracking-[0.2em] text-white/60">{key} variants</label>
                      <input
                        type="number"
                        min="0"
                        value={counts[key]}
                        onChange={(e) => handleCountChange(key, e.target.value)}
                        className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                        disabled={generating}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-white/60">Chronologic order</p>
                    <p className="text-xs text-white/60">
                      {chronoMode ? "Timeline coverage locked." : "Shuffle mode favors visual punch."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChronoMode((prev) => !prev)}
                    disabled={generating}
                    className={`relative inline-flex h-8 w-14 items-center rounded-full border transition ${
                      chronoMode ? "bg-emerald-500/80 border-emerald-400/80" : "bg-white/10 border-white/20"
                    } ${generating ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <span
                      className={`inline-block h-6 w-6 rounded-full bg-white transition-transform ${
                        chronoMode ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !selectedSong}
                  className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    generating || !selectedSong
                      ? "bg-emerald-500/30 text-white/60 border border-white/10 cursor-not-allowed"
                      : "bg-gradient-to-r from-emerald-500 to-teal-500 text-black hover:from-emerald-400 hover:to-teal-400"
                  }`}
                >
                  {generating ? (
                    <span className="inline-flex items-center gap-2">
                      <LoadingSpinner size="sm" /> Generating parts…
                    </span>
                  ) : (
                    "Generate Parts"
                  )}
                </button>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-white/70">
                <p>{status}</p>
                {error && <p className="text-rose-300">{error}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4">
              <h3 className="text-sm uppercase tracking-[0.3em] text-white/60">Intro</h3>
              <PartList
                label="Intro"
                items={grouped.intro || []}
                loading={loadingParts && !parts.length}
                onSelect={setSelectedPartId}
                selectedId={selectedPartId}
                onDelete={deletePart}
              />
            </div>
            <div className="space-y-4">
              <h3 className="text-sm uppercase tracking-[0.3em] text-white/60">Body</h3>
              <PartList
                label="Body"
                items={grouped.body || []}
                loading={loadingParts && !parts.length}
                onSelect={setSelectedPartId}
                selectedId={selectedPartId}
                onDelete={deletePart}
              />
            </div>
            <div className="space-y-4">
              <h3 className="text-sm uppercase tracking-[0.3em] text-white/60">Outro</h3>
              <PartList
                label="Outro"
                items={grouped.outro || []}
                loading={loadingParts && !parts.length}
                onSelect={setSelectedPartId}
                selectedId={selectedPartId}
                onDelete={deletePart}
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/60">Clip breakdown</p>
              <p className="text-sm text-white/70">
                Select a part to inspect and adjust its clips. Updates regenerate only that part.
              </p>
            </div>
            <button
              type="button"
              disabled={!selectedPart || !dirty}
              onClick={async () => {
                if (!selectedPart || !dirty) return;
                setGenerating(true);
                setStatus("Updating part…");
                setError("");
                try {
                  const res = await fetch("/api/instant-variants/update", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      songSlug: selectedSong,
                      partId: selectedPart.id,
                      overrides,
                      chronologicalOrder: chronoMode,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data?.error || "Update failed");
                  setParts((prev) =>
                    prev.map((p) => (p.id === selectedPart.id ? { ...p, ...data.part } : p))
                  );
                  setOverrides({});
                  setDirty(false);
                  setStatus("Part updated.");
                } catch (err) {
                  setError(err.message || "Update failed");
                  setStatus("Update failed.");
                } finally {
                  setGenerating(false);
                }
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                !selectedPart || !dirty
                  ? "bg-white/5 text-white/40 border-white/10 cursor-not-allowed"
                  : "bg-emerald-500/20 text-emerald-200 border-emerald-400/60 hover:border-emerald-400/80"
              }`}
            >
              Update Part
            </button>
          </div>

          {clipError && <p className="text-sm text-rose-300">{clipError}</p>}
          {!selectedPart && <p className="text-sm text-white/60">Select a part to view its clips.</p>}
          {selectedPart && clipMap && (
            <ClipMapViewer
              clipMap={clipMap}
              overrides={overrides}
              setOverrides={setOverrides}
              setErrorMessage={setClipError}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default InstantEditHubPage;
