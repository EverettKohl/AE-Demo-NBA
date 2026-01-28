"use client";

import React from "react";
import {
  Clapperboard,
  ImageIcon,
  FolderOpen,
  Music,
  Subtitles,
  Type,
  Layout,
  Settings,
  ArrowLeft,
  X,
  Sparkles,
  Bot,
  Search,
} from "lucide-react";

import { Overlay, OverlayType } from "@editor/reactvideoeditor/types";
import { useEditorSidebar } from "@editor/reactvideoeditor/contexts/sidebar-context";
import { useEditorContext } from "@editor/reactvideoeditor/contexts/editor-context";

import { VideoOverlayPanel } from "@editor/reactvideoeditor/components/overlay/video/video-overlay-panel";
import { TextOverlaysPanel } from "@editor/reactvideoeditor/components/overlay/text/text-overlays-panel";
import SoundsOverlayPanel from "@editor/reactvideoeditor/components/overlay/sounds/sounds-overlay-panel";
import { CaptionsOverlayPanel } from "@editor/reactvideoeditor/components/overlay/captions/captions-overlay-panel";
import { ImageOverlayPanel } from "@editor/reactvideoeditor/components/overlay/images/image-overlay-panel";
import { LocalMediaPanel } from "@editor/reactvideoeditor/components/overlay/local-media/local-media-panel";
import { StickersPanel } from "@editor/reactvideoeditor/components/overlay/stickers/stickers-panel";
import { TemplateOverlayPanel } from "@editor/reactvideoeditor/components/overlay/templates/template-overlay-panel";
import { SettingsPanel } from "@editor/reactvideoeditor/components/settings/settings-panel";
import { ClipsOverlayPanel } from "@editor/reactvideoeditor/components/overlay/clips/clips-overlay-panel";
import alphaData from "@/data/alpha-test.json";
import instantClipPool from "@/data/instantClipPool.json";
import lowClipAssetMap from "@/data/clip-asset-map.low.json";
import { useTimelinePositioning } from "@editor/reactvideoeditor/hooks/use-timeline-positioning";
import { getClipUrl } from "@/utils/cloudinary";
import { FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./constants";
import SongFormatPicker from "@/components/SongFormatPicker";
import LoadingSpinner from "@/components/LoadingSpinner";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@editor/reactvideoeditor/components/ui/sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@editor/reactvideoeditor/components/ui/sheet";
import { Button } from "@editor/reactvideoeditor/components/ui/button";
import { cn } from "@editor/reactvideoeditor/utils/general/utils";
import styles from "./editor2-layout.module.css";

type NavItem = {
  title: string;
  panel: OverlayType;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navigation: NavGroup[] = [
  {
    label: "Media",
    items: [
      { title: "Search", panel: OverlayType.VIDEO, icon: Search },
      { title: "Clips", panel: OverlayType.SEARCH, icon: Clapperboard },
      { title: "Images", panel: OverlayType.IMAGE, icon: ImageIcon },
      { title: "Uploads", panel: OverlayType.LOCAL_DIR, icon: FolderOpen },
    ],
  },
  {
    label: "Audio",
    items: [
      { title: "Audio", panel: OverlayType.SOUND, icon: Music },
      { title: "Captions", panel: OverlayType.CAPTION, icon: Subtitles },
    ],
  },
  {
    label: "Creative",
    items: [
      { title: "Text", panel: OverlayType.TEXT, icon: Type },
      { title: "Templates", panel: OverlayType.TEMPLATE, icon: Layout },
    ],
  },
];

const LOW_BUCKET_KEYS = ["0.07", "0.10", "0.17", "0.70", "0.80"];
const applyCloudName = (url?: string | null) => {
  if (!url) return url || "";
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "__CLOUD_NAME__";
  return url.replace(/__CLOUD_NAME__/g, cloud);
};

const RAIL_TOOLTIP_LABELS = new Set([
  "AI Clip Fill",
  "Generate Edit",
  "Search",
  "Clips",
  "Images",
  "Uploads",
  "Audio",
  "Captions",
  "Text",
  "Templates",
  "Settings",
]);

type ClipPoolItem = {
  id: string;
  cloudinaryId: string;
  duration: number;
  width?: number;
  height?: number;
  thumbnail?: string | null;
  start?: number;
  end?: number;
  fps?: number;
  fallbackUrl?: string;
  prewarmedUrl?: string | null;
  bucketSeconds?: number | null;
};

const extractPublicIdFromCloudinaryUrl = (videoUrl: string): string | null => {
  try {
    const url = new URL(videoUrl);
    const afterUpload = url.pathname.split("/upload/")[1];
    if (!afterUpload) return null;

    const segments = afterUpload.split("/");

    // Remove transform segment if present (comma-delimited options)
    let idx = 0;
    if (segments[idx]?.includes(",")) idx += 1;

    // Remove version segment (v123456789)
    if (segments[idx]?.match(/^v\\d+$/)) idx += 1;

    const publicPath = segments.slice(idx).join("/");
    if (!publicPath) return null;

    return publicPath.replace(/\\.[^/.]+$/, "") || null;
  } catch {
    return null;
  }
};

const buildLowClipPool = (): ClipPoolItem[] => {
  const data = lowClipAssetMap as any;
  if (!data?.clips?.length) return [];
  const pool: ClipPoolItem[] = [];
  for (const clip of data.clips) {
    for (const bucket of LOW_BUCKET_KEYS) {
      const url = applyCloudName(clip?.sub1s?.[bucket]);
      const publicId = clip?.sub1sPublicIds?.[bucket] || "";
      if (!url || !publicId) continue;
      const duration = Number(bucket) || 0;
      if (!(duration > 0)) continue;
      pool.push({
        id: `${clip.id}::${bucket}`,
        cloudinaryId: publicId,
        duration,
        width: 1280,
        height: 720,
        thumbnail: clip.thumbnail || null,
        start: 0,
        end: duration,
        fps: FPS,
        fallbackUrl: url,
        prewarmedUrl: url,
        bucketSeconds: duration,
      });
    }
  }
  // Debug: log pool size
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.log("[AI Clip Fill] low pool size", pool.length);
  }
  return pool;
};

const buildClipPool = (): ClipPoolItem[] => {
  const lowPool = buildLowClipPool();
  if (lowPool.length) return lowPool;
  const poolClips: ClipPoolItem[] = Array.isArray((instantClipPool as any)?.clips)
    ? (instantClipPool as any).clips
        .map((clip: any, idx: number) => {
          if (clip?.type !== "clip" || !clip.cloudinaryId) return null;
          const start = Number(clip.start ?? clip.startSeconds ?? 0);
          const end = Number(clip.end ?? clip.endSeconds ?? start + (clip.duration ?? 0));
          const duration = Number(clip.duration ?? end - start);
          if (!(duration > 0)) return null;
          return {
            id: String(clip.id ?? `clip-${idx}`),
            cloudinaryId: String(clip.cloudinaryId),
            duration,
            start,
            end,
            fps: Number(clip.fps) || FPS,
            width: clip.width,
            height: clip.height,
            thumbnail: clip.thumbnail || null,
          } as ClipPoolItem;
        })
        .filter(Boolean)
    : [];

  // Fallback: include alpha assets if pool is empty
  const alphaAssets: ClipPoolItem[] = !poolClips.length && Array.isArray((alphaData as any)?.assets)
    ? (alphaData as any).assets
        .map((asset: any, idx: number) => {
          const url = asset.webmUrl || asset.originalUrl || "";
          if (!url) return null;
          const publicId = extractPublicIdFromCloudinaryUrl(url);
          if (!publicId) return null;
          return {
            id: String(asset.assetId || asset.publicId || `alpha-${idx}`),
            cloudinaryId: publicId,
            duration: Number(asset.durationSeconds) || 5,
            width: asset.width,
            height: asset.height,
            thumbnail:
              asset.thumbnailUrl ||
              asset.posterUrl ||
              url.replace(/\.(mp4|mov|webm)$/i, ".jpg"),
            fallbackUrl: url,
          } as ClipPoolItem;
        })
        .filter(Boolean)
    : [];

  const deduped: ClipPoolItem[] = [];
  const seen = new Set<string>();
  [...poolClips, ...alphaAssets].forEach((item) => {
    if (!item?.id || !item.cloudinaryId) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    deduped.push(item);
  });

  return deduped;
};

const renderActivePanel = (panel?: OverlayType | null) => {
  switch (panel) {
    case OverlayType.TEXT:
      return <TextOverlaysPanel />;
    case OverlayType.SOUND:
      return <SoundsOverlayPanel />;
    case OverlayType.SEARCH:
      return <ClipsOverlayPanel />;
    case OverlayType.VIDEO:
      return <VideoOverlayPanel />;
    case OverlayType.CAPTION:
      return <CaptionsOverlayPanel />;
    case OverlayType.IMAGE:
      return <ImageOverlayPanel />;
    case OverlayType.STICKER:
      return <StickersPanel />;
    case OverlayType.LOCAL_DIR:
      return <LocalMediaPanel />;
    case OverlayType.TEMPLATE:
      return <TemplateOverlayPanel />;
    case OverlayType.SETTINGS:
      return <SettingsPanel />;
    default:
      return null;
  }
};

const getPanelTitle = (panel?: OverlayType | null) => {
  switch (panel) {
    case OverlayType.VIDEO:
      return "Search";
    case OverlayType.TEXT:
      return "Text";
    case OverlayType.SEARCH:
      return "Clips";
    case OverlayType.SOUND:
      return "Audio";
    case OverlayType.CAPTION:
      return "Captions";
    case OverlayType.IMAGE:
      return "Images";
    case OverlayType.STICKER:
      return "Stickers";
    case OverlayType.LOCAL_DIR:
      return "Uploads";
    case OverlayType.TEMPLATE:
      return "Templates";
    case OverlayType.SETTINGS:
      return "Settings";
    default:
      return "Panels";
  }
};

export const Editor2Sidebar: React.FC = () => {
  const { activePanel, setActivePanel, setIsOpen } = useEditorSidebar();
  const { setSelectedOverlayId, selectedOverlayId, overlays, currentFrame, setOverlays } = useEditorContext();
  const { addAtPlayhead } = useTimelinePositioning();
  const uiSidebar = useSidebar();
  const clipPool = React.useMemo(() => buildClipPool(), []);
  const [tooltip, setTooltip] = React.useState<{
    label: string;
    x: number;
    y: number;
    visible: boolean;
    region: "rail" | "panel" | null;
  }>({
    label: "",
    x: 0,
    y: 0,
    visible: false,
    region: null,
  });

  const [geSheetOpen, setGeSheetOpen] = React.useState(false);
  const [geFormats, setGeFormats] = React.useState<any[]>([]);
  const [geSelectedSong, setGeSelectedSong] = React.useState("");
  const [geChronological, setGeChronological] = React.useState(false);
  const [geLoadingFormats, setGeLoadingFormats] = React.useState(false);
  const [geRunning, setGeRunning] = React.useState(false);
  const [geStatus, setGeStatus] = React.useState("Select a song format and run Generate Edit.");
  const [geError, setGeError] = React.useState("");
  const [geJobId, setGeJobId] = React.useState<string | null>(null);
  const [geLaunchUrl, setGeLaunchUrl] = React.useState<string | null>(null);
  const geAbortRef = React.useRef<AbortController | null>(null);
  const geRunIdRef = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    const loadFormats = async () => {
      setGeLoadingFormats(true);
      try {
        const res = await fetch("/api/song-edit");
        if (!res.ok) throw new Error("Unable to load song formats");
        const payload = await res.json();
        const formatsList = Array.isArray(payload.formats) ? payload.formats : [];
        if (!cancelled) {
          setGeFormats(formatsList);
          if (formatsList.length) setGeSelectedSong((prev) => prev || formatsList[0].slug);
        }
      } catch (err: any) {
        if (!cancelled) setGeError(err?.message || "Failed to load formats");
      } finally {
        if (!cancelled) setGeLoadingFormats(false);
      }
    };
    loadFormats();
    return () => {
      cancelled = true;
    };
  }, []);

  const waitForEditorImport = React.useCallback(
    async (
      jobId: string,
      {
        signal,
        timeoutMs = 2 * 60 * 1000,
        pollMs = 1500,
      }: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {}
    ) => {
      const start = Date.now();
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const res = await fetch(`/api/editor-imports/${encodeURIComponent(jobId)}`, { signal });
        if (res.ok) {
          const data = await res.json();
          if (data?.rveProject) return data;
        } else if (res.status >= 400 && res.status < 500 && res.status !== 404) {
          const errPayload = await res.json().catch(() => null);
          throw new Error(errPayload?.error || "Failed to load Generate Edit import");
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error("Generate Edit is still preparing. Please try again in a moment.");
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
    []
  );

  const selectedOverlay =
    selectedOverlayId !== null ? overlays.find((overlay) => overlay.id === selectedOverlayId) : null;
  const shouldShowBackButton = selectedOverlay && selectedOverlay.type === activePanel;

  const handleNavigate = (panel: OverlayType) => {
    setActivePanel(panel);
    setIsOpen(true);
  };

  const buildProxyUrl = React.useCallback((url: string) => {
    if (!url || /^\/(api|static|uploads)\//.test(url) || url.startsWith("/")) return url;
    if (!/^https?:\/\//i.test(url)) return url;
    return `/api/proxy-video?url=${encodeURIComponent(url)}`;
  }, []);

  const handleAutoAiClips = React.useCallback(async () => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[AI Clip Fill] invoked");
    }

    if (!clipPool.length) {
      console.warn("No clips available in pool for AI fill");
      return;
    }

    const clipFrames = 10;
    const totalClips = 15;
    const clipDurationSeconds = clipFrames / FPS;

    // Place on top row starting at current playhead; shift existing rows down
    const { from: startFrom, row, updatedOverlays } = addAtPlayhead(currentFrame || 0, overlays, "top");

    const viablePool = clipPool.filter(
      (clip) => (clip.bucketSeconds ?? clip.duration ?? 0) >= clipDurationSeconds
    );
    const poolForSelection = viablePool.length ? viablePool : clipPool;
    const shuffled = [...poolForSelection].sort(() => 0.5 - Math.random());
    const selection = shuffled.slice(0, totalClips);
    if (typeof window !== "undefined") {
      console.log("[AI Clip Fill] clipPool", clipPool.length, "viable", viablePool.length, "selection", selection.length);
    }

    let nextId = updatedOverlays.length > 0 ? Math.max(...updatedOverlays.map((o) => o.id)) + 1 : 0;
    const newOverlays: Overlay[] = [];

    const prewarmUrl = async (url: string) => {
      if (!url) return false;
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { Range: "bytes=0-1" },
          cache: "no-store",
        });
        return res.ok;
      } catch (err) {
        console.warn("Prewarm failed for", url, err);
        return false;
      }
    };

    const warmDecoder = async (url: string, startSec: number) => {
      if (typeof document === "undefined" || !url) return;
      return new Promise<void>((resolve) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.src = url;

        let done = false;
        let timeoutId: number | null = null;

        const cleanup = () => {
          video.removeEventListener("loadedmetadata", onLoadedMetadata);
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };

        const finish = () => {
          if (done) return;
          done = true;
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
          cleanup();
          resolve();
        };

        const onError = () => finish();
        const onSeeked = () => finish();
        const onLoadedMetadata = () => {
          try {
            video.currentTime = Math.max(0, startSec + 0.001);
            video.addEventListener("seeked", onSeeked, { once: true });
          } catch {
            finish();
          }
        };

        timeoutId = window.setTimeout(finish, 1200);
        video.addEventListener("loadedmetadata", onLoadedMetadata);
        video.addEventListener("error", onError);
        video.load();
      });
    };

    for (let idx = 0; idx < totalClips; idx++) {
      try {
        const clip = selection[idx % selection.length];
      const bucketDuration = clip.bucketSeconds ?? null;
      const availableStart = bucketDuration !== null ? 0 : Number.isFinite(clip.start) ? clip.start! : 0;
      const rawAvailableEnd =
        bucketDuration !== null
          ? bucketDuration
          : Number.isFinite(clip.end) && clip.end! > availableStart
          ? clip.end!
          : availableStart + (clip.duration || clipDurationSeconds);
      // Add a small tail safety margin to avoid end-of-file seeks
      const tailSpan = Math.max(0, rawAvailableEnd - availableStart);
      const safetyMargin = Math.min(0.1, tailSpan * 0.25);
      const availableEnd = Math.max(
        availableStart,
        Math.min(
          rawAvailableEnd - safetyMargin,
          availableStart + Math.max(clip.duration || clipDurationSeconds, clipDurationSeconds)
        )
      );
      const span = Math.max(clipDurationSeconds, availableEnd - availableStart);
      const startSpan = Math.max(0, availableEnd - availableStart - clipDurationSeconds);
      const startSec =
        span > clipDurationSeconds
          ? availableStart + Math.random() * startSpan
          : availableStart;
      const endSec = Math.min(availableEnd, startSec + clipDurationSeconds);

      const publicId = clip.cloudinaryId;
      const fps = clip.fps || FPS;
      const fallbackBase =
        process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME && publicId
          ? `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/video/upload/${publicId}.mp4`
          : clip.prewarmedUrl || clip.fallbackUrl || "";

      let trimmedUrl = fallbackBase;
      let isTrimmed = Boolean(clip.prewarmedUrl);
      if (!isTrimmed && publicId) {
        try {
          trimmedUrl = getClipUrl(publicId, startSec, endSec, {
            download: false,
            maxDuration: Math.max(0.05, endSec - startSec),
          });
          isTrimmed = true;
        } catch (err) {
          console.warn("Failed to build Cloudinary trim URL, falling back to base clip", err);
          trimmedUrl = fallbackBase;
          isTrimmed = false;
        }
      }

      // Probe availability; if the trimmed variant fails, fall back to base clip URL
      let candidateUrl = buildProxyUrl(trimmedUrl);
      let candidateTrimmed = isTrimmed;
      const warmed = await prewarmUrl(candidateUrl);
      if (!warmed) {
        candidateUrl = buildProxyUrl(fallbackBase);
        candidateTrimmed = false;
        await prewarmUrl(candidateUrl);
      }

      // Pre-warm decoder to have a keyframe ready
      await warmDecoder(candidateUrl, candidateTrimmed ? 0 : startSec);

      if (!candidateUrl) {
        console.warn("Skipping clip with no resolvable URL", clip);
        continue;
      }

      // Blob prefetch disabled: use streaming/proxy URL directly
      const finalUrl = candidateUrl;

      if (typeof window !== "undefined") {
        console.log("[AI Clip Fill] adding clip", {
          id: clip.id,
          bucketDuration,
          duration: clip.duration,
          startSec,
          endSec,
          candidateUrl,
          objectUrlExists: false,
          warmed,
        });
      }

      const overlay: Overlay = {
        id: nextId++,
        left: 0,
        top: 0,
        width: clip.width || VIDEO_WIDTH,
        height: clip.height || VIDEO_HEIGHT,
        durationInFrames: clipFrames,
        from: startFrom + idx * clipFrames,
        rotation: 0,
        row,
        isDragging: false,
        type: OverlayType.VIDEO,
        content: clip.thumbnail || finalUrl,
        src: finalUrl,
        // If we fell back to an untrimmed base URL, seek to the intended offset; otherwise start at 0.
        videoStartTime: candidateTrimmed ? 0 : startSec,
        mediaSrcDuration: clip.duration,
        styles: {
          opacity: 1,
          zIndex: 200,
          transform: "none",
          objectFit: "contain",
          animation: {
            enter: "none",
            exit: "none",
          },
        },
      };

      newOverlays.push(overlay);
      } catch (err) {
        console.error("[AI Clip Fill] per-clip failure, skipping clip", err);
        continue;
      }
    }

    if (typeof window !== "undefined") {
      console.log("[AI Clip Fill] built overlays", { newOverlays: newOverlays.length, updatedOverlays: updatedOverlays.length });
    }

    const nextOverlays = [...updatedOverlays, ...newOverlays];
    setOverlays(nextOverlays);
    setSelectedOverlayId(newOverlays[0]?.id ?? null);
    if (typeof window !== "undefined") {
      console.log("[AI Clip Fill] done, new overlays added", newOverlays.length, "total overlays", nextOverlays.length);
    }
  }, [addAtPlayhead, buildProxyUrl, clipPool, currentFrame, overlays, setOverlays, setSelectedOverlayId]);

  const handleGenerateEditRun = React.useCallback(async () => {
    if (!geSelectedSong) {
      setGeError("Pick a song format first");
      return;
    }
    geAbortRef.current?.abort();
    const abortController = new AbortController();
    geAbortRef.current = abortController;
    const runId = geRunIdRef.current + 1;
    geRunIdRef.current = runId;
    setGeRunning(true);
    setGeError("");
    setGeStatus("Running Generate Edit…");
    setGeJobId(null);
    setGeLaunchUrl(null);
    setSelectedOverlayId(null);
    setOverlays([]);
    try {
      const res = await fetch("/api/generate-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songSlug: geSelectedSong,
          chronologicalOrder: geChronological,
          includeCaptions: false,
          materialize: true,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Generate Edit failed");
      }
      const nextJobId = payload?.jobId || null;
      if (runId !== geRunIdRef.current) return;
      setGeJobId(nextJobId);
      if (nextJobId) {
        setGeStatus("Generate Edit complete. Finalizing assets…");
        const importPayload = await waitForEditorImport(nextJobId, { signal: abortController.signal }).catch((err) => {
          if (abortController.signal.aborted) return null;
          throw err;
        });
        if (!importPayload) return;
        if (runId !== geRunIdRef.current || abortController.signal.aborted) return;
        const nextUrl = `/editor3?geImport=${encodeURIComponent(nextJobId)}`;
        setGeLaunchUrl(nextUrl);
        setGeStatus("Generated. Open in editor to load clips.");
        if (typeof window !== "undefined") {
          setGeStatus("Generated. Loading into editor…");
          window.location.href = nextUrl;
        }
        return;
      }
      setGeStatus("Generated. Open in editor to load clips.");
    } catch (err: any) {
      if (!abortController.signal.aborted && runId === geRunIdRef.current) {
        setGeError(err?.message || "Generate Edit failed");
        setGeStatus("Generate Edit failed. Resolve errors and retry.");
      }
    } finally {
      if (runId === geRunIdRef.current) {
        setGeRunning(false);
        if (geAbortRef.current === abortController) {
          geAbortRef.current = null;
        }
      }
    }
  }, [geChronological, geSelectedSong, setOverlays, setSelectedOverlayId, waitForEditorImport]);

  return (
    <Sidebar
      collapsible="icon"
      className={styles.sidebarShell}
    >
      <div className={cn(styles.sidebarRail, "w-[calc(var(--sidebar-width-icon)+1px)]!")}>
        <SidebarHeader className={styles.sidebarHeader}>
          <div className={styles.sidebarMark}>FE</div>
        </SidebarHeader>

        <SidebarContent className="border-t border-border">
          <SidebarGroup className={styles.sidebarGroup}>
            <div className={styles.sidebarGroupLabel}>AI</div>
            <SidebarMenu className={styles.sidebarMenu}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleAutoAiClips}
                  data-label="AI Clip Fill"
                  className={cn(styles.navPill)}
                  title="Auto-fill 5s with 15 trimmed clips"
                  aria-label="AI Clip Fill"
                  onMouseEnter={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("AI Clip Fill")) return;
                    setTooltip({
                      label: "AI Clip Fill",
                      x: e.clientX,
                      y: e.clientY,
                      visible: true,
                      region: "rail",
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("AI Clip Fill")) return;
                    setTooltip((t) => ({
                      ...t,
                      x: e.clientX,
                      y: e.clientY,
                      region: "rail",
                    }));
                  }}
                  onMouseLeave={() =>
                    setTooltip((t) => ({
                      ...t,
                      visible: false,
                      region: null,
                    }))
                  }
                >
                  <Sparkles />
                  <span className={styles.navLabel}>AI</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setGeSheetOpen(true)}
                  data-label="Generate Edit"
                  className={cn(styles.navPill)}
                  title="Generate Edit"
                  aria-label="Generate Edit"
                  onMouseEnter={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Generate Edit")) return;
                    setTooltip({
                      label: "Generate Edit",
                      x: e.clientX,
                      y: e.clientY,
                      visible: true,
                      region: "rail",
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Generate Edit")) return;
                    setTooltip((t) => ({
                      ...t,
                      x: e.clientX,
                      y: e.clientY,
                      region: "rail",
                    }));
                  }}
                  onMouseLeave={() =>
                    setTooltip((t) => ({
                      ...t,
                      visible: false,
                      region: null,
                    }))
                  }
                >
                  <Bot />
                  <span className={styles.navLabel}>Gen Edit</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {navigation.map((group) => (
            <SidebarGroup key={group.label} className={styles.sidebarGroup}>
              <div className={styles.sidebarGroupLabel}>{group.label}</div>
              <SidebarMenu className={styles.sidebarMenu}>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      onClick={() => handleNavigate(item.panel)}
                      data-label={item.title}
                      className={cn(
                        styles.navPill,
                        activePanel === item.panel && styles.navPillActive
                      )}
                      data-active={activePanel === item.panel}
                      title={item.title}
                      aria-label={item.title}
                      onMouseEnter={(e) => {
                        if (!RAIL_TOOLTIP_LABELS.has(item.title)) return;
                        setTooltip({
                          label: item.title,
                          x: e.clientX,
                          y: e.clientY,
                          visible: true,
                          region: "rail",
                        });
                      }}
                      onMouseMove={(e) => {
                        if (!RAIL_TOOLTIP_LABELS.has(item.title)) return;
                        setTooltip((t) => ({
                          ...t,
                          x: e.clientX,
                          y: e.clientY,
                          region: "rail",
                        }));
                      }}
                      onMouseLeave={() =>
                        setTooltip((t) => ({
                          ...t,
                          visible: false,
                          region: null,
                        }))
                      }
                    >
                      <item.icon />
                      <span className={styles.navLabel}>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className={styles.sidebarFooter}>
          <SidebarMenu className={styles.sidebarMenu}>
            <SidebarMenuItem>
              <SidebarMenuButton
                className={cn(styles.navPill, activePanel === OverlayType.SETTINGS && styles.navPillActive)}
                onClick={() => handleNavigate(OverlayType.SETTINGS)}
                aria-label="Settings"
                title="Settings"
                data-label="Settings"
                onMouseEnter={(e) =>
                  setTooltip((prev) =>
                    RAIL_TOOLTIP_LABELS.has("Settings")
                      ? {
                          label: "Settings",
                          x: e.clientX,
                          y: e.clientY,
                          visible: true,
                          region: "rail",
                        }
                      : prev
                  )
                }
                onMouseMove={(e) =>
                  setTooltip((t) =>
                    RAIL_TOOLTIP_LABELS.has("Settings")
                      ? {
                          ...t,
                          x: e.clientX,
                          y: e.clientY,
                          region: "rail",
                        }
                      : t
                  )
                }
                onMouseLeave={() =>
                  setTooltip((t) => ({
                    ...t,
                    visible: false,
                    region: null,
                  }))
                }
              >
                <Settings />
                <span className={styles.navLabel}>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </div>

      <div className={cn(styles.sidebarPanelSurface)} data-state={uiSidebar.state}>
        <div className={styles.sidebarPanelHeader}>
          <div className={styles.panelTitle}>{getPanelTitle(activePanel)}</div>
          <div className="flex items-center gap-2">
            {shouldShowBackButton && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSelectedOverlayId(null)}
                aria-label="Back to all items"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Collapse sidebar"
              onClick={() => {
                uiSidebar.setOpen(false);
                setIsOpen(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <SidebarContent className={styles.sidebarPanelContent}>{renderActivePanel(activePanel)}</SidebarContent>
      </div>

      {tooltip.visible && tooltip.region === "rail" && RAIL_TOOLTIP_LABELS.has(tooltip.label) && (
        <div
          className={styles.sidebarTooltip}
          style={{ left: tooltip.x, top: tooltip.y }}
          aria-hidden
        >
          {tooltip.label}
        </div>
      )}

      <Sheet open={geSheetOpen} onOpenChange={setGeSheetOpen}>
        <SheetContent
          side="right"
          className="bg-[#0b0f1a] text-white border-l border-white/10 w-full sm:max-w-xl"
        >
          <SheetHeader className="mb-4">
            <SheetTitle>Generate Edit</SheetTitle>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70 hover:text-white">
                <X className="h-4 w-4" />
              </Button>
            </SheetClose>
          </SheetHeader>
          <SheetDescription className="text-white/70 mb-4">
            Build a Generate Edit and load it into the editor using locally saved clips (no Cloudinary streaming).
          </SheetDescription>

          <div className="space-y-4">
            <SongFormatPicker
              label="Song"
              helper="Choose a format to generate."
              formats={geFormats}
              loading={geLoadingFormats}
              selectedSong={geSelectedSong}
              onSelect={setGeSelectedSong}
              disabled={geRunning}
            />

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-white/60">Chronologic order</p>
                <p className="text-sm text-white/70">
                  {geChronological ? "Timeline coverage locked." : "Shuffle mode favors visual punch."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGeChronological((prev) => !prev)}
                disabled={geRunning}
                className="text-white border-white/20"
              >
                {geChronological ? "On" : "Off"}
              </Button>
            </div>

            <Button
              type="button"
              onClick={handleGenerateEditRun}
              disabled={geRunning || !geSelectedSong}
              className="w-full bg-emerald-500 text-black hover:bg-emerald-400"
            >
              {geRunning ? (
                <span className="inline-flex items-center gap-2">
                  <LoadingSpinner size="sm" /> Running…
                </span>
              ) : (
                "Generate Edit"
              )}
            </Button>

            {geError && <p className="text-sm text-rose-300">{geError}</p>}
            <p className="text-sm text-white/70">{geStatus}</p>

            {geLaunchUrl && (
              <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between text-xs text-white/60">
                  <span className="uppercase tracking-[0.25em]">Job</span>
                  <span>{geJobId}</span>
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={geRunning}
                  onClick={() => {
                    if (geLaunchUrl) window.location.href = geLaunchUrl;
                  }}
                >
                  Open in editor
                </Button>
                <p className="text-xs text-white/60 break-all">{geLaunchUrl}</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Sidebar>
  );
};
