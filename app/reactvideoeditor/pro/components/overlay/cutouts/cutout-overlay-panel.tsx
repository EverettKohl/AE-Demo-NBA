import { useCallback, useEffect, useState } from "react";
import { useEditorContext } from "../../../contexts/editor-context";
import { useTimelinePositioning } from "../../../hooks/use-timeline-positioning";
import { useAspectRatio } from "../../../hooks/use-aspect-ratio";
import { MediaGrid } from "../shared/media-grid";
import { Overlay, OverlayType } from "../../../types";
import { AlertCircle } from "lucide-react";

type RawCutoutClip = {
  id: string;
  cloudinaryId?: string;
  start?: number;
  end?: number;
  cutoutImage?: boolean;
  meta?: {
    cutoutImageMap?: {
      processedAssetId?: string;
      frame?: number;
      frameRate?: number;
      frameSeconds?: number;
      clipStartSeconds?: number;
      clipEndSeconds?: number;
      cloudinaryId?: string;
      videoId?: string;
    };
  };
};

type CutoutItem = {
  id: string;
  _source: string;
  _sourceDisplayName: string;
  thumbnail: string;
  processedAssetId: string;
  cloudinaryId: string;
  frameSeconds: number;
  clipEndSeconds: number;
  start: number;
  end: number;
};

const IMAGE_DURATION_SECONDS = 1;
const MIN_VIDEO_DURATION_SECONDS = 0.05;

const getFrameSeconds = (clip: RawCutoutClip): number => {
  const map = clip.meta?.cutoutImageMap;
  if (!map) return clip.start ?? 0;
  if (typeof map.frameSeconds === "number") return map.frameSeconds;
  if (typeof map.frame === "number" && typeof map.frameRate === "number" && map.frameRate > 0) {
    return map.frame / map.frameRate;
  }
  return clip.start ?? 0;
};

const getClipEndSeconds = (clip: RawCutoutClip): number => {
  const map = clip.meta?.cutoutImageMap;
  if (map?.clipEndSeconds !== undefined) return map.clipEndSeconds;
  if (clip.end !== undefined) return clip.end;
  return getFrameSeconds(clip) + 1;
};

export const CutoutOverlayPanel: React.FC = () => {
  const [cutouts, setCutouts] = useState<CutoutItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingItemKey, setLoadingItemKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

  const { overlays, currentFrame, fps, setOverlays, setSelectedOverlayId } = useEditorContext();
  const { addAtPlayhead } = useTimelinePositioning();
  const { getAspectRatioDimensions } = useAspectRatio();

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const poolModule = await import("@/data/instantClipPool2.json");
        const poolData = (poolModule as any).default ?? poolModule;
        const clips: RawCutoutClip[] = Array.isArray(poolData?.clips) ? poolData.clips : [];

        const mapped = clips
          .filter(
            (clip) =>
              clip.cutoutImage === true &&
              clip.meta?.cutoutImageMap?.processedAssetId &&
              (clip.meta.cutoutImageMap.cloudinaryId || clip.cloudinaryId)
          )
          .map((clip) => {
            const map = clip.meta!.cutoutImageMap!;
            const frameSeconds = getFrameSeconds(clip);
            const clipEndSeconds = getClipEndSeconds(clip);
            const version = map.version || map.v || map.ver || undefined;
            const versionPrefix = version ? `/v${version}` : "";

            return {
              id: clip.id,
              _source: "cutout",
              _sourceDisplayName: "Cutouts",
              processedAssetId: map.processedAssetId as string,
              cloudinaryId: (map.cloudinaryId || clip.cloudinaryId)!,
              frameSeconds,
              clipEndSeconds,
              start: clip.start ?? frameSeconds,
              end: clip.end ?? clipEndSeconds,
              thumbnail: cloudName
                ? `https://res.cloudinary.com/${cloudName}/image/upload${versionPrefix}/${map.processedAssetId}.png`
                : "",
            };
          });

        setCutouts(mapped);
        if (!cloudName) {
          setError("Cloudinary cloud name missing (.env NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME). Thumbnails and clips will not load.");
        }
      } catch (err) {
        console.error("Failed to load cutout pool", err);
        setError("Unable to load cutout pool. Please retry.");
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [cloudName]);

  const addCutoutToTimeline = useCallback(
    async (cutout: CutoutItem) => {
      if (!cloudName) {
        setError("Cloudinary cloud name missing; cannot add cutout.");
        return;
      }

      setLoadingItemKey(cutout.id);
      setError(null);

      try {
        const { updatedOverlays, from, row } = addAtPlayhead(currentFrame, overlays, "top");
        const canvasDimensions = getAspectRatioDimensions();

        let nextId =
          updatedOverlays.length > 0 ? Math.max(...updatedOverlays.map((o) => o.id)) + 1 : 0;

        const imageDurationInFrames = Math.max(1, Math.round(fps * IMAGE_DURATION_SECONDS));
        const imageOverlay: Overlay = {
          id: nextId++,
          left: 0,
          top: 0,
          width: canvasDimensions.width,
          height: canvasDimensions.height,
          durationInFrames: imageDurationInFrames,
          from,
          rotation: 0,
          row,
          isDragging: false,
          type: OverlayType.IMAGE,
          src: cutout.thumbnail,
          styles: {
            objectFit: "contain",
            animation: {
              enter: "fadeIn",
              exit: "fadeOut",
            },
          },
        };

        let workingOverlays: Overlay[] = [...updatedOverlays, imageOverlay];

        const videoStartSeconds = cutout.frameSeconds;
        const videoDurationSeconds = Math.max(cutout.clipEndSeconds - videoStartSeconds, 0);

        if (videoDurationSeconds > MIN_VIDEO_DURATION_SECONDS) {
          const durationInFrames = Math.max(1, Math.round(videoDurationSeconds * fps));
          // Start exactly when the image ends (frame-aligned handoff).
          const videoFrom = from + imageDurationInFrames;
          const maxRow = workingOverlays.length
            ? Math.max(...workingOverlays.map((o) => o.row))
            : row;
          const videoRow = Math.max(row + 1, maxRow + 1);

          const transformation = `so_${videoStartSeconds.toFixed(3)},du_${videoDurationSeconds.toFixed(
            3
          )},f_mp4,vc_auto`;
          const cloudinaryUrl = `https://res.cloudinary.com/${cloudName}/video/upload/${transformation}/${cutout.cloudinaryId}.mp4`;

          const response = await fetch(cloudinaryUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error("Failed to fetch trimmed video for cutout.");
          }

          const arrayBuffer = await response.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: "video/mp4" });
          const objectUrl = URL.createObjectURL(blob);

          const videoOverlay: Overlay = {
            id: nextId++,
            left: 0,
            top: 0,
            width: canvasDimensions.width,
            height: canvasDimensions.height,
            durationInFrames,
            from: videoFrom,
            rotation: 0,
            row: videoRow,
            isDragging: false,
            type: OverlayType.VIDEO,
            content: cutout.id,
            src: objectUrl,
            videoStartTime: 0,
            mediaSrcDuration: videoDurationSeconds,
            styles: {
              opacity: 1,
              zIndex: 100,
              transform: "none",
              objectFit: "contain",
              animation: {
                enter: "none",
                exit: "none",
              },
            },
          } as Overlay;

          workingOverlays = [...workingOverlays, videoOverlay];
        }

        setOverlays(workingOverlays);
        setSelectedOverlayId(imageOverlay.id);
      } catch (err) {
        console.error("Failed to add cutout", err);
        setError(err instanceof Error ? err.message : "Unable to add cutout.");
      } finally {
        setLoadingItemKey(null);
      }
    },
    [
      addAtPlayhead,
      cloudName,
      currentFrame,
      fps,
      getAspectRatioDimensions,
      overlays,
      setOverlays,
      setSelectedOverlayId,
    ]
  );

  return (
    <div className="flex flex-col p-2 h-full overflow-hidden">
      {error ? (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-500">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <p className="mb-3 text-xs text-muted-foreground">
          Select a cutout to place a 1s PNG, then continue the source clip from the matching frame.
        </p>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <MediaGrid
          items={cutouts}
          isLoading={isLoading}
          isDurationLoading={!!loadingItemKey}
          loadingItemKey={loadingItemKey}
          hasAdaptors
          hasSearched
          activeTab="all"
          sourceResults={[]}
          mediaType="cutouts"
          onItemClick={addCutoutToTimeline}
          getThumbnailUrl={(item) => item.thumbnail}
          getItemKey={(item) => item.id}
          showSourceBadge={false}
          enableTimelineDrag={false}
        />
      </div>
    </div>
  );
};
