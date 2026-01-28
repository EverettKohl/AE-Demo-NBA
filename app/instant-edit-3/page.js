"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import SongFormatPicker from "@/components/SongFormatPicker";
import CinematicTimeline from "@/components/CinematicTimeline";

const STAGE_KEYS = ["assembleParts"];
const MIN_DONE_DELAY_MS = 5000;

const CINEMATIC_STEPS = [
  { key: "score", label: "Analyze the score", message: "Reading cadence, loudness, and micro-beats." },
  { key: "frames", label: "See every frame", message: "Scanning faces, props, action vectors across the movie." },
  { key: "story", label: "Plot a visual arc", message: "Linking motifs and hero beats into a coherent story." },
  { key: "placement", label: "Place clips to music", message: "Locking hits, risers, and drops to visuals." },
  { key: "render", label: "Render the mix", message: "Color, pacing, transitions, and export to mp4." },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const InstantEdit3Page = () => {
  const [formats, setFormats] = useState([]);
  const [selectedSong, setSelectedSong] = useState("");
  const [chronologicalOrder, setChronologicalOrder] = useState(false);
  const [loadingFormats, setLoadingFormats] = useState(true);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Select a song and press Create to build the instant edit.");
  const [stageResults, setStageResults] = useState(
    STAGE_KEYS.map((key) => ({ key, status: "idle", message: key }))
  );
  const [plan, setPlan] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");
  const [fakeSteps, setFakeSteps] = useState(CINEMATIC_STEPS.map((step) => ({ ...step, status: "idle" })));

  const timersRef = useRef([]);

  const selectedFormat = useMemo(
    () => formats.find((format) => format.slug === selectedSong) || null,
    [formats, selectedSong]
  );

  const clearFakeTimers = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const startFakeProgress = useCallback(() => {
    clearFakeTimers();
    setFakeSteps(CINEMATIC_STEPS.map((step, idx) => ({ ...step, status: idx === 0 ? "pending" : "idle" })));

    CINEMATIC_STEPS.forEach((step, idx) => {
      const timer = setTimeout(() => {
        setFakeSteps((prev) =>
          prev.map((entry, entryIdx) => {
            if (entryIdx < idx) return { ...entry, status: "success" };
            if (entryIdx === idx) return { ...entry, status: "pending" };
            return entry.status === "error" ? entry : { ...entry, status: "idle" };
          })
        );
        setStatusMessage(step.message);
      }, idx * 900 + 200);
      timersRef.current.push(timer);
    });
  }, [clearFakeTimers]);

  const finishFakeProgress = useCallback(
    (wasSuccessful) => {
      clearFakeTimers();
      setFakeSteps((prev) => prev.map((step) => ({ ...step, status: wasSuccessful ? "success" : "error" })));
    },
    [clearFakeTimers]
  );

  useEffect(() => {
    const loadFormats = async () => {
      setLoadingFormats(true);
      try {
        const res = await fetch("/api/song-edit");
        if (!res.ok) throw new Error("Unable to load song formats");
        const payload = await res.json();
        const list = Array.isArray(payload.formats) ? payload.formats : [];
        setFormats(list);
        if (list.length) setSelectedSong(list[0].slug);
      } catch (err) {
        setError(err.message || "Failed to load formats");
      } finally {
        setLoadingFormats(false);
      }
    };
    loadFormats();
  }, []);

  useEffect(() => () => clearFakeTimers(), [clearFakeTimers]);

  const handleCreate = useCallback(async () => {
    const startTime = Date.now();
    const waitForMinimumDelay = async () => {
      const elapsed = Date.now() - startTime;
      const remaining = MIN_DONE_DELAY_MS - elapsed;
      if (remaining > 0) {
        await sleep(remaining);
      }
    };

    if (!selectedSong) {
      setError("Select a song first");
      return;
    }

    let wasSuccessful = false;
    setError("");
    setPlan(null);
    setVideoUrl(null);
    setRunning(true);
    startFakeProgress();
    setStatusMessage("Analyzing song and framing story beats…");
    setStageResults((prev) =>
      prev.map((stage) => ({ ...stage, status: "pending", message: `${stage.key}…` }))
    );

    try {
      const res = await fetch("/api/instant-edit-3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songSlug: selectedSong, chronologicalOrder }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Instant Edit 3 failed");
      }
      wasSuccessful = true;
      setPlan(payload.partsUsed || []);
      setVideoUrl(payload.videoUrl || null);
      setStageResults((prev) =>
        prev.map((stage) => ({
          ...stage,
          status: payload.videoUrl ? "success" : "error",
          message: payload.message || stage.key,
        }))
      );
      setStatusMessage(payload.videoUrl ? "Assembled mix ready." : payload.error || "Assembly unavailable.");
    } catch (err) {
      setStatusMessage("Instant Edit 3 assembly failed.");
      setError(err.message || "Instant Edit 3 failed");
      setStageResults((prev) =>
        prev.map((stage) =>
          stage.status === "pending" ? { ...stage, status: "error", message: err.message || stage.key } : stage
        )
      );
    } finally {
      await waitForMinimumDelay();
      finishFakeProgress(wasSuccessful);
      setRunning(false);
    }
  }, [selectedSong, chronologicalOrder, startFakeProgress, finishFakeProgress]);

  const combinedTimeline = useMemo(
    () => [
      ...fakeSteps,
      ...stageResults.map((stage) => ({
        key: stage.key,
        label: stage.key === "assembleParts" ? "Assemble & export" : stage.key,
        status: stage.status,
        message: stage.message,
      })),
    ],
    [fakeSteps, stageResults]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-950 to-black text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">Instant Edit 3</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold">Create a ready-to-play mp4 in one click</h1>
          <p className="text-lg text-white/70 max-w-3xl">
            Load the track, let the AI analyze every frame of the movie, and watch it plan, place, and render a cinematic
            story in seconds.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
          <div className="space-y-4">
            <SongFormatPicker
              label="Song"
              helper="Preview the track and pick your soundtrack."
              formats={formats}
              loading={loadingFormats}
              selectedSong={selectedSong}
              onSelect={setSelectedSong}
              disabled={running}
            />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 shadow-[0_10px_50px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/60">Story order</p>
                  <p className="text-sm text-white/70">
                    {chronologicalOrder ? "Cinema order locked." : "Remix mode pulls the most electric cuts."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setChronologicalOrder((prev) => !prev)}
                  disabled={running}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full border transition ${
                    chronologicalOrder
                      ? "bg-emerald-500/80 border-emerald-400/80"
                      : "bg-white/10 border-white/20"
                  } ${running ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <span
                    className={`inline-block h-6 w-6 rounded-full bg-white transition-transform ${
                      chronologicalOrder ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={running || !selectedSong}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  running || !selectedSong
                    ? "bg-emerald-500/30 text-white/60 border border-white/10 cursor-not-allowed"
                    : "bg-gradient-to-r from-emerald-500 to-teal-500 text-black hover:from-emerald-400 hover:to-teal-400"
                }`}
              >
                {running ? (
                  <span className="inline-flex items-center gap-2">
                    <LoadingSpinner size="sm" /> Assembling…
                  </span>
                ) : (
                  "Assemble Instant Edit"
                )}
              </button>
              {error && <p className="text-sm text-rose-300">{error}</p>}
            </div>
          </div>

          <div className="space-y-4">
            <CinematicTimeline title="Instant Edit brain" steps={combinedTimeline} />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-white/80">{statusMessage}</p>
                {selectedFormat && (
                  <span className="text-[11px] uppercase tracking-[0.25em] text-white/60">
                    {selectedFormat.displayName}
                  </span>
                )}
                {running && <LoadingSpinner size="sm" />}
              </div>
              {videoUrl && !running && (
                <video controls className="w-full rounded-xl border border-white/10" src={videoUrl} poster="" />
              )}
            </div>

            {plan && Array.isArray(plan) && plan.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Parts used</h2>
                  <span className="text-xs text-white/60">{plan.length} selections</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {plan.map((p) => (
                    <div
                      key={`${p.partType}-${p.variantId}`}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="capitalize text-white/90">{p.partType}</span>
                        <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">locked</span>
                      </div>
                      <p className="text-xs text-white/60 truncate">{p.variantId}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstantEdit3Page;

