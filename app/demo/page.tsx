"use client";

import dynamic from "next/dynamic";
import React from "react";
import styles from "./slot-demo.module.css";

const ReactVideoEditorClient = dynamic(
  () => import("../editor3/react-video-editor-client").then((m) => m.ReactVideoEditorClient),
  { ssr: false }
);

type SlotCandidate = {
  videoId?: string | null;
  indexId?: string | null;
  cloudinaryId?: string | null;
  start?: number;
  end?: number;
  durationSeconds?: number;
  tags?: string[] | null;
  intents?: string[] | null;
  bucket?: string | null;
};

type SlotSegment = {
  slot: number;
  targetDuration: number;
  candidates: SlotCandidate[];
};

type CoverageEntry = {
  key: string;
  target: number;
  candidateCount: number;
  slotCount: number;
};

type SlotsState = {
  header: {
    generatedAt?: string;
    runs?: number;
    seedsUsed?: number[];
    formatHash?: string | null;
    fps?: number;
    songSlug?: string | null;
  } | null;
  segments: SlotSegment[];
  coverage: Record<string, CoverageEntry>;
};

type Placement = { slot: number; candidate: SlotCandidate; targetDuration: number };

const MIN_SHOW_MS = 4500;
const SOFT_CAP_MS = 10_000;
const HARD_CAP_MS = 50_000;

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
};

const formatDuration = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(3)}s`;
};

const uniqueVideos = (candidates: SlotCandidate[]) => {
  const ids = new Set<string>();
  candidates.forEach((c) => {
    const id = c.videoId || c.indexId || c.cloudinaryId;
    if (id) ids.add(String(id));
  });
  return ids.size;
};

const updateGeImportParam = (jobId: string) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("geImport", jobId);
  window.history.replaceState({}, "", url.toString());
};

export default function SlotCuratorDemoPage() {
  const [songSlug, setSongSlug] = React.useState("cinemaedit");
  const [runs, setRuns] = React.useState(12);
  const [maxPerSlot, setMaxPerSlot] = React.useState(6);
  const [minPerDuration, setMinPerDuration] = React.useState(2);

  const [slotsState, setSlotsState] = React.useState<SlotsState | null>(null);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [placements, setPlacements] = React.useState<Placement[]>([]);
  const [placementProgress, setPlacementProgress] = React.useState(0);
  const [overlayState, setOverlayState] = React.useState<"idle" | "assembling" | "animating" | "cooldown" | "error">(
    "idle"
  );
  const [overlayError, setOverlayError] = React.useState<string | null>(null);
  const [overlayStartedAt, setOverlayStartedAt] = React.useState<number | null>(null);

  const loadSlots = React.useCallback(
    async (slug: string) => {
      setLoadingSlots(true);
      setError(null);
      try {
        const res = await fetch(`/api/slot-curator/slots?songSlug=${encodeURIComponent(slug)}`);
        if (!res.ok) {
          setSlotsState(null);
          if (res.status !== 404) {
            const data = await res.json().catch(() => ({}));
            setError(data?.error || "Failed to load slots");
          }
          return;
        }
        const data = await res.json();
        setSlotsState({
          header: data.header ?? data.slots?.header ?? null,
          segments: data.slots?.segments ?? [],
          coverage: data.coverage ?? {},
        });
      } catch (err: any) {
        setError(err?.message || "Failed to load slots");
      } finally {
        setLoadingSlots(false);
      }
    },
    [setSlotsState]
  );

  React.useEffect(() => {
    loadSlots(songSlug);
  }, [songSlug, loadSlots]);

  const handleRebuild = async () => {
    setStatus("Rebuilding slots…");
    setError(null);
    try {
      const res = await fetch("/api/slot-curator/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songSlug, runs, maxPerSlot, minPerDuration }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Rebuild failed");
        return;
      }
      setSlotsState({
        header: data.slots?.header ?? null,
        segments: data.slots?.segments ?? [],
        coverage: data.coverage ?? {},
      });
      setStatus("Slots rebuilt");
    } catch (err: any) {
      setError(err?.message || "Rebuild failed");
    } finally {
      setTimeout(() => setStatus(null), 1500);
    }
  };

  const handleReset = async () => {
    setStatus("Resetting slots…");
    setError(null);
    try {
      const res = await fetch(`/api/slot-curator/reset?songSlug=${encodeURIComponent(songSlug)}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Reset failed");
        return;
      }
      setSlotsState(null);
      setStatus("Slots reset");
    } catch (err: any) {
      setError(err?.message || "Reset failed");
    } finally {
      setTimeout(() => setStatus(null), 1200);
    }
  };

  const handleAssemble = async () => {
    setOverlayState("assembling");
    setOverlayStartedAt(Date.now());
    setOverlayError(null);
    setPlacements([]);
    setPlacementProgress(0);
    setStatus("Assembling demo import…");
    setError(null);

    try {
      const res = await fetch("/api/slot-curator/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songSlug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "Assembly failed";
        setOverlayError(msg);
        setOverlayState("error");
        setError(msg);
        return;
      }

      const placementList: Placement[] = Array.isArray(data.placements) ? data.placements : [];
      setPlacements(placementList);
      setPlacementProgress(0);
      setOverlayState("animating");
      if (data.jobId) {
        updateGeImportParam(data.jobId);
      }
      setStatus("Loaded demo import");
    } catch (err: any) {
      const msg = err?.message || "Assembly failed";
      setOverlayError(msg);
      setOverlayState("error");
      setError(msg);
    }
  };

  React.useEffect(() => {
    if (overlayState !== "animating") return;
    if (!placements.length) {
      setOverlayState("cooldown");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idx = 0;

    const tick = () => {
      if (cancelled) return;
      idx += 1;
      setPlacementProgress((prev) => {
        const next = Math.min(placements.length, prev + 1);
        if (next >= placements.length) {
          setOverlayState("cooldown");
        }
        return next;
      });
      if (idx < placements.length) {
        const delay = 150 + Math.floor(Math.random() * 100);
        timer = setTimeout(tick, delay);
      }
    };

    timer = setTimeout(tick, 180);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [overlayState, placements]);

  React.useEffect(() => {
    if (overlayState !== "assembling" && overlayState !== "animating") return;
    const hardTimer = setTimeout(() => {
      setOverlayError("Demo overlay timed out after 50s.");
      setOverlayState("error");
    }, HARD_CAP_MS);
    const softTimer = setTimeout(() => {
      if (overlayState === "animating") {
        setOverlayState("cooldown");
      }
    }, SOFT_CAP_MS);
    return () => {
      clearTimeout(hardTimer);
      clearTimeout(softTimer);
    };
  }, [overlayState]);

  React.useEffect(() => {
    if (overlayState !== "cooldown") return;
    const started = overlayStartedAt ?? Date.now();
    const elapsed = Date.now() - started;
    const wait = Math.max(MIN_SHOW_MS - elapsed, 0);
    const timer = setTimeout(() => {
      setOverlayState("idle");
      setOverlayError(null);
    }, Math.max(wait, 300));
    return () => clearTimeout(timer);
  }, [overlayState, overlayStartedAt]);

  const coverageRows = React.useMemo(() => {
    if (!slotsState?.coverage) return [];
    return Object.values(slotsState.coverage || {}).sort((a, b) => Number(a.target) - Number(b.target));
  }, [slotsState]);

  const currentPlacement = placements[Math.min(placementProgress, placements.length - 1)] || null;
  const overlayVisible = overlayState !== "idle";
  const overlayProgress =
    placements.length > 0 ? Math.min(1, placementProgress / placements.length) * 100 : overlayState === "assembling" ? 12 : 0;

  return (
    <div className={styles.page}>
      <div className={styles.editorShell}>
        <ReactVideoEditorClient />
        <div className={styles.demoOverlay}>
          <div className={styles.demoOverlayShade} />
          <div className={styles.demoOverlayPanel}>
            <div className={styles.demoOverlayTitle}>Slot-curation demo</div>
            <div className={styles.demoOverlaySubtitle}>
              Generate a demo edit to load the editor with a prepared import. The editor UI is locked for this demo.
            </div>
            <button className={`${styles.button} ${styles.primary} ${styles.demoOverlayButton}`} onClick={handleAssemble}>
              Generate edit
            </button>
          </div>
        </div>
      </div>

      <div className={`${styles.overlayRoot} ${overlayVisible ? "" : styles.overlayHidden}`}>
        {overlayVisible && (
          <>
            <div className={styles.overlayShade} />
            <div className={styles.overlayGuard} />
            <div className={styles.overlayPanel}>
              <div className={styles.overlayTitle}>
                {overlayState === "assembling" && "Preparing demo…"}
                {overlayState === "animating" && "Placing clips…"}
                {overlayState === "cooldown" && "Finalizing…"}
                {overlayState === "error" && "Demo failed"}
              </div>
              <div className={styles.overlaySubtitle}>
                {overlayError ||
                  (overlayState === "assembling"
                    ? "Loading slots and assembling a plan."
                    : "Animating clip placements while the real editor import loads.")}
              </div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${overlayProgress}%` }} />
              </div>
              {placements.length > 0 && (
                <div className={styles.placementList}>
                  {placements.map((p, idx) => {
                    const id = p.candidate.videoId || p.candidate.indexId || p.candidate.cloudinaryId || `slot-${p.slot}`;
                    const active = idx === placementProgress - 1;
                    return (
                      <span key={`${p.slot}-${idx}`} className={`${styles.pill} ${active ? styles.placementActive : ""}`}>
                        {p.slot}: {id}
                      </span>
                    );
                  })}
                </div>
              )}
              {overlayState === "error" && (
                <div className={styles.buttons}>
                  <button className={styles.button} onClick={() => setOverlayState("idle")}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
