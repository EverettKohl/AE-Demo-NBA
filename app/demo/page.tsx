"use client";

import dynamic from "next/dynamic";
import React from "react";
import styles from "./slot-demo.module.css";

const ReactVideoEditorClient = dynamic(
  () => import("../editor3/react-video-editor-client").then((m) => m.ReactVideoEditorClient),
  { ssr: false }
);

type Placement = {
  id: string;
  startSeconds: number;
  durationSeconds: number;
  src: string;
};

type DemoRveProject = {
  overlays?: any[];
  aspectRatio?: any;
  fps?: number;
};

const updateGeImportParam = (jobId: string) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("geImport", jobId);
  window.history.replaceState({}, "", url.toString());
};

export default function SlotCuratorDemoPage() {
  const [songSlug, setSongSlug] = React.useState("cinemaedit");
  const [status, setStatus] = React.useState<string | null>("Ready");
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [placements, setPlacements] = React.useState<Placement[]>([]);
  const [stagedCount, setStagedCount] = React.useState(0);
  const [pendingJobId, setPendingJobId] = React.useState<string | null>(null);
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [rveProject, setRveProject] = React.useState<DemoRveProject | null>(null);

  const handleAssemble = async () => {
    setIsLoading(true);
    setStatus("Assembling demo import…");
    setError(null);
    setPlacements([]);
    setStagedCount(0);
    setPendingJobId(null);
    setIsAnimating(false);
    setRveProject(null);
    try {
      const res = await fetch("/api/demo/instant-assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songSlug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "Assembly failed";
        setError(msg);
        setStatus(null);
        return;
      }
      const partClips =
        Array.isArray(data.parts) && data.parts.length
          ? data.parts
              .filter((p: any) => p?.renderUrl)
              .map((p: any, idx: number) => ({
                id: `part-${idx + 1}`,
                renderUrl: p.renderUrl,
                durationSeconds: Number(p.durationSeconds) || 0,
              }))
          : [];

      if (!partClips.length) {
        setError("No parts available. Prepare instant-edit parts first.");
        setStatus(null);
        return;
      }

      const overlays: any[] = [];
      let cursor = 0;
      partClips.forEach((p, idx) => {
        const dur = Math.max(Number(p.durationSeconds) || 0, 0.1);
        overlays.push({
          id: `part-${idx + 1}`,
          type: "video",
          row: 0,
          from: Math.round(cursor * (data.fps || 30)),
          durationInFrames: Math.max(1, Math.round(dur * (data.fps || 30))),
          src: p.renderUrl,
          content: p.renderUrl,
          trimStart: 0,
          trimEnd: dur,
          meta: {
            durationSeconds: dur,
            startSeconds: cursor,
            endSeconds: cursor + dur,
            renderUrl: p.renderUrl,
          },
        });
        cursor += dur;
      });

      setPlacements(
        overlays.map((o, idx) => ({
          id: o.id || `part-${idx + 1}`,
          startSeconds: o.meta?.startSeconds ?? 0,
          durationSeconds: partClips[idx]?.durationSeconds || 0.1,
          src: o.src,
        }))
      );
      setRveProject({
        overlays,
        aspectRatio: data.aspectRatio || "16:9",
        fps: data.fps || 30,
      });
      setStagedCount(overlays.length ? 1 : 0);
      setPendingJobId(data.jobId || null);
      setIsAnimating(overlays.length > 0);
      setStatus(overlays.length ? "Placing clips…" : "Demo import loaded");
    } catch (err: any) {
      setError(err?.message || "Assembly failed");
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (!isAnimating || !rveProject?.overlays?.length) return;
    let cancelled = false;
    const total = rveProject.overlays.length;
    const placeNext = () => {
      setStagedCount((prev) => {
        const next = Math.min(prev + 1, total);
        if (next >= total) {
          setIsAnimating(false);
          if (pendingJobId) {
            updateGeImportParam(pendingJobId);
          }
          setStatus("Demo import loaded");
        } else {
          setStatus(`Placing clip ${next} / ${total}`);
          setTimeout(() => {
            if (!cancelled) placeNext();
          }, 180);
        }
        return next;
      });
    };
    setStatus(`Placing clip 1 / ${total}`);
    const starter = setTimeout(() => {
      if (!cancelled) placeNext();
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(starter);
    };
  }, [isAnimating, pendingJobId, rveProject?.overlays]);

  return (
    <div className={`${styles.page} ${styles.demoOnly}`}>
      <div className={styles.controlsSection}>
        <div className={styles.demoOverlayTitle}>Slot-curation demo</div>
        <div className={styles.demoOverlaySubtitle}>
          Generate a demo edit using curated slots. The rest of the editor remains unchanged.
        </div>
        <div className={styles.overlayControls}>
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>Song slug</label>
            <select
              className={styles.selectInput}
              value={songSlug}
              onChange={(e) => setSongSlug(e.target.value)}
            >
              <option value="bingbingbing">bingbingbing</option>
              <option value="cinemaedit">cinemaedit</option>
              <option value="electric">electric</option>
              <option value="factory">factory</option>
              <option value="touchthesky">touchthesky</option>
              <option value="loveme">loveme</option>
            </select>
          </div>
          <button className={`${styles.button} ${styles.primary}`} onClick={handleAssemble} disabled={isLoading}>
            {isLoading ? "Generating…" : "Generate edit"}
          </button>
        </div>
        <div className={styles.metaRow}>
          {status && <span className={styles.status}>{status}</span>}
          {error && <span className={`${styles.status} ${styles.error}`}>{error}</span>}
        </div>
      </div>

      <div className={styles.timelineContainer}>
        {placements.length > 0 && (
          <div className={styles.timelineHud}>
            <div className={styles.placementList}>
              {placements.slice(0, stagedCount).map((p, idx) => {
                const id = p.src || `clip-${idx + 1}`;
                return (
                  <span key={`${p.id}-${idx}`} className={`${styles.pill} ${styles.placementActive}`}>
                    {idx + 1}. {id}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <ReactVideoEditorClient
          defaultOverlays={rveProject?.overlays?.slice(0, stagedCount) || []}
          defaultAspectRatio={rveProject?.aspectRatio || "16:9"}
          fpsOverride={rveProject?.fps || 30}
          loadingOverride={false}
          projectIdOverride="demo-live-timeline"
        />
      </div>
    </div>
  );
}
