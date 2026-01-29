"use client";

import React from "react";
import { createPortal } from "react-dom";
import { OverlayType, type Overlay } from "@editor/reactvideoeditor/types";
import { useEditorContext } from "@editor/reactvideoeditor/contexts/editor-context";
import { cn } from "@editor/reactvideoeditor/utils/general/utils";
import { Button } from "@editor/reactvideoeditor/components/ui/button";
import { useSeekDragAnimation } from "./hooks/useSeekDragAnimation";

type Props = {
  open: boolean;
  onClose: () => void;
};

type RemoteOverlay = Overlay & { type?: OverlayType | string | number };

// Legacy song slugs removed; keep empty so old formats don't appear.
const SLUG_CANDIDATES: string[] = [];
const FALLBACK_FPS = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeType = (value: any): OverlayType => {
  if (value === OverlayType.SOUND || `${value}`.toLowerCase() === "sound") return OverlayType.SOUND;
  return OverlayType.VIDEO;
};

const normalizeOverlay = (overlay: any, idx: number): Overlay => {
  const base: RemoteOverlay = overlay || {};
  const id = Number.isFinite(base.id) ? (base.id as number) : idx + 1;
  const rawType = base.type ?? OverlayType.VIDEO;
  const type = rawType;

  const durationInFrames = Math.max(1, Number((base as any).durationInFrames) || 1);
  const from = Number.isFinite((base as any).from) ? (base as any).from : 0;
  const row = Number.isFinite((base as any).row) ? (base as any).row : 0;
  const width = Number((base as any).width) || 1280;
  const height = Number((base as any).height) || 720;
  const mediaSrcDurationRaw = (base as any).mediaSrcDuration;
  const fps = Number((base as any).fps) || FALLBACK_FPS;
  const mediaSrcDuration =
    Number.isFinite(mediaSrcDurationRaw) && mediaSrcDurationRaw! > 0
      ? mediaSrcDurationRaw!
      : durationInFrames / Math.max(1, fps);
  const baseStyles = (base as any).styles || {};
  const styles = {
    objectFit: baseStyles.objectFit ?? "cover",
    objectPosition: baseStyles.objectPosition ?? "center center",
    volume: baseStyles.volume ?? 1,
    zIndex: baseStyles.zIndex ?? 10,
    animation: baseStyles.animation ?? { enter: "none", exit: "none" },
    opacity: baseStyles.opacity ?? 1,
  };

  // Preserve all fields, but ensure required numeric defaults so renderer gets sizes/timings.
  return {
    ...base,
    id,
    type,
    durationInFrames,
    from,
    row,
    left: Number((base as any).left) || 0,
    top: Number((base as any).top) || 0,
    width,
    height,
    rotation: Number((base as any).rotation) || 0,
    videoStartTime: Number((base as any).videoStartTime) || 0,
    mediaSrcDuration,
    content: (base as any).content || (base as any).src || "",
    isDragging: Boolean((base as any).isDragging),
    styles,
    meta: { ...(base as any).meta, __rawType: rawType ?? null },
  } as Overlay;
};

export function InstantDemoOverlay({ open, onClose }: Props) {
  const { setOverlays, setSelectedOverlayId, getAspectRatioDimensions, seekTo, play } = useEditorContext();
  const { playSeekDragAnimation, overlayElement: seekOverlay, isAnimating: isSeekAnimating } = useSeekDragAnimation();
  const [portalEl, setPortalEl] = React.useState<HTMLElement | null>(null);
  const [slugs, setSlugs] = React.useState<string[]>([]);
  const [slug, setSlug] = React.useState<string>("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "complete" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [progressText, setProgressText] = React.useState<string>("Pick a format to run.");
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const runRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const autoCloseTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const locate = () => {
      const el = document.querySelector("#player-shell") as HTMLElement | null;
      if (el) {
        setPortalEl(el);
        return true;
      }
      return false;
    };

    if (locate()) return;
    let timer: number | null = null;
    if (open) {
      timer = window.setInterval(() => {
        if (locate() && timer !== null) {
          window.clearInterval(timer);
        }
      }, 200);
    }
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, [open]);

  React.useEffect(() => {
    let cancelled = false;
    const loadSlugs = async () => {
      const fetchCandidates = async () => {
        try {
          const res = await fetch("/api/format-builder/songs");
          if (!res.ok) return SLUG_CANDIDATES;
          const data = await res.json().catch(() => ({}));
          const list = Array.isArray(data?.songs)
            ? data.songs.map((s: any) => s?.slug).filter(Boolean)
            : [];
          return list.length ? list : SLUG_CANDIDATES;
        } catch {
          return SLUG_CANDIDATES;
        }
      };

      const candidates = await fetchCandidates();
      const okSlugs: string[] = [];
      const notReady: string[] = [];

      await Promise.all(
        candidates.map(async (candidate) => {
          try {
            const res = await fetch(`/api/slot-curator/status?songSlug=${encodeURIComponent(candidate)}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data?.ready) {
              okSlugs.push(candidate);
            } else if (Array.isArray(data?.reasons)) {
              notReady.push(`${candidate}: ${data.reasons.join(" • ")}`);
            }
          } catch {
            /* ignore */
          }
        })
      );

      if (!cancelled) {
        setSlugs(okSlugs);
        setSlug((prev) => prev || (okSlugs[0] || ""));
        if (!okSlugs.length && notReady.length) {
          setError(notReady.join(" | "));
        }
      }
    };
    loadSlugs();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetState = () => {
    if (autoCloseTimerRef.current !== null) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setError(null);
    setProgressText("Pick a format to run.");
    setWarnings([]);
  };

  const handleClose = () => {
    resetState();
    setSelectedOverlayId(null);
    onClose();
  };

  const runDemo = async () => {
    if (!slug) return;
    const runId = runRef.current + 1;
    runRef.current = runId;
    setStatus("loading");
    setError(null);
    setProgressText("Starting…");
    setWarnings([]);
    setSelectedOverlayId(null);
    setOverlays([]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/slot-curator/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songSlug: slug }),
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Instant assemble failed");
      }
      const rveProject = payload?.rveProject;
      const payloadWarnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
      setWarnings(payloadWarnings);
      if (!rveProject?.overlays || !Array.isArray(rveProject.overlays)) {
        throw new Error("No overlays returned for this format");
      }

      const canvas = getAspectRatioDimensions();
      const fillOverlay = (overlay: Overlay): Overlay => {
        if (normalizeType(overlay.type) === OverlayType.SOUND) return overlay;
        return {
          ...overlay,
          left: 0,
          top: 0,
          width: canvas.width,
          height: canvas.height,
          styles: {
            ...overlay.styles,
            objectFit: overlay.styles?.objectFit ?? "cover",
            objectPosition: (overlay.styles as any)?.objectPosition ?? "center center",
          },
        };
      };

      const normalized = (rveProject.overlays as any[]).map(normalizeOverlay).map(fillOverlay);
      const soundOverlays = normalized.filter((o) => normalizeType(o.type) === OverlayType.SOUND).sort((a, b) => a.from - b.from);
      const videoOverlays = normalized
        .filter((o) => normalizeType(o.type) !== OverlayType.SOUND)
        .sort((a, b) => a.from - b.from);

      const totalFrames =
        videoOverlays.reduce((max, clip) => Math.max(max, clip.from + clip.durationInFrames), 0) || FALLBACK_FPS;

      setProgressText("Loading song…");
      setOverlays(soundOverlays);

      let current: Overlay[] = [...soundOverlays];
      setProgressText(`Placing clips (0/${videoOverlays.length})…`);
      for (let i = 0; i < videoOverlays.length; i++) {
        if (controller.signal.aborted) return;
        const clip = videoOverlays[i];
        const clipFps = Number((clip as any)?.fps) || FALLBACK_FPS;

        await playSeekDragAnimation({
          targetFrame: clip.from,
          targetRow: clip.row ?? 0,
          fps: clipFps,
          totalFrames,
          onCommit: async () => {
            current = [...current, clip];
            setOverlays(current);
            setSelectedOverlayId(clip.id);
            setProgressText(`Placing clips (${i + 1}/${videoOverlays.length})…`);
          },
        });
      }

      if (runId === runRef.current && !controller.signal.aborted) {
        setStatus("complete");
        setProgressText(
          payloadWarnings.length
            ? `Complete with warnings: ${payloadWarnings.join(" | ")}`
            : "Complete. You can close this overlay."
        );
        autoCloseTimerRef.current = window.setTimeout(() => {
          seekTo(0);
          play();
          handleClose();
        }, 1000);
      }
    } catch (err: any) {
      if (controller.signal.aborted || runId !== runRef.current) return;
      setStatus("error");
      setError(err?.message || "Failed to create edit");
      setProgressText("Resolve the error and retry.");
    } finally {
      if (runId === runRef.current && abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  if (!open || !portalEl) return null;

  return createPortal(
    <>
      {seekOverlay}
      <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-[1px] flex flex-col text-white">
        <div className="relative flex items-center px-3 py-2 min-h-12 border border-[#3a404d] border-l-0 border-t-0 bg-[#2f343d] text-slate-100">
          <div className="absolute left-3">
            <Button variant="secondary" size="sm" onClick={handleClose} className="bg-white/10 text-white hover:bg-white/20">
              Back to player
            </Button>
          </div>
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm font-semibold">Instant Demo</span>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 items-center justify-center bg-black px-3 py-2" data-seek-scan-container>
          <div className={cn("w-full max-w-xl space-y-4 transition-opacity duration-75", isSeekAnimating && "opacity-0 pointer-events-none")}>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-white/60">Format</label>
              <select
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={status === "loading" || !slugs.length}
                className="w-full rounded-md border border-white/15 bg-[#0f172a] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                {!slugs.length && <option value="">No ready formats</option>}
                {slugs.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={runDemo}
              disabled={!slug || status === "loading" || !slugs.length}
              className={cn(
                "w-full bg-green-600 text-white hover:bg-green-500 disabled:opacity-70 disabled:cursor-not-allowed",
                status === "complete" && "bg-green-500 hover:bg-green-400"
              )}
            >
              {status === "loading" ? "Loading" : status === "complete" ? "Complete" : "Create Edit"}
            </Button>

            <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2 text-sm text-white/80">
              <div className="flex items-center justify-between text-xs text-white/60">
                <span>Progress</span>
                <span className="uppercase tracking-[0.2em]">{status.toUpperCase()}</span>
              </div>
              <p>{progressText}</p>
              {error && <p className="text-rose-300">{error}</p>}
              {warnings.length > 0 && <p className="text-amber-300">{warnings.join(" • ")}</p>}
            </div>
          </div>
        </div>
      </div>
    </>,
    portalEl
  );
}
