"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import SongFormatPicker from "@/components/SongFormatPicker";
import CinematicTimeline from "@/components/CinematicTimeline";

const EmbeddedEditor = dynamic(
  () => import("../editor3/react-video-editor-client").then((m) => m.ReactVideoEditorClient),
  { ssr: false, loading: () => <div className="text-sm text-white/70">Loading editor…</div> }
);

const FAKE_STEPS = [
  { key: "score", label: "Analyze the score", message: "Reading cadence, loudness, and micro-beats." },
  { key: "frames", label: "See every frame", message: "Scanning faces, props, action vectors across the movie." },
  { key: "story", label: "Plot a visual arc", message: "Linking motifs and hero beats into a coherent story." },
  { key: "placement", label: "Place clips to music", message: "Locking hits, risers, and drops to visuals." },
  { key: "render", label: "Render the mix", message: "Color, pacing, transitions, and export to mp4." },
];

const FAKE_TIMELINE = [
  { id: "fake-1", label: "Hook", durationSeconds: 4.5 },
  { id: "fake-2", label: "Beat drop", durationSeconds: 6.2 },
  { id: "fake-3", label: "Riser", durationSeconds: 3.1 },
  { id: "fake-4", label: "Chorus", durationSeconds: 5.7 },
  { id: "fake-5", label: "Bridge", durationSeconds: 4.0 },
  { id: "fake-6", label: "Outro", durationSeconds: 3.6 },
];

const SCOUT_FRAMES = [
  "/images/good_object_example1.png",
  "/images/good_object_example2.png",
  "/images/bad_object_example1.png",
  "/images/bad_object_example2.png",
  "/images/beach_search_result1.png",
  "/images/beach_search_result2.png",
  "/images/beach_search_result3.png",
  "/images/empty-search-state.png",
];

const MIN_ANIM_MS = 4000;
const MAX_ANIM_MS = 6000;
const SOFT_CAP_MS = 10000;
const HARD_CAP_MS = 50000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TimelineClip = {
  id: string;
  label: string;
  durationSeconds: number;
};

const AnimatedTimeline = ({
  clips,
  totalDuration,
  running,
}: {
  clips: TimelineClip[];
  totalDuration: number;
  running: boolean;
}) => {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3 backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/60">Timeline</p>
          <p className="text-sm text-white/70">Live placement animation</p>
        </div>
        {running && <LoadingSpinner size="sm" />}
      </div>
      <div className="relative overflow-hidden rounded-xl bg-black/40 border border-white/10 min-h-[84px]">
        <div className="flex h-20 items-center gap-1 px-3">
          {clips.map((clip) => {
            const widthPct = totalDuration > 0 ? Math.max(5, (clip.durationSeconds / totalDuration) * 100) : 20;
            return (
              <div
                key={clip.id}
                className="relative rounded-lg bg-gradient-to-br from-emerald-500/70 to-teal-400/70 text-black text-xs font-semibold px-3 py-2 shadow-[0_10px_30px_rgba(16,185,129,0.35)] transition-transform duration-300"
                style={{ width: `${widthPct}%`, minWidth: "48px" }}
                title={clip.label}
              >
                <span className="block truncate">{clip.label}</span>
                <span className="text-[10px] font-medium text-black/70">
                  {clip.durationSeconds ? `${clip.durationSeconds.toFixed(1)}s` : "—"}
                </span>
              </div>
            );
          })}
        </div>
        {running && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse pointer-events-none" />
        )}
      </div>
    </div>
  );
};

const ScoutStrip = ({ frame, running }: { frame: string; running: boolean }) => {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3 backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/60">AI Scouting</p>
          <p className="text-sm text-white/70">Rapid scrub through the pool</p>
        </div>
        {running && <LoadingSpinner size="sm" />}
      </div>
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/50">
        <img src={frame} alt="Scout frame" className="w-full h-48 object-cover" />
        {running && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-400/10 to-transparent animate-pulse" />
        )}
      </div>
    </div>
  );
};

const DemoPage = () => {
  const [formats, setFormats] = useState<any[]>([]);
  const [selectedSong, setSelectedSong] = useState("");
  const [chronologicalOrder, setChronologicalOrder] = useState(false);
  const [loadingFormats, setLoadingFormats] = useState(true);

  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Run the AI demo to see it build.");
  const [stageResults, setStageResults] = useState([{ key: "assembleParts", status: "idle", message: "Assemble parts" }]);
  const [fakeSteps, setFakeSteps] = useState(FAKE_STEPS.map((step) => ({ ...step, status: "idle" })));
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [partsUsed, setPartsUsed] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const [scoutFrame, setScoutFrame] = useState(SCOUT_FRAMES[0]);
  const [scoutActive, setScoutActive] = useState(false);

  const [timelineSource, setTimelineSource] = useState<TimelineClip[]>(FAKE_TIMELINE);
  const [animatedTimeline, setAnimatedTimeline] = useState<TimelineClip[]>([]);

  const [showEditor, setShowEditor] = useState(false);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const totalDuration = useMemo(
    () => (Array.isArray(timelineSource) && timelineSource.length ? timelineSource.reduce((s, c) => s + (c.durationSeconds || 0), 0) : 0),
    [timelineSource]
  );

  const combinedSteps = useMemo(
    () => [
      ...fakeSteps,
      { key: "assembleParts", label: "Assemble & export", status: stageResults.find((s) => s.key === "assembleParts")?.status || "idle", message: stageResults.find((s) => s.key === "assembleParts")?.message || "Assemble parts" },
    ],
    [fakeSteps, stageResults]
  );

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  const startFakeProgress = useCallback(() => {
    clearTimers();
    setFakeSteps(FAKE_STEPS.map((step, idx) => ({ ...step, status: idx === 0 ? "pending" : "idle" })));
    FAKE_STEPS.forEach((step, idx) => {
      const timer = setTimeout(() => {
        setFakeSteps((prev) =>
          prev.map((entry, entryIdx) => {
            if (entryIdx < idx) return { ...entry, status: "success" };
            if (entryIdx === idx) return { ...entry, status: "pending" };
            return entry.status === "error" ? entry : { ...entry, status: "idle" };
          })
        );
        setStatusMessage(step.message);
      }, idx * 750 + 200);
      timersRef.current.push(timer);
    });
  }, [clearTimers]);

  const finishFakeProgress = useCallback(
    (wasSuccessful: boolean) => {
      clearTimers();
      setFakeSteps((prev) => prev.map((step) => ({ ...step, status: wasSuccessful ? "success" : "error" })));
    },
    [clearTimers]
  );

  useEffect(() => {
    const fetchFormats = async () => {
      setLoadingFormats(true);
      try {
        const res = await fetch("/api/song-edit");
        if (!res.ok) throw new Error("Unable to load song formats");
        const payload = await res.json();
        const list = Array.isArray(payload.formats) ? payload.formats : [];
        setFormats(list);
        if (list.length) setSelectedSong(list[0].slug);
      } catch (err: any) {
        setError(err?.message || "Failed to load formats");
      } finally {
        setLoadingFormats(false);
      }
    };
    fetchFormats();
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!scoutActive) return undefined;
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % SCOUT_FRAMES.length;
      setScoutFrame(SCOUT_FRAMES[idx]);
    }, 120);
    return () => clearInterval(interval);
  }, [scoutActive]);

  useEffect(() => {
    if (!timelineSource.length) {
      setAnimatedTimeline([]);
      return;
    }
    setAnimatedTimeline([]);
    const timers: ReturnType<typeof setTimeout>[] = [];
    timelineSource.forEach((clip, idx) => {
      timers.push(
        setTimeout(() => {
          setAnimatedTimeline((prev) => [...prev, clip]);
        }, idx * 200)
      );
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [timelineSource]);

  const preloadFrames = useCallback(() => {
    SCOUT_FRAMES.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  useEffect(() => {
    preloadFrames();
  }, [preloadFrames]);

  const deriveTimelineFromParts = (parts: any[]): TimelineClip[] => {
    if (!Array.isArray(parts) || !parts.length) return FAKE_TIMELINE;
    return parts.map((p, idx) => ({
      id: p.variantId || `part-${idx}`,
      label: (p.partType || `part-${idx}`).toUpperCase(),
      durationSeconds: typeof p.durationSeconds === "number" ? p.durationSeconds : 6,
    }));
  };

  const handleRun = useCallback(async () => {
    if (running) return;
    const start = performance.now();
    const controller = new AbortController();
    controllerRef.current = controller;

    setRunning(true);
    setError("");
    setFallbackUsed(false);
    setShowEditor(false);
    setStatusMessage("Analyzing song and framing story beats…");
    setStageResults([{ key: "assembleParts", status: "pending", message: "Assemble parts…" } as any]);
    setTimelineSource(FAKE_TIMELINE);
    setPartsUsed([]);
    setVideoUrl(null);
    startFakeProgress();
    setScoutActive(true);

    const minAnimMs = MIN_ANIM_MS + Math.random() * (MAX_ANIM_MS - MIN_ANIM_MS);
    const softCapTimer = setTimeout(() => {
      setStatusMessage("AI finishing touches…");
    }, SOFT_CAP_MS);
    const hardCapTimer = setTimeout(() => {
      controller.abort();
    }, HARD_CAP_MS);

    const cleanupTimers = () => {
      clearTimeout(softCapTimer);
      clearTimeout(hardCapTimer);
    };

    try {
      const res = await fetch("/api/instant-edit-3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songSlug: selectedSong, chronologicalOrder, variantSeed: Date.now() }),
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "Instant Edit 3 failed");
      }
      setFallbackUsed(Boolean(payload.fallbackUsed));
      const timeline = deriveTimelineFromParts(payload.partsUsed || []);
      setTimelineSource(timeline);
      setPartsUsed(payload.partsUsed || []);
      setVideoUrl(payload.videoUrl || null);
      setStageResults([{ key: "assembleParts", status: payload.videoUrl ? "success" : "error", message: payload.message || "Assembled" } as any]);
      setStatusMessage(payload.videoUrl ? "Assembled mix ready." : payload.error || "Assembly incomplete.");
      const elapsed = performance.now() - start;
      const waitRemaining = Math.max(0, minAnimMs - elapsed);
      if (waitRemaining > 0) await sleep(waitRemaining);
      finishFakeProgress(true);
    } catch (err: any) {
      if (controller.signal.aborted) {
        setError("Assembly exceeded 50s timeout. Please retry.");
        setStatusMessage("Timed out — try again.");
      } else {
        setError(err?.message || "Instant Edit 3 failed");
        setStatusMessage("Assembly failed.");
      }
      setStageResults([{ key: "assembleParts", status: "error", message: err?.message || "Assembly failed" } as any]);
      finishFakeProgress(false);
    } finally {
      cleanupTimers();
      setScoutActive(false);
      setRunning(false);
    }
  }, [chronologicalOrder, deriveTimelineFromParts, finishFakeProgress, running, selectedSong, startFakeProgress]);

  const selectedFormat = useMemo(
    () => formats.find((format) => format.slug === selectedSong) || null,
    [formats, selectedSong]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-950 to-black text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">AI Demo</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold">Watch the AI build in seconds</h1>
          <p className="text-lg text-white/70 max-w-3xl">
            One-click demo that animates scouting, placement, and render. Uses Instant Edit 3 pipeline with prebuilt parts for instant output.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
          <div className="space-y-4">
            <SongFormatPicker
              label="Song"
              helper="Pick your soundtrack before running the demo."
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
                    chronologicalOrder ? "bg-emerald-500/80 border-emerald-400/80" : "bg-white/10 border-white/20"
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
                onClick={handleRun}
                disabled={running || !selectedSong}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  running || !selectedSong
                    ? "bg-emerald-500/30 text-white/60 border border-white/10 cursor-not-allowed"
                    : "bg-gradient-to-r from-emerald-500 to-teal-500 text-black hover:from-emerald-400 hover:to-teal-400"
                }`}
              >
                {running ? (
                  <span className="inline-flex items-center gap-2">
                    <LoadingSpinner size="sm" /> Building…
                  </span>
                ) : (
                  "Run AI Demo"
                )}
              </button>
              {error && <p className="text-sm text-rose-300">{error}</p>}
              {fallbackUsed && <p className="text-sm text-amber-200">Using fallback combo from manifest.</p>}
              <p className="text-sm text-white/70">{statusMessage}</p>
              {selectedFormat && (
                <div className="text-xs uppercase tracking-[0.25em] text-white/60">
                  {selectedFormat.displayName}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.3em] text-white/60">Controls</p>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={running}
                  className="rounded-lg bg-emerald-500 text-black px-4 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60"
                >
                  Retry (new seed)
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditor(true)}
                  disabled={!videoUrl}
                  className="rounded-lg bg-white/10 border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:border-emerald-300/60 disabled:opacity-60"
                >
                  Open in editor (inline)
                </button>
                <a
                  href={videoUrl || "#"}
                  download
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-black text-center ${
                    videoUrl
                      ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400"
                      : "bg-emerald-500/30 text-white/60 cursor-not-allowed"
                  }`}
                >
                  Download MP4
                </a>
              </div>
              <p className="text-xs text-white/60">
                Soft cap at 10s with finishing-touches state; hard fail at 50s with loud error for internal testing.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <CinematicTimeline
              title="Instant demo pipeline"
              steps={combinedSteps.map((step) => ({
                key: step.key,
                label: step.label,
                status: step.status,
                message: step.message,
              }))}
            />

            <ScoutStrip frame={scoutFrame} running={scoutActive} />
            <AnimatedTimeline clips={animatedTimeline} totalDuration={totalDuration} running={running} />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-white/80">{statusMessage}</p>
                {running && <LoadingSpinner size="sm" />}
              </div>
              {videoUrl && !running && (
                <video controls className="w-full rounded-xl border border-white/10" src={videoUrl} poster="" />
              )}
            </div>

            {partsUsed && Array.isArray(partsUsed) && partsUsed.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Parts used</h2>
                  <span className="text-xs text-white/60">{partsUsed.length} selections</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {partsUsed.map((p, idx) => (
                    <div
                      key={`${p.partType}-${p.variantId || idx}`}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="capitalize text-white/90">{p.partType}</span>
                        <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">locked</span>
                      </div>
                      <p className="text-xs text-white/60 truncate">{p.variantId || "variant"}</p>
                      <p className="text-xs text-white/60">
                        Duration: {typeof p.durationSeconds === "number" ? `${p.durationSeconds.toFixed(1)}s` : "n/a"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showEditor && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-white/60">Editor3 Embed</p>
                    <p className="text-sm text-white/70">Live editor mounted inline (reload-free).</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEditor(false)}
                    className="text-xs px-3 py-1 rounded-md bg-white/10 border border-white/15"
                  >
                    Close
                  </button>
                </div>
                <div className="h-[520px] rounded-xl border border-white/10 overflow-hidden">
                  <EmbeddedEditor />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DemoPage;
