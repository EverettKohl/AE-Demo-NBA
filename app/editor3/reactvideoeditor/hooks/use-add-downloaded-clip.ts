import { useCallback } from "react";
import { ingestFromBlobUrl } from "../../lib/media-ingest";
import { Overlay, OverlayType } from "../types";
import { useEditorContext } from "../contexts/editor-context";
import { useTimelinePositioning } from "./use-timeline-positioning";

/**
 * Small helper hook to add a downloaded MP4 clip to the editor3 timeline.
 * - Uses addAtPlayhead to place the clip on the top row at the current frame.
 * - Never writes files locally; expects a blob/object URL for playback.
 * - Stores Cloudinary provenance so the full project can be re‑exported later.
 */
export const useAddDownloadedClip = () => {
  const {
    overlays,
    currentFrame,
    setOverlays,
    setSelectedOverlayId,
    getAspectRatioDimensions,
    fps,
  } = useEditorContext();

  const { addAtPlayhead } = useTimelinePositioning();

  return useCallback(
    async ({
      blobUrl,
      durationSeconds,
      startSeconds,
      endSeconds,
      cloudinaryPublicId,
      mainCloudinaryPublicId,
      thumbnail,
      filename,
    }: {
      blobUrl: string; // object URL for the downloaded MP4
      durationSeconds: number;
      startSeconds: number;
      endSeconds: number;
      cloudinaryPublicId?: string; // specific clipped public ID if available
      mainCloudinaryPublicId?: string; // base/original asset ID (preferred)
      thumbnail?: string;
      filename?: string;
    }) => {
      const effectiveFps = fps ?? 30;
      const durationInFrames = Math.max(1, Math.round(durationSeconds * effectiveFps));
      const { width, height } = getAspectRatioDimensions();

      const { from, row, updatedOverlays } = addAtPlayhead(
        currentFrame || 0,
        overlays,
        "top"
      );

      const newId =
        updatedOverlays.length > 0
          ? Math.max(...updatedOverlays.map((o) => o.id)) + 1
          : 0;

      const ingest = await ingestFromBlobUrl(blobUrl, {
        kind: "video",
        durationSeconds,
        thumbnail,
        name: filename || "clip.mp4",
      });

      const overlay: Overlay = {
        id: newId,
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
        content: thumbnail || ingest.blobUrl,
        src: ingest.blobUrl,
        videoStartTime: startSeconds,
        mediaSrcDuration: durationSeconds,
        styles: {
          opacity: 1,
          zIndex: 100,
          transform: "none",
          objectFit: "contain",
          animation: { enter: "none", exit: "none" },
        },
        // Persist Cloudinary provenance for later export/render
        cloudinary: {
          basePublicId: mainCloudinaryPublicId || cloudinaryPublicId,
          clipPublicId: cloudinaryPublicId,
          start: startSeconds,
          end: endSeconds,
        },
        // Persist local media linkage for rehydration
        localMediaId: ingest.localMediaId as any,
      };

      const final = [...updatedOverlays, overlay];
      setOverlays(final);
      setSelectedOverlayId(newId);
      return overlay;
    },
    [
      addAtPlayhead,
      currentFrame,
      overlays,
      setOverlays,
      setSelectedOverlayId,
      getAspectRatioDimensions,
      fps,
    ]
  );
};
