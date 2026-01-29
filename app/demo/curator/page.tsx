"use client";

import React from "react";
import styles from "../slot-demo.module.css";

type ClipIndexEntry = {
  slot: number;
  bucket: string;
  durationSeconds: number;
  publicPath: string;
  size: number;
};

type ClipIndex = {
  songSlug: string;
  generatedAt: string;
  fps: number;
  entries: ClipIndexEntry[];
};

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

type FormatOverview = {
  ready: boolean | null;
  hashMatch: boolean | null;
  missingCount: number;
  coverageWarnings: number;
  slotsGeneratedAt?: string | null;
  indexGeneratedAt?: string | null;
  entries?: number | null;
  songExists?: boolean | null;
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

const SONG_OPTIONS = [
  { value: "cinemaedit", label: "Cinema Edit" },
  { value: "bingbingbing", label: "Bing Bing Bing" },
  { value: "electric", label: "Electric" },
  { value: "factory", label: "Factory" },
  { value: "loveme", label: "Love Me" },
  { value: "lovemeaudio", label: "Love Me (Audio)" },
  { value: "pieceofheaven", label: "Piece of Heaven" },
  { value: "slowmospanish", label: "Slow Mo Spanish" },
  { value: "touchthesky", label: "Touch the Sky" },
  { value: "uptosomething", label: "Up To Something" },
];

export default function SlotCuratorPage() {
  const [songSlug, setSongSlug] = React.useState("cinemaedit");
  const [runs, setRuns] = React.useState(12);
  const [maxPerSlot, setMaxPerSlot] = React.useState(6);
  const [minPerDuration, setMinPerDuration] = React.useState(2);

  const [slotsState, setSlotsState] = React.useState<SlotsState | null>(null);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [indexState, setIndexState] = React.useState<ClipIndex | null>(null);
  const [loadingIndex, setLoadingIndex] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [materializeStatus, setMaterializeStatus] = React.useState<string | null>(null);
  const [materializeEntries, setMaterializeEntries] = React.useState<number | null>(null);
  const [materializeLogs, setMaterializeLogs] = React.useState<string[]>([]);
  const [songExists, setSongExists] = React.useState<boolean | null>(null);
  const [overview, setOverview] = React.useState<Record<string, FormatOverview>>({});
  const [loadingOverview, setLoadingOverview] = React.useState(false);

  const coverageRows = React.useMemo(() => {
    if (!slotsState?.coverage) return [];
    return Object.values(slotsState.coverage || {}).sort((a, b) => Number(a.target) - Number(b.target));
  }, [slotsState]);

  const slotRows = React.useMemo(() => {
    if (!slotsState?.segments?.length) return [];
    return slotsState.segments.map((seg) => {
      const available = (indexState?.entries || []).filter((e) => e.slot === seg.slot).length;
      return {
        slot: seg.slot,
        targetDuration: seg.targetDuration,
        candidates: seg.candidates?.length || 0,
        available,
      };
    });
  }, [slotsState, indexState]);

  const [readiness, setReadiness] = React.useState<{
    ready: boolean | null;
    reasons: string[];
    hashMatch: boolean | null;
    missingSlots: number[];
    coverageWarnings: { duration: number; candidateCount: number; slotCount: number }[];
  }>({ ready: null, reasons: [], hashMatch: null, missingSlots: [], coverageWarnings: [] });

  const autoRebuildRef = React.useRef<Record<string, boolean>>({});
  const handleRebuildRef = React.useRef<(() => Promise<void>) | null>(null);

  const loadStatus = React.useCallback(async (slug: string) => {
    try {
      const res = await fetch(`/api/slot-curator/status?songSlug=${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setReadiness({ ready: null, reasons: ["Status check failed"], hashMatch: null, missingSlots: [], coverageWarnings: [] });
        return;
      }
      const data = await res.json();
      setReadiness({
        ready: Boolean(data.ready),
        reasons: Array.isArray(data.reasons) ? data.reasons : [],
        hashMatch: data.slots?.hashMatch ?? null,
        missingSlots: Array.isArray(data.availability?.missingSlots) ? data.availability.missingSlots : [],
        coverageWarnings: Array.isArray(data.coverageWarnings) ? data.coverageWarnings : [],
      });

      // Auto-rebuild once per song when the format hash is mismatched
      if (data?.slots?.hashMatch === false && !autoRebuildRef.current[slug]) {
        autoRebuildRef.current[slug] = true;
        handleRebuildRef.current?.();
      }
    } catch {
      setReadiness({ ready: null, reasons: ["Status check failed"], hashMatch: null, missingSlots: [], coverageWarnings: [] });
    }
  }, []);

  const bucketRows = React.useMemo(() => {
    const buckets: Record<string, number> = {};
    (indexState?.entries || []).forEach((e) => {
      buckets[e.bucket] = (buckets[e.bucket] || 0) + 1;
    });
    return Object.entries(buckets)
      .map(([bucket, count]) => ({ bucket, count, length: Number(bucket) || 0 }))
      .sort((a, b) => a.length - b.length);
  }, [indexState]);

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
        // refresh readiness after loading slots
        loadStatus(slug);
      } catch (err: any) {
        setError(err?.message || "Failed to load slots");
      } finally {
        setLoadingSlots(false);
      }
    },
    [setSlotsState, loadStatus]
  );

  const loadIndex = React.useCallback(async (slug: string) => {
    setLoadingIndex(true);
    try {
      const res = await fetch(`/api/instant-clips/${encodeURIComponent(slug)}/index`);
      if (!res.ok) {
        setIndexState(null);
        return;
      }
      const data = await res.json();
      setIndexState(data);
    } catch {
      setIndexState(null);
    } finally {
      setLoadingIndex(false);
    }
  }, []);

  React.useEffect(() => {
    loadSlots(songSlug);
    loadIndex(songSlug);
    const checkSong = async () => {
      try {
        const res = await fetch(`/songs/${encodeURIComponent(songSlug)}.mp3`, { method: "HEAD" });
        setSongExists(res.ok);
      } catch {
        setSongExists(false);
      }
    };
    checkSong();
  }, [songSlug, loadSlots, loadIndex]);

  const loadOverview = React.useCallback(async () => {
    setLoadingOverview(true);
    try {
      const results = await Promise.all(
        SONG_OPTIONS.map(async (option) => {
          const slug = option.value;
          const [statusRes, indexRes, songRes] = await Promise.all([
            fetch(`/api/slot-curator/status?songSlug=${encodeURIComponent(slug)}`).catch(() => null),
            fetch(`/api/instant-clips/${encodeURIComponent(slug)}/index`).catch(() => null),
            fetch(`/songs/${encodeURIComponent(slug)}.mp3`, { method: "HEAD" }).catch(() => null),
          ]);

          const statusData = statusRes && statusRes.ok ? await statusRes.json().catch(() => null) : null;
          const indexData = indexRes && indexRes.ok ? await indexRes.json().catch(() => null) : null;

          return {
            slug,
            statusData,
            indexData,
            songOk: songRes?.ok ?? null,
          };
        })
      );

      const mapped: Record<string, FormatOverview> = {};
      results.forEach(({ slug, statusData, indexData, songOk }) => {
        mapped[slug] = {
          ready: statusData ? Boolean(statusData.ready) : null,
          hashMatch: statusData?.slots?.hashMatch ?? null,
          missingCount: statusData?.availability?.missingSlots?.length ?? 0,
          coverageWarnings: statusData?.coverageWarnings?.length ?? 0,
          slotsGeneratedAt: statusData?.slots?.generatedAt ?? statusData?.slots?.header?.generatedAt ?? null,
          indexGeneratedAt: indexData?.generatedAt ?? null,
          entries: indexData?.entries?.length ?? null,
          songExists: songOk,
        };
      });
      setOverview(mapped);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const handleRebuild = React.useCallback(async () => {
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
      loadStatus(songSlug);
      loadOverview();
    } catch (err: any) {
      setError(err?.message || "Rebuild failed");
    } finally {
      setTimeout(() => setStatus(null), 1500);
    }
  }, [songSlug, runs, maxPerSlot, minPerDuration, loadStatus, loadOverview]);

  React.useEffect(() => {
    handleRebuildRef.current = handleRebuild;
  }, [handleRebuild]);

  React.useEffect(() => {
    loadStatus(songSlug);
  }, [songSlug, loadStatus]);

  React.useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleMaterialize = async (mode: "full" | "missing" = "full") => {
    setMaterializeStatus("Running");
    setMaterializeEntries(null);
    setError(null);
    try {
      const res = await fetch("/api/slot-curator/materialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songSlug, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterializeStatus("Error");
        setError(data?.error || "Materialize failed");
        return;
      }
      setMaterializeStatus("Done");
      setMaterializeEntries(data?.entries ?? null);
      setMaterializeLogs((logs) => [
        `Materialized (${mode}) ${data?.entries ?? "?"} clips for ${songSlug} -> ${data?.indexPath || "index.json"}`,
        ...logs,
      ]);
      await loadIndex(songSlug);
      await loadSlots(songSlug);
      await loadOverview();
    } catch (err: any) {
      setMaterializeStatus("Error");
      setError(err?.message || "Materialize failed");
    }
  };

  const handleMaterializeAll = async () => {
    setMaterializeStatus("Running (all)");
    setMaterializeEntries(null);
    setError(null);
    try {
      const res = await fetch("/api/slot-curator/materialize-all", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterializeStatus("Error");
        setError(data?.error || "Materialize all failed");
        return;
      }
      setMaterializeStatus("Done");
      setMaterializeLogs((logs) => [`Bulk materialize done`, ...logs]);
      await loadIndex(songSlug);
      await loadSlots(songSlug);
      await loadOverview();
    } catch (err: any) {
      setMaterializeStatus("Error");
      setError(err?.message || "Materialize all failed");
    }
  };

  const handleMaterializeMissing = async () => {
    await handleMaterialize("missing");
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

  return (
    <div className={styles.page} data-theme="dark">
      <div className={styles.hero}>
        <div>
          <div className={styles.kicker}>Admin controls</div>
          <div className={styles.title}>Slot curator</div>
          <div className={styles.subtitle}>
            Rebuild and inspect slot candidates derived from Generate Edit runs. Focused on readability and quick
            verification.
          </div>
        </div>
        <div className={styles.heroAside}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Active format</div>
            <div className={styles.statValue}>{SONG_OPTIONS.find((o) => o.value === songSlug)?.label ?? songSlug}</div>
            <div className={styles.statMeta}>Updated {formatDate(slotsState?.header?.generatedAt) || "—"}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>MP4 buckets</div>
            <div className={styles.statValue}>{bucketRows.length || "—"}</div>
            <div className={styles.statMeta}>Tracks available buckets for this format</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Entries</div>
            <div className={styles.statValue}>{materializeEntries ?? indexState?.entries?.length ?? "—"}</div>
            <div className={styles.statMeta}>From latest materialization</div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Overview</div>
            <div className={styles.sectionTitle}>Formats at a glance</div>
          </div>
          <div className={styles.metaRow}>
            {loadingOverview ? <span className={styles.status}>Loading overview…</span> : <span className={styles.status}>Up to date</span>}
            <button className={`${styles.button} ${styles.ghost}`} onClick={loadOverview} disabled={loadingOverview}>
              Refresh overview
            </button>
          </div>
        </div>
        <div className={styles.overviewGrid}>
          {SONG_OPTIONS.map((option) => {
            const summary = overview[option.value];
            return (
              <div key={option.value} className={`${styles.card} ${styles.compactCard}`}>
                <div className={styles.cardTitleRow}>
                  <div className={styles.cardTitle}>{option.label}</div>
                  <span
                    className={`${styles.badge} ${summary?.ready ? styles.badgeSuccess : summary?.ready === false ? styles.badgeWarning : styles.badgeMuted}`}
                  >
                    {summary?.ready === null ? "Unknown" : summary?.ready ? "Ready" : "Needs work"}
                  </span>
                </div>
                <div className={styles.metaRow}>
                  <span>Slots: {summary?.slotsGeneratedAt ? formatDate(summary.slotsGeneratedAt) : "—"}</span>
                  <span>Index: {summary?.indexGeneratedAt ? formatDate(summary.indexGeneratedAt) : "—"}</span>
                  <span>Entries: {summary?.entries ?? "—"}</span>
                </div>
                <div className={styles.statPills}>
                  <span className={`${styles.pill} ${summary?.hashMatch === false ? styles.warning : ""}`}>
                    Hash {summary?.hashMatch === null ? "?" : summary?.hashMatch ? "match" : "mismatch"}
                  </span>
                  <span className={styles.pill}>Missing mp4s: {summary?.missingCount ?? 0}</span>
                  <span className={styles.pill}>Coverage warnings: {summary?.coverageWarnings ?? 0}</span>
                  <span className={styles.pill}>
                    Audio:{" "}
                    {summary?.songExists === null ? "Unknown" : summary?.songExists ? "Found" : "Missing"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Format workspace</div>
            <div className={styles.sectionTitle}>Inspect and generate</div>
          </div>
          <div className={styles.controls}>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Format</label>
              <select
                className={styles.selectInput}
                value={songSlug}
                onChange={(e) => setSongSlug(e.target.value)}
              >
                {SONG_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.buttons}>
              <button className={`${styles.button} ${styles.primary}`} onClick={handleMaterializeMissing} disabled={loadingSlots || materializeStatus === "Running"}>
                Generate Missing Clips
              </button>
              <button className={`${styles.button} ${styles.secondary}`} onClick={() => handleMaterialize("full")} disabled={loadingSlots || materializeStatus === "Running"}>
                Generate All Clips
              </button>
              <button className={`${styles.button} ${styles.tertiary}`} onClick={handleRebuild} disabled={loadingSlots}>
                Update Slots
              </button>
              <button className={`${styles.button} ${styles.ghost}`} onClick={() => loadStatus(songSlug)} disabled={loadingSlots}>
                Update Clip Map
              </button>
              <button className={`${styles.button} ${styles.ghost}`} onClick={() => loadSlots(songSlug)} disabled={loadingSlots}>
                Refresh Slots
              </button>
              <button className={`${styles.button} ${styles.danger}`} onClick={handleReset} disabled={loadingSlots}>
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className={styles.metaRow}>
          {status && <span className={styles.status}>{status}</span>}
          {materializeStatus && <span className={styles.status}>{materializeStatus}</span>}
          {error && (
            <span className={`${styles.status} ${styles.error}`}>
              {error}
            </span>
          )}
        </div>

        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardTitleRow}>
              <div className={styles.cardTitle}>Readiness</div>
              <span
                className={`${styles.badge} ${readiness.ready ? styles.badgeSuccess : readiness.ready === false ? styles.badgeWarning : styles.badgeMuted}`}
              >
                {readiness.ready === null ? "Checking…" : readiness.ready ? "Ready" : "Not ready"}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span>Generated: {formatDate(slotsState?.header?.generatedAt)}</span>
              <span>Runs: {slotsState?.header?.runs ?? "—"}</span>
              <span>Seeds: {slotsState?.header?.seedsUsed?.length ?? 0}</span>
              <span>FPS: {slotsState?.header?.fps ?? "—"}</span>
              <span>Local audio: {songExists === null ? "…" : songExists ? "Yes" : "Missing"}</span>
              <span>
                Hash:{" "}
                {readiness.hashMatch === null ? "Unknown" : readiness.hashMatch ? "Match" : "Mismatch — rebuild slots"}
              </span>
            </div>
            {readiness.ready === false && (
              <div className={styles.subtitle}>
                {readiness.reasons.length ? readiness.reasons.join(" • ") : "Not ready"}
              </div>
            )}
            {readiness.missingSlots.length > 0 && (
              <div className={styles.subtitle}>
                Missing mp4s for slots: {readiness.missingSlots.join(", ")}
              </div>
            )}
            {readiness.coverageWarnings.length > 0 && (
              <div className={styles.subtitle}>
                Low coverage at durations:{" "}
                {readiness.coverageWarnings.map((w) => w.duration.toFixed(3)).join(", ")}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Materialization</div>
            <div className={styles.metaRow}>
              <span>Entries: {materializeEntries ?? indexState?.entries?.length ?? "—"}</span>
              <span>Index: {indexState ? `/data/instant-clips/${songSlug}/index.json` : "—"}</span>
              <span>Output: {`/instant-clips/${songSlug}/`}</span>
              <span>Generated: {formatDate(indexState?.generatedAt)}</span>
              {loadingIndex && <span>Loading index…</span>}
            </div>
            {materializeLogs.length > 0 && (
              <div className={styles.logPanel}>
                {materializeLogs.slice(0, 12).map((log, idx) => (
                  <div key={idx} className={styles.logLine}>
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Buckets (local mp4s)</div>
            {bucketRows.length === 0 && <div className={styles.subtitle}>No local clips yet.</div>}
            {bucketRows.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th>Length</th>
                    <th>Available mp4s</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketRows.map((row) => (
                    <tr key={row.bucket}>
                      <td>{row.bucket}</td>
                      <td>{formatDuration(row.length)}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Duration coverage</div>
            {coverageRows.length === 0 && <div className={styles.subtitle}>No slots yet.</div>}
            {coverageRows.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Duration</th>
                    <th>Candidates</th>
                    <th>Slots</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageRows.map((row) => (
                    <tr key={row.key}>
                      <td>{formatDuration(row.target)}</td>
                      <td>{row.candidateCount}</td>
                      <td>{row.slotCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Slots</div>
          {loadingSlots && <div className={styles.subtitle}>Loading slots…</div>}
          {!loadingSlots && (!slotsState?.segments?.length ? <div className={styles.subtitle}>No slots yet.</div> : null)}
          {slotsState?.segments?.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Target</th>
                  <th>Candidates</th>
                  <th>Available mp4s</th>
                </tr>
              </thead>
              <tbody>
                {slotRows.map((row) => (
                  <tr key={row.slot}>
                    <td>{row.slot}</td>
                    <td>{formatDuration(row.targetDuration)}</td>
                    <td>{row.candidates}</td>
                    <td>{row.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
}
