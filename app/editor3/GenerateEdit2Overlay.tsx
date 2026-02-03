"use client";

import React from "react";
import { createPortal } from "react-dom";
import { OverlayType, type Overlay } from "@editor/reactvideoeditor/types";
import { useEditorContext } from "@editor/reactvideoeditor/contexts/editor-context";
import { cn } from "@editor/reactvideoeditor/utils/general/utils";
import { Button } from "@editor/reactvideoeditor/components/ui/button";
import { useSeekDragAnimation } from "./hooks/useSeekDragAnimation";
import { prefetchImportAssets } from "./useQuickEdit6Import";
import { requestTimelineCollapseToRows } from "@editor/reactvideoeditor/utils/timeline-layout";

type Props = {
  open: boolean;
  onClose: () => void;
};

type FormatOption = { slug: string; name: string };

const FALLBACK_FPS = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeType = (value: any): OverlayType => {
  if (value === OverlayType.SOUND || `${value}`.toLowerCase() === "sound") return OverlayType.SOUND;
  return OverlayType.VIDEO;
};

const normalizeOverlay = (overlay: any, idx: number): Overlay => {
  const base: any = overlay || {};
  const id = Number.isFinite(base.id) ? (base.id as number) : idx + 1;
  const rawType = base.type ?? OverlayType.VIDEO;
  const durationInFrames = Math.max(1, Number(base.durationInFrames) || 1);
  const from = Number.isFinite(base.from) ? base.from : 0;
  const row = Number.isFinite(base.row) ? base.row : 0;
  const width = Number(base.width) || 1280;
  const height = Number(base.height) || 720;
  const fps = Number(base.fps) || FALLBACK_FPS;
  const mediaSrcDurationRaw = base.mediaSrcDuration;
  const mediaSrcDuration =
    Number.isFinite(mediaSrcDurationRaw) && mediaSrcDurationRaw! > 0
      ? mediaSrcDurationRaw!
      : durationInFrames / Math.max(1, fps);
  const baseStyles = base.styles || {};
  const styles = {
    ...baseStyles,
    objectFit: baseStyles.objectFit ?? "cover",
    objectPosition: baseStyles.objectPosition ?? "center center",
    volume: baseStyles.volume ?? 1,
    zIndex: baseStyles.zIndex ?? 10,
    animation: baseStyles.animation ?? { enter: "none", exit: "none" },
    opacity: baseStyles.opacity ?? 1,
  };

  return {
    ...base,
    id,
    type: rawType,
    durationInFrames,
    from,
    row,
    left: Number(base.left) || 0,
    top: Number(base.top) || 0,
    width,
    height,
    rotation: Number(base.rotation) || 0,
    videoStartTime: Number(base.videoStartTime) || 0,
    mediaSrcDuration,
    content: base.content || base.src || "",
    isDragging: Boolean(base.isDragging),
    styles,
    meta: { ...(base.meta || {}), __rawType: rawType ?? null },
  } as Overlay;
};

export function GenerateEdit2Overlay({ open, onClose }: Props) {
  const { setOverlays, setSelectedOverlayId, getAspectRatioDimensions, seekTo, play } = useEditorContext();
  const { playSeekDragAnimation, overlayElement: seekOverlay, isAnimating: isSeekAnimating } = useSeekDragAnimation();
  const [portalEl, setPortalEl] = React.useState<HTMLElement | null>(null);
  const [formats, setFormats] = React.useState<FormatOption[]>([]);
  const [selected, setSelected] = React.useState<string>("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "complete" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [progressText, setProgressText] = React.useState<string>("Pick a format to run.");
  const [autoClick, setAutoClick] = React.useState(false);
  const [showCursor, setShowCursor] = React.useState(false);
  const [cursorPos, setCursorPos] = React.useState<{ left: string; top: string }>({ left: "12%", top: "12%" });
  const runRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const autoCloseTimerRef = React.useRef<number | null>(null);
  const autoRunRef = React.useRef(false);
  const cursorTimerRef = React.useRef<number | null>(null);

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
    const loadFormats = async () => {
      try {
        const res = await fetch("/api/generate-edit2");
        if (!res.ok) throw new Error("Unable to load formats");
        const payload = await res.json();
        const formatsList = Array.isArray(payload.formats)
          ? payload.formats.map((f: any) => ({ slug: f.slug, name: f.name || f.slug })).filter((f: any) => f.slug)
          : [];
        if (!cancelled) {
          setFormats(formatsList);
          if (formatsList.length) setSelected((prev) => prev || formatsList[0].slug);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load formats");
        }
      }
    };
    loadFormats();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail || {};
      if (detail.action === "click-only") {
        setAutoClick(true);
      }
    };
    window.addEventListener("auto-generate-edit2", handler as EventListener);
    return () => window.removeEventListener("auto-generate-edit2", handler as EventListener);
  }, []);

  React.useEffect(() => {
    if (!open || !formats.length || !autoClick) return;
    if (status === "loading") return;
    if (!selected && formats[0]?.slug) {
      setSelected(formats[0].slug);
    }
    autoRunRef.current = true;
    setShowCursor(true);
    setCursorPos({ left: "18%", top: "28%" });
    if (cursorTimerRef.current) window.clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = window.setTimeout(() => {
      setCursorPos({ left: "50%", top: "34%" });
    }, 240);
    const runTimer = window.setTimeout(() => {
      if (!autoRunRef.current) return;
      autoRunRef.current = false;
      void runGenerateEdit();
      setAutoClick(false);
      setCursorPos({ left: "55%", top: "62%" });
      cursorTimerRef.current = window.setTimeout(() => setShowCursor(false), 900);
    }, 520);
    return () => {
      window.clearTimeout(runTimer);
    };
  }, [autoClick, formats, open, status, selected]); 

  React.useEffect(() => {
    return () => {
      if (cursorTimerRef.current) window.clearTimeout(cursorTimerRef.current);
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
  };

  const handleClose = () => {
    resetState();
    setSelectedOverlayId(null);
    onClose();
  };

  const runGenerateEdit = async () => {
    if (!selected) return;
    const runId = runRef.current + 1;
    runRef.current = runId;
    setStatus("loading");
    setError(null);
    setProgressText("Starting…");
    setSelectedOverlayId(null);
    setOverlays([]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/generate-edit2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formatSlug: selected,
          chronologicalOrder: false,
          materialize: true,
        }),
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Generate Edit failed");
      }
      const rveProject = payload?.rveProject;
      if (!rveProject?.overlays || !Array.isArray(rveProject.overlays)) {
        throw new Error("Generate Edit returned no overlays");
      }
      setProgressText("Downloading clips locally…");
      const localizedProject = await prefetchImportAssets(rveProject as any, controller.signal);
      if (controller.signal.aborted || runId !== runRef.current) return;
      if (typeof window !== "undefined" && (payload?.jobId || payload?.jobID)) {
        try {
          const key = payload.jobId || payload.jobID;
          const payloadStr = JSON.stringify(localizedProject);
          window.sessionStorage.setItem(`ge2-import-${key}`, payloadStr);
          window.localStorage.setItem(`ge2-import-${key}`, payloadStr);
        } catch {
          /* ignore storage errors */
        }
      }
      const rveWithBlobs = localizedProject as any;
      const canvas = getAspectRatioDimensions();
      const fillOverlay = (overlay: Overlay): Overlay => {
        if (normalizeType(overlay.type) === OverlayType.SOUND) return overlay;
        // Keep authoring-time positioning; only backfill objectFit/ObjectPosition defaults.
        return {
          ...overlay,
          styles: {
            ...overlay.styles,
            objectFit: overlay.styles?.objectFit ?? "cover",
            objectPosition: (overlay.styles as any)?.objectPosition ?? "center center",
          },
          width: Number(overlay.width) || canvas.width,
          height: Number(overlay.height) || canvas.height,
          left: Number.isFinite((overlay as any).left) ? overlay.left : 0,
          top: Number.isFinite((overlay as any).top) ? overlay.top : 0,
        };
      };

      const normalized = (rveWithBlobs.overlays as any[]).map(normalizeOverlay).map(fillOverlay);
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
        if (controller.signal.aborted || runId !== runRef.current) return;
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
        setProgressText("Generate Edit complete. You can close this panel.");
        autoCloseTimerRef.current = window.setTimeout(() => {
          seekTo(0);
          requestTimelineCollapseToRows(2);
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
      {showCursor && (
        <div
          className="pointer-events-none fixed z-[60] h-6 w-6 rounded-full border-2 border-emerald-300 bg-emerald-300/30 shadow-[0_0_12px_rgba(16,185,129,0.6)] transition-all duration-300 ease-out"
          style={{ left: cursorPos.left, top: cursorPos.top, transform: "translate(-50%, -50%)" }}
        />
      )}
      <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-[1px] flex flex-col text-white">
        <div className="relative flex items-center px-3 py-2 min-h-12 border border-[#3a404d] border-l-0 border-t-0 bg-[#2f343d] text-slate-100">
          <div className="absolute left-3">
            <Button variant="secondary" size="sm" onClick={handleClose} className="bg-white/10 text-white hover:bg-white/20">
              Back to player
            </Button>
          </div>
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm font-semibold">Generate Edit</span>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 items-center justify-center bg-black px-3 py-2" data-seek-scan-container>
          <div className={cn("w-full max-w-xl space-y-4 transition-opacity duration-75", isSeekAnimating && "opacity-0 pointer-events-none")}>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-white/60">Pick A Format</label>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={status === "loading" || !formats.length}
                className="w-full rounded-md border border-white/15 bg-[#0f172a] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                {!formats.length && <option value="">No formats</option>}
                {formats.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.name || f.slug}
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={runGenerateEdit}
              disabled={!selected || status === "loading" || !formats.length}
              className={cn(
                "w-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-70 disabled:cursor-not-allowed",
                status === "complete" && "bg-emerald-500 hover:bg-emerald-400"
              )}
            >
              {status === "loading" ? "Loading" : status === "complete" ? "Complete" : "Create Edit"}
            </Button>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/80 min-h-[48px] flex items-center hidden">
              {progressText}
            </div>
            {status === "error" && error && (
              <div className="text-sm text-red-300 bg-red-900/40 border border-red-500/40 rounded-md p-3">{error}</div>
            )}
          </div>
        </div>
      </div>
    </>,
    portalEl
  );
}
