import React, { useMemo } from "react";
import { Sequence } from "remotion";
import type { FontInfo } from "@remotion/google-fonts";

import { Overlay, OverlayType, TextOverlay } from "../../types";
import { LayerContent } from "./layer-content";
import { VideoLayerContent } from "./components/video-layer-content";

/**
 * Props for the Layer component
 * @interface LayerProps
 * @property {Overlay} overlay - The overlay object containing position, dimensions, and content information
 * @property {string | undefined} baseUrl - The base URL for the video
 * @property {Record<string, FontInfo>} fontInfos - Font infos for rendering (populated during SSR/Lambda rendering)
 */
export const Layer: React.FC<{
  overlay: Overlay;
  allOverlays?: Overlay[];
  baseUrl?: string;
  fontInfos?: Record<string, FontInfo>;
}> = ({ overlay, allOverlays = [],  baseUrl, fontInfos }) => {
  /**
   * Memoized style calculations for the layer
   * Handles positioning, dimensions, rotation, and z-index based on:
   * - Overlay position (left, top)
   * - Dimensions (width, height)
   * - Rotation
   * - Row position for z-index stacking
   * - Selection state for pointer events
   *
   * @returns {React.CSSProperties} Computed styles for the layer
   */
  const style: React.CSSProperties = useMemo(() => {
    // Higher row numbers should be at the bottom
    // e.g. row 4 = z-index 60, row 0 = z-index 100
    const zIndex = 100 - (overlay.row || 0) * 10;

    const baseStyle: React.CSSProperties = {
      position: "absolute",
      left: overlay.left,
      top: overlay.top,
      width: overlay.width,
      height: overlay.height,
      transform: `rotate(${overlay.rotation || 0}deg)`,
      transformOrigin: "center center",
      zIndex,
      // Always disable pointer events on the actual content layer
      // Interaction happens through SelectionOutline component instead
      pointerEvents: "none",
    };

    return baseStyle;
  }, [
    overlay.height,
    overlay.left,
    overlay.top,
    overlay.width,
    overlay.rotation,
    overlay.row,
    (overlay as any).styles,
  ]);

  // Skip standalone negative/cutout text overlays; they will be rendered inside video layers
  if (
    overlay.type === OverlayType.TEXT &&
    ((overlay as any).styles?.effect === "negative" ||
      (overlay as any).styles?.effect === "cutout")
  ) {
    return null;
  }

  // Special handling for sound overlays
  if (overlay.type === OverlayType.SOUND) {
    return (
      <Sequence
        key={overlay.id}
        from={overlay.from}
        durationInFrames={overlay.durationInFrames}
      >
        <LayerContent overlay={overlay} {...(baseUrl && { baseUrl })} {...(fontInfos && { fontInfos })} />
      </Sequence>
    );
  }

  const isVideo = overlay.type === OverlayType.VIDEO;
  const videoStart = overlay.from;
  const videoEnd = videoStart + overlay.durationInFrames;

  const activeNegativeTexts = isVideo
    ? (allOverlays as Overlay[])
        .filter(
          (o) =>
            o.type === OverlayType.TEXT &&
            (o as any).styles?.effect === "negative"
        )
        .map((o) => o as TextOverlay)
        .map((text) => {
          const start = text.from;
          const end = text.from + text.durationInFrames;
          const overlapStart = Math.max(start, videoStart);
          const overlapEnd = Math.min(end, videoEnd);
          const duration = Math.max(0, overlapEnd - overlapStart);
          return {
            overlay: text,
            from: Math.max(0, overlapStart - videoStart),
            durationInFrames: duration,
          };
        })
        .filter((slot) => slot.durationInFrames > 0)
    : [];

  const activeCutoutTexts = isVideo
    ? (allOverlays as Overlay[])
        .filter(
          (o) =>
            o.type === OverlayType.TEXT &&
            (o as any).styles?.effect === "cutout"
        )
        .map((o) => o as TextOverlay)
        .map((text) => {
          const start = text.from;
          const end = text.from + text.durationInFrames;
          const overlapStart = Math.max(start, videoStart);
          const overlapEnd = Math.min(end, videoEnd);
          const duration = Math.max(0, overlapEnd - overlapStart);
          return {
            overlay: text,
            from: Math.max(0, overlapStart - videoStart),
            durationInFrames: duration,
          };
        })
        .filter((slot) => slot.durationInFrames > 0)
    : [];

  return (
    <Sequence
      key={overlay.id}
      from={overlay.from}
      durationInFrames={overlay.durationInFrames}
      premountFor={30}
    >
      <div style={style}>
        {isVideo ? (
          <VideoLayerContent
            overlay={overlay as any}
            negativeTexts={activeNegativeTexts}
            cutoutTexts={activeCutoutTexts}
            {...(baseUrl && { baseUrl })}
            {...(fontInfos && { fontInfos })}
          />
        ) : (
          <LayerContent overlay={overlay} {...(baseUrl && { baseUrl })} {...(fontInfos && { fontInfos })} />
        )}
      </div>
    </Sequence>
  );
}; 