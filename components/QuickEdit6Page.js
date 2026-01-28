"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";
import ClipMapViewer from "@/components/ClipMapViewer";
import SongFormatPicker from "@/components/SongFormatPicker";
import CinematicTimeline from "@/components/CinematicTimeline";
import { fromQuickEdit3Plan } from "@/lib/clipMap/adapters";
import useCloudinaryCloudName from "@/hooks/useCloudinaryCloudName";
import { buildQuickEdit6RveProject } from "@/app/editor/quickEdit6Adapter";

const STAGE_ORDER = [
  { key: "loadFormat", label: "Load format" },
  { key: "buildSegments", label: "Build beat segments" },
  { key: "assignClips", label: "Assign clips from pool" },
  { key: "trimFrames", label: "Trim to beat frames" },
  { key: "assemble", label: "Assemble / render" },
];

const QuickEdit6Page = () => {
  const router = useRouter();
  const [formats, setFormats] = useState([]);
  const [selectedSong, setSelectedSong] = useState("");
  const [chronologicalOrder, setChronologicalOrder] = useState(false);
  const [loadingFormats, setLoadingFormats] = useState(true);
  const [running, setRunning] = useState(false);
  const [stageResults, setStageResults] = useState(
    STAGE_ORDER.map((stage) => ({
      ...stage,
      status: "idle",
      message: stage.label,
      durationMs: null,
    }))
  );
  const [plan, setPlan] = useState(null);
  const [baseVideoUrl, setBaseVideoUrl] = useState(null);
  const [captionedVideoUrl, setCaptionedVideoUrl] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [captionsAvailable, setCaptionsAvailable] = useState(false);
  const [includeCaptions, setIncludeCaptions] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Select a song format and run Quick Edit 6.");
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState({});
  const [launchingEditor, setLaunchingEditor] = useState(false);
  const [qe6ImportKey, setQe6ImportKey] = useState(null);
  const { getCloudinaryCloudName } = useCloudinaryCloudName();

  useEffect(() => {
    const fetchFormats = async () => {
      setLoadingFormats(true);
      try {
        const res = await fetch("/api/song-edit-6");
        if (!res.ok) {
          throw new Error("Unable to load song formats");
        }
        const payload = await res.json();
        const formatsList = Array.isArray(payload.formats) ? payload.formats : [];
        setFormats(formatsList);
        if (formatsList.length) {
          setSelectedSong(formatsList[0].slug);
        }
      } catch (err) {
        setError(err.message || "Failed to load formats");
      } finally {
        setLoadingFormats(false);
      }
    };
    fetchFormats();
  }, []);

  const clipMap = useMemo(() => {
    if (!plan) return null;
    try {
      return fromQuickEdit3Plan(plan);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[QuickEdit6] Failed to build clip map", err);
      return null;
    }
  }, [plan]);

  const buildEditedSegments = useCallback(() => {
    if (!clipMap) return null;
    const editedSegments = {};
    clipMap.slots.forEach((slot) => {
      const override = overrides[slot.id];
      if (!override) return;
      editedSegments[String(slot.order)] = {
        videoId: override.videoId,
        indexId: override.indexId || null,
        start: override.start,
        end: override.end,
      };
    });
    return Object.keys(editedSegments).length ? editedSegments : null;
  }, [clipMap, overrides]);

  const resolveCloudName = useCallback(async () => {
    const cloudName =
      (await getCloudinaryCloudName()) ||
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
      process.env.CLOUDINARY_CLOUD_NAME ||
      null;
    return cloudName;
  }, [getCloudinaryCloudName]);

  const stashEditor2Import = useCallback(
    async ({ planPayload, job, renderSource, songSource }) => {
      if (!planPayload || typeof window === "undefined") return null;
      try {
        const cloudName = await resolveCloudName();
        const payload = buildQuickEdit6RveProject({
          plan: planPayload,
          jobId: job,
          cloudName,
          renderUrl: renderSource || null,
          songUrl: songSource || null,
        });
        const key = job || String(Date.now());
        window.sessionStorage.setItem(`qe6-import-${key}`, JSON.stringify(payload));
        window.localStorage.setItem(`qe6-import-${key}`, JSON.stringify(payload));
        setQe6ImportKey(key);
        return key;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[QuickEdit6] Failed to prepare Editor 2 import", err);
        return null;
      }
    },
    [resolveCloudName]
  );

  const runQuickEdit = useCallback(
    async ({ editedSegments = null } = {}) => {
      if (!selectedSong) {
        setError("Pick a song format first");
        return;
      }
      setError("");
      setPlan(null);
      setBaseVideoUrl(null);
      setCaptionedVideoUrl(null);
      setJobId(null);
      setQe6ImportKey(null);
      setStatusMessage(editedSegments ? "Re-rendering Quick Edit 6 with edits…" : "Running Quick Edit 6…");
      setRunning(true);
      setStageResults(
        STAGE_ORDER.map((stage) => ({
          ...stage,
          status: "pending",
          message: `${stage.label}…`,
          durationMs: null,
        }))
      );

      try {
        const res = await fetch("/api/quick-edit-6", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            songSlug: selectedSong,
            chronologicalOrder,
            editedSegments,
            includeCaptions: captionsAvailable && includeCaptions,
          }),
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload.error || "Quick Edit 6 failed");
        }

        setStageResults(
          STAGE_ORDER.map((stage) => {
            const result = (payload.stageResults || []).find((entry) => entry.key === stage.key);
            if (result) {
              return {
                ...stage,
                status: result.status || "idle",
                message: result.message || stage.label,
                durationMs: result.durationMs ?? null,
              };
            }
            return { ...stage };
          })
        );
        setPlan(payload.plan || null);
        const nextBase = payload.videoUrl || payload.videoDataUrl || null;
        const nextCaptioned = payload.captionedVideoUrl || null;
        setBaseVideoUrl(nextBase);
        setCaptionedVideoUrl(nextCaptioned);
        const nextJobId = payload.jobId || null;
        setJobId(nextJobId);
        const preferCaptioned = captionsAvailable && includeCaptions && Boolean(nextCaptioned);
        setStatusMessage(
          preferCaptioned
            ? "Captioned render ready — scroll to preview."
            : nextBase
            ? "Render ready — scroll to preview."
            : "Plan ready. No render output."
        );
        await stashEditor2Import({
          planPayload: payload.plan,
          job: nextJobId,
          renderSource: nextCaptioned || nextBase || null,
          songSource:
            payload?.plan?.songFormat?.source ||
            `/songs/${payload?.plan?.songSlug || selectedSong}.mp3` ||
            "/LoveMeAudio.mp3",
        });
      } catch (err) {
        setStatusMessage("Quick Edit 6 failed. Resolve errors and retry.");
        setError(err.message || "Quick Edit 6 failed");
        setStageResults((prev) =>
          prev.map((stage) => ({
            ...stage,
            status: stage.status === "pending" ? "error" : stage.status,
            message: stage.status === "pending" ? err.message || stage.label : stage.message,
          }))
        );
      } finally {
        setRunning(false);
      }
    },
    [chronologicalOrder, selectedSong, captionsAvailable, includeCaptions, stashEditor2Import]
  );

  const handleRun = useCallback(() => {
    setOverrides({});
    return runQuickEdit({ editedSegments: null });
  }, [runQuickEdit]);

  const handleRerenderWithEdits = useCallback(() => {
    const editedSegments = buildEditedSegments();
    if (!editedSegments) {
      setError("No overrides to render — edit or replace a slot first.");
      return;
    }
    return runQuickEdit({ editedSegments });
  }, [buildEditedSegments, runQuickEdit]);

  const handleOpenEditor = useCallback(async () => {
    if (!plan) {
      setError("Run Quick Edit 6 before opening the editor.");
      return;
    }
    setError("");
    setLaunchingEditor(true);
    try {
      const renderSource = captionedVideoUrl || baseVideoUrl || null;
      const key =
        qe6ImportKey ||
        (await stashEditor2Import({
          planPayload: plan,
          job: jobId || null,
          renderSource,
          songSource: plan?.songFormat?.source || `/songs/${plan?.songSlug || selectedSong}.mp3` || "/LoveMeAudio.mp3",
        }));
      if (!key) {
        throw new Error("Unable to prepare editor project");
      }
      const targetUrl = (() => {
        if (typeof window === "undefined") return `/editor?qe6Import=${encodeURIComponent(key)}`;
        const url = new URL(window.location.href);
        const preferredPort = process.env.NEXT_PUBLIC_EDITOR_PORT;
        if (preferredPort) {
          url.port = preferredPort;
        }
        url.pathname = "/editor";
        url.search = `qe6Import=${encodeURIComponent(key)}`;
        return url.toString();
      })();
      if (typeof window !== "undefined") {
        window.location.assign(targetUrl);
      } else {
        router.push(targetUrl);
      }
    } catch (err) {
      setError(err?.message || "Failed to open editor");
    } finally {
      setLaunchingEditor(false);
    }
  }, [plan, captionedVideoUrl, baseVideoUrl, qe6ImportKey, stashEditor2Import, jobId, router, selectedSong]);

  const planSummary = useMemo(() => {
    if (!plan) return null;
    return [
      { label: "Clips locked", value: plan.totalClips },
      { label: "Unique clips", value: plan.clipPool?.uniqueClipsUsed },
      { label: "Pool size", value: plan.clipPool?.totalClips || 2037 },
      { label: "Song duration", value: `${(plan.songFormat?.meta?.durationSeconds || 0).toFixed(1)}s` },
    ];
  }, [plan]);

  const selectedFormat = useMemo(
    () => formats.find((format) => format.slug === selectedSong) || null,
    [formats, selectedSong]
  );

  useEffect(() => {
    if (!selectedFormat) {
      setCaptionsAvailable(false);
      setIncludeCaptions(false);
      return;
    }
    const hasCaptions = Boolean(selectedFormat.captions);
    setCaptionsAvailable(hasCaptions);
    setIncludeCaptions(Boolean(selectedFormat.captions?.enabled ?? hasCaptions));
  }, [selectedFormat]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-950 to-black text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.35em] text-emerald-300">Quick Edit 6</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold">Stack the 2,037 verified clips</h1>
          <p className="text-lg text-white/70 max-w-3xl">
            Use the pre-cleared clip pool to generate a ready-to-play render. No searches, no delays — just beat-locked
            placement and instant output.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
          <div className="space-y-4">
            <SongFormatPicker
              label="Song"
              helper="Preview the track before running the edit."
              formats={formats}
              loading={loadingFormats}
              selectedSong={selectedSong}
              onSelect={setSelectedSong}
              disabled={running}
            />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 shadow-[0_10px_50px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-white/60">Chronologic order</p>
                    <p className="text-sm text-white/70">
                      {chronologicalOrder ? "Timeline coverage locked." : "Shuffle mode favors visual punch."}
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
                {captionsAvailable && (
                  <label className="inline-flex items-center gap-2 text-xs text-white/80 bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-lg">
                    <input
                      type="checkbox"
                      className="rounded border-gray-500 bg-black"
                      checked={includeCaptions}
                      onChange={(e) => setIncludeCaptions(e.target.checked)}
                      disabled={running}
                    />
                    <span className="font-semibold">Include captions</span>
                  </label>
                )}
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
                    <LoadingSpinner size="sm" /> Running…
                  </span>
                ) : (
                  "Run Quick Edit 6"
                )}
              </button>
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <p className="text-sm text-white/70">{statusMessage}</p>
            </div>
          </div>

          <div className="space-y-4">
            <CinematicTimeline
              title="Quick Edit pipeline"
              steps={stageResults.map((stage) => ({
                key: stage.key,
                label: stage.label,
                status: stage.status,
                message: stage.message,
                durationMs: stage.durationMs,
              }))}
            />

            {planSummary && (
              <div className="grid gap-3 sm:grid-cols-2">
                {planSummary.map((entry) => (
                  <div key={entry.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/60">{entry.label}</p>
                    <p className="text-2xl font-semibold">{entry.value ?? "—"}</p>
                  </div>
                ))}
              </div>
            )}

            {(baseVideoUrl || captionedVideoUrl) && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold">Rendered output</h2>
                    {selectedFormat && (
                      <span className="text-xs uppercase tracking-[0.2em] text-white/60">
                        {selectedFormat.displayName}
                      </span>
                    )}
                  </div>
                  {jobId && (captionedVideoUrl || baseVideoUrl) && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleOpenEditor}
                        disabled={launchingEditor || !plan}
                        className={`px-3 py-2 rounded-xl text-sm font-semibold border transition ${
                          launchingEditor || !plan
                            ? "border-white/10 bg-white/10 text-white/50 cursor-not-allowed"
                            : "border-amber-300/70 bg-amber-500/20 text-amber-100 hover:border-amber-200 hover:text-white"
                        }`}
                      >
                        {launchingEditor ? "Opening…" : "Open editor"}
                      </button>
                    </div>
                  )}
                </div>

                {captionedVideoUrl && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-white/80">Captioned</h3>
                    <video
                      controls
                      className="w-full rounded-2xl border border-white/10"
                      src={captionedVideoUrl}
                      poster=""
                    />
                  </div>
                )}

                {baseVideoUrl && (!captionedVideoUrl || baseVideoUrl !== captionedVideoUrl) && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-white/80">Base</h3>
                    <video controls className="w-full rounded-2xl border border-white/10" src={baseVideoUrl} poster="" />
                  </div>
                )}
              </div>
            )}

            {clipMap && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Clip map</h2>
                    <p className="text-xs text-white/60">
                      Edit/replace slots below. Beat-locked slots enforce duration (±1 frame @ {clipMap.fps}fps).
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={running || Object.keys(overrides).length === 0}
                    onClick={handleRerenderWithEdits}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border ${
                      running || Object.keys(overrides).length === 0
                        ? "bg-white/5 text-white/50 border-white/10 cursor-not-allowed"
                        : "bg-emerald-500/20 text-emerald-200 border-emerald-400/50 hover:border-emerald-400/80"
                    }`}
                    title={
                      Object.keys(overrides).length === 0
                        ? "Make edits to clips before re-rendering"
                        : "Re-render using overrides"
                    }
                  >
                    Re-render with edits ({Object.keys(overrides).length})
                  </button>
                </div>

                <ClipMapViewer clipMap={clipMap} overrides={overrides} setOverrides={setOverrides} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickEdit6Page;

