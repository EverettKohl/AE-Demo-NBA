"use client";

import { useMemo, useState } from "react";

import alphaData from "@/data/alpha-test.json";
import { useEditorContext } from "@editor/reactvideoeditor/contexts/editor-context";
import { useTimelinePositioning } from "@editor/reactvideoeditor/hooks/use-timeline-positioning";
import { useAspectRatio } from "@editor/reactvideoeditor/hooks/use-aspect-ratio";
import { getSrcDuration } from "@editor/reactvideoeditor/hooks/use-src-duration";
import { StandardVideo } from "@editor/reactvideoeditor/types/media-adaptors";
import { Overlay, OverlayType } from "@editor/reactvideoeditor/types";
import {
  calculateIntelligentAssetSize,
  getAssetDimensions,
} from "@editor/reactvideoeditor/utils/asset-sizing";
import { MediaGrid } from "@editor/reactvideoeditor/components/overlay/shared/media-grid";

type ClipItem = StandardVideo & {
  _source: string;
  _sourceDisplayName: string;
};

const CLIP_SOURCE_ID = "cloudinary-clips" as const;
const CLIP_SOURCE_LABEL = "Cloudinary Clips" as const;

const buildThumbnailFromVideoUrl = (videoUrl: string) => {
  try {
    const url = new URL(videoUrl);
    const [prefix, rest] = url.pathname.split("/video/upload/");
    if (!rest) return videoUrl;

    const transformedPath = rest.replace(/\.(mp4|mov|webm)$/i, ".jpg");
    url.pathname = `${prefix}/video/upload/so_0,q_auto,f_jpg/${transformedPath}`;
    return url.toString();
  } catch (error) {
    console.warn("Failed to build thumbnail URL, falling back to video URL", error);
    return videoUrl;
  }
};

const curatedClips: ClipItem[] = (() => {
  const providedClip: ClipItem = {
    id: "kill-bill-vol1-part2-main",
    type: "video",
    width: 1920,
    height: 1080,
    duration: 12,
    thumbnail: buildThumbnailFromVideoUrl(
      "https://res.cloudinary.com/fanedit/video/upload/v1769119748/Kill_Bill_Vol1_Part2_30FPS_CUTOUTtest_mcxzly.mov"
    ),
    // Order matters: put VP9/alpha first for Chromium; HEVC second for Safari.
    videoFiles: [
      {
        quality: "hd",
        // VP9 with transparency for Chrome/Edge; uses Cloudinary transform
        format: 'video/webm; codecs="vp9"',
        url: "https://res.cloudinary.com/fanedit/video/upload/f_webm,vc_vp9,fl_preserve_transparency,q_auto:best/Kill_Bill_Vol1_Part2_30FPS_CUTOUTtest_mcxzly.webm",
      },
      {
        quality: "hd",
        // HEVC with alpha for Safari
        format: 'video/mp4; codecs="hvc1"',
        url: "https://res.cloudinary.com/fanedit/video/upload/v1769119748/Kill_Bill_Vol1_Part2_30FPS_CUTOUTtest_mcxzly.mov",
      },
    ],
    _source: CLIP_SOURCE_ID,
    _sourceDisplayName: CLIP_SOURCE_LABEL,
  };

  const alphaAssets: ClipItem[] = (alphaData.assets || []).map((asset, idx) => {
    const url = asset.webmUrl || asset.originalUrl;
    return {
      id: asset.assetId || asset.publicId || `alpha-${idx}`,
      type: "video",
      width: asset.width || 1920,
      height: asset.height || 1080,
      duration: asset.durationSeconds,
      thumbnail: buildThumbnailFromVideoUrl(url),
      videoFiles: [
        {
          quality: "hd",
          format: "video/mp4",
          url,
        },
      ],
      _source: CLIP_SOURCE_ID,
      _sourceDisplayName: CLIP_SOURCE_LABEL,
    };
  });

  // Deduplicate by id while preserving order
  const seen = new Set<string>();
  const combined = [providedClip, ...alphaAssets].filter((item) => {
    if (!item.id || seen.has(String(item.id))) return false;
    seen.add(String(item.id));
    return !!item.videoFiles?.[0]?.url;
  });

  return combined;
})();

const getPlayableVideoUrl = (video: ClipItem): string => {
  const files = video.videoFiles || [];

  if (typeof document !== "undefined") {
    const testVideo = document.createElement("video");

    // Try each candidate in order; prefer those the browser can likely play
    for (const file of files) {
      const type = file.format || "";
      const canPlay = testVideo.canPlayType(type);
      if (canPlay === "probably" || canPlay === "maybe") {
        return file.url;
      }
    }
  }

  // If canPlayType didn't help (SSR or unknown), prefer webm/vp9 first
  const webmFallback = files.find((f) => f.format?.toLowerCase().includes("webm"));
  if (webmFallback) {
    return webmFallback.url;
  }

  // Final fallback: first URL, or empty string if none
  return files[0]?.url || "";
};

export const ClipsOverlayPanel: React.FC = () => {
  const { overlays, selectedOverlayId, currentFrame, setOverlays, setSelectedOverlayId } = useEditorContext();

  const { addAtPlayhead } = useTimelinePositioning();
  const { getAspectRatioDimensions } = useAspectRatio();

  const [isDurationLoading, setIsDurationLoading] = useState(false);
  const [loadingItemKey, setLoadingItemKey] = useState<string | null>(null);

  const selectedOverlay =
    selectedOverlayId !== null ? overlays.find((overlay) => overlay.id === selectedOverlayId) : null;

  const handleAddClip = async (video: ClipItem) => {
    const itemKey = getItemKey(video);
    setIsDurationLoading(true);
    setLoadingItemKey(itemKey);

    try {
      const videoUrl = getPlayableVideoUrl(video);
      if (!videoUrl) return;

      let durationInFrames = 200;
      let mediaSrcDuration: number | undefined;

      try {
        const result = await getSrcDuration(videoUrl);
        durationInFrames = result.durationInFrames;
        mediaSrcDuration = result.durationInSeconds;
      } catch (error) {
        console.warn("Failed to get video duration, using fallback:", error);
      }

      const canvasDimensions = getAspectRatioDimensions();
      const assetDimensions = getAssetDimensions(video);
      const { width, height } = assetDimensions
        ? calculateIntelligentAssetSize(assetDimensions, canvasDimensions)
        : canvasDimensions;

      const { from, row, updatedOverlays } = addAtPlayhead(currentFrame, overlays, "top");
      const newOverlay = {
        left: 0,
        top: 0,
        width,
        height,
        durationInFrames,
        from,
        rotation: 0,
        row,
        isDragging: false,
        type: OverlayType.VIDEO,
        content: video.thumbnail || videoUrl,
        src: videoUrl,
        videoStartTime: 0,
        mediaSrcDuration,
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
      };

      const newId = updatedOverlays.length > 0 ? Math.max(...updatedOverlays.map((o) => o.id)) + 1 : 0;
      const overlayWithId = { ...newOverlay, id: newId } as Overlay;
      const finalOverlays = [...updatedOverlays, overlayWithId];

      setOverlays(finalOverlays);
      setSelectedOverlayId(newId);
    } finally {
      setIsDurationLoading(false);
      setLoadingItemKey(null);
    }
  };

  const memoizedClips = useMemo(() => curatedClips, []);

  return (
    <div className="flex h-full flex-col p-2 overflow-hidden">
      {!selectedOverlay ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Drop-ready Cloudinary clips. Click or drag a clip to add it to the timeline.
          </p>
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            <MediaGrid
              items={memoizedClips}
              isLoading={false}
              isDurationLoading={isDurationLoading}
              loadingItemKey={loadingItemKey}
              hasAdaptors
              hasSearched
              activeTab={CLIP_SOURCE_ID}
              sourceResults={[
                { adaptorName: CLIP_SOURCE_ID, adaptorDisplayName: CLIP_SOURCE_LABEL, itemCount: memoizedClips.length, hasMore: false },
              ]}
              mediaType="videos"
              onItemClick={handleAddClip}
              onEditClick={handleAddClip}
              getThumbnailUrl={(item) => item.thumbnail || buildThumbnailFromVideoUrl(item.videoFiles?.[0]?.url || "")}
              getItemKey={getItemKey}
              showSourceBadge={false}
              enableTimelineDrag
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {/* Reuse existing video details if a video overlay is selected */}
          {/* We avoid importing VideoDetails directly to keep this panel lightweight. */}
          {/* If richer editing is needed here, wire VideoDetails similarly to VideoOverlayPanel. */}
          <div className="text-sm text-muted-foreground">Select “Video” to edit clip properties.</div>
        </div>
      )}
    </div>
  );
};

const getItemKey = (video: ClipItem) => `${video._source}-${video.id}`;

