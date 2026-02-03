import {
  useCurrentFrame,
  delayRender,
  continueRender,
  Html5Video,
  Sequence,
} from "remotion";
import { ClipOverlay, TextOverlay } from "../../../types";
import { animationTemplates, getAnimationKey } from "../../../adaptors/default-animation-adaptors";
import { toAbsoluteUrl } from "../../general/url-helper";
import { useEffect, useRef, useCallback } from "react";
import { useEditorContext } from "../../../contexts/editor-context";
import { FPS } from "../../../../constants";
import { calculateObjectFitDimensions } from "../helpers/object-fit-calculator";

/**
 * Interface defining the props for the VideoLayerContent component
 */
interface VideoLayerContentProps {
  /** The overlay configuration object containing video properties and styles */
  overlay: ClipOverlay;
  /** The base URL for the video */
  baseUrl?: string;
  /** Optional negative text overlays to render on top of the video */
  negativeTexts?: {
    overlay: TextOverlay;
    from: number;
    durationInFrames: number;
  }[];
  /** Optional cutout text overlays to render as masks */
  cutoutTexts?: {
    overlay: TextOverlay;
    from: number;
    durationInFrames: number;
  }[];
}

/**
 * Hook to safely use editor context only when available
 */
const useSafeEditorContext = () => {
  try {
    return useEditorContext();
  } catch {
    return { baseUrl: undefined };
  }
};

/**
 * VideoLayerContent component renders a video layer with animations and styling
 *
 * This component handles:
 * - Video playback using Remotion's OffthreadVideo
 * - Enter/exit animations based on the current frame
 * - Styling including transform, opacity, border radius, etc.
 * - Video timing and volume controls
 * - Optional greenscreen removal using canvas processing
 *
 * @param props.overlay - Configuration object for the video overlay including:
 *   - src: Video source URL
 *   - videoStartTime: Start time offset for the video
 *   - durationInFrames: Total duration of the overlay
 *   - styles: Object containing visual styling properties and animations
 *   - greenscreen: Optional greenscreen removal configuration
 */
export const VideoLayerContent: React.FC<VideoLayerContentProps> = ({
  overlay,
  baseUrl,
  negativeTexts = [],
  cutoutTexts = [],
}) => {
  const frame = useCurrentFrame();
  const { baseUrl: contextBaseUrl } = useSafeEditorContext() as any;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastProcessedFrameRef = useRef<CanvasImageSource | null>(null);
  const negativeMaskId = `neg-mask-${overlay.id}`;
  // Small bleed so cutout masks fully cover the player bounds without edge slivers.
  const cutoutMaskBleed = 2;
  const cutoutMaskWidth = (overlay.width || 0) + cutoutMaskBleed * 2;
  const cutoutMaskHeight = (overlay.height || 0) + cutoutMaskBleed * 2;

  /**
   * Responsive font size calculation for text masks (cutout / negative).
   * Mirrors adaptive sizing used in text-layer-content so resizing the box
   * scales the mask text visually.
   */
  const computeResponsiveFontSize = useCallback((text: any) => {
    const fontSizeScale = text?.styles?.fontSizeScale || 1;

    const baseFromStyle = (() => {
      const raw = text?.styles?.fontSize;
      if (typeof raw === "number") return raw;
      if (typeof raw === "string") {
        if (raw.endsWith("px")) return parseFloat(raw);
        if (raw.endsWith("rem")) return parseFloat(raw) * 16;
        const num = parseFloat(raw);
        return Number.isFinite(num) ? num : 48;
      }
      return 48;
    })();

    const content = (text?.content || "").toString();
    const lines = Math.max(1, content.split("\n").length);
    const lineHeight = parseFloat(text?.styles?.lineHeight || "1.2") || 1.2;

    const width = Math.max(20, text?.width || 0);
    const height = Math.max(20, text?.height || 0);

    const heightBased = height / (lines * lineHeight);
    const avgCharWidthRatio = 0.5;
    const maxLineLength = Math.max(4, content.split("\n").reduce((m, l) => Math.max(m, l.length), 0));
    const widthBased = width / (maxLineLength * avgCharWidthRatio);

    const derived = Math.min(heightBased, widthBased);
    const candidate = Number.isFinite(derived) ? derived : baseFromStyle;

    const maxSize = Math.min(height * 0.8, width * 0.3, 200);
    const minSize = 8;

    const finalSize = Math.max(minSize, Math.min(candidate * 0.95, maxSize));
    return finalSize * fontSizeScale;
  }, []);

  // Use prop baseUrl first, then context baseUrl
  const resolvedBaseUrl = baseUrl || contextBaseUrl;

  // Determine the video source URL (mirror pro behavior)
  let videoSrc = overlay.src;
  
  // If it's an API route, use toAbsoluteUrl to ensure proper domain
  if (videoSrc?.startsWith("/api/")) {
    videoSrc = toAbsoluteUrl(videoSrc, resolvedBaseUrl);
  }
  // If it's a relative URL and baseUrl is provided, use baseUrl
  else if (videoSrc?.startsWith("/") && resolvedBaseUrl) {
    videoSrc = `${resolvedBaseUrl}${videoSrc}`;
  }
  // Otherwise use the toAbsoluteUrl helper for relative URLs
  else if (videoSrc?.startsWith("/")) {
    videoSrc = toAbsoluteUrl(videoSrc, resolvedBaseUrl);
  } else {
  }

  const hasVideoSrc = Boolean(videoSrc);

  // Respect track-level mute (same behavior as Sound overlays)
  const trackMuted = (overlay as any).trackMuted;
  const effectiveVolume = (overlay.styles?.volume ?? 1) * (trackMuted ? 0 : 1);
  const playbackRate = overlay.speed ?? 1;

  useEffect(() => {
    if (!videoSrc) return;
    const handle = delayRender("Loading video");
    const video = document.createElement("video");
    video.src = videoSrc;

    const handleLoadedMetadata = () => {
      continueRender(handle);
    };

    const handleError = (error: ErrorEvent) => {
      console.error(`Error loading video ${overlay.src}:`, error);
      continueRender(handle);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
      // Ensure we don't leave hanging render delays
      continueRender(handle);
    };
  }, [overlay.src, videoSrc]);

  // Process video frame with greenscreen removal
  const processVideoFrame = useCallback(
    (videoFrame: CanvasImageSource) => {
      if (!canvasRef.current || !overlay.greenscreen?.enabled) {
        return;
      }

      const context = canvasRef.current.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return;
      }

      // Store the last processed frame for reprocessing on resize
      lastProcessedFrameRef.current = videoFrame;

      // Get dimensions
      const canvasWidth = canvasRef.current.width;
      const canvasHeight = canvasRef.current.height;
      const videoWidth = (videoFrame as HTMLVideoElement).videoWidth || canvasWidth;
      const videoHeight = (videoFrame as HTMLVideoElement).videoHeight || canvasHeight;

      // Clear canvas
      context.clearRect(0, 0, canvasWidth, canvasHeight);

      // Calculate objectFit positioning using helper
      const objectFit = overlay.styles.objectFit || "cover";
      const { drawX, drawY, drawWidth, drawHeight } = calculateObjectFitDimensions(
        videoWidth,
        videoHeight,
        canvasWidth,
        canvasHeight,
        objectFit
      );

      // Draw the video frame to canvas
      context.drawImage(videoFrame, drawX, drawY, drawWidth, drawHeight);

      // Get image data for pixel manipulation
      const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
      const { data } = imageData;

      // Get greenscreen configuration with defaults
      const config = overlay.greenscreen;
      const sensitivity = config.sensitivity ?? 100;
      const redThreshold = config.threshold?.red ?? 100;
      const greenMin = config.threshold?.green ?? 100;
      const blueThreshold = config.threshold?.blue ?? 100;
      const smoothing = config.smoothing ?? 0;
      const spill = config.spill ?? 0;

      // Process each pixel
      for (let i = 0; i < data.length; i += 4) {
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];
        const alpha = data[i + 3];

        // Check if pixel is green (greenscreen)
        if (green > greenMin && red < redThreshold && blue < blueThreshold) {
          // Calculate how "green" this pixel is for smooth transition
          const greenness = (green - Math.max(red, blue)) / 255;
          const alphaReduction = Math.min(1, greenness * (sensitivity / 100));
          
          // Apply transparency based on greenness and sensitivity
          data[i + 3] = alpha * (1 - alphaReduction);
        } else if (spill > 0) {
          // Remove green spill from non-green pixels
          const greenSpill = Math.max(0, green - Math.max(red, blue));
          if (greenSpill > 0) {
            data[i + 1] = Math.max(0, green - greenSpill * spill);
          }
        }
      }

      // Apply smoothing if enabled (simple box blur on alpha channel)
      if (smoothing > 0) {
        const smoothedData = new Uint8ClampedArray(data);
        const radius = Math.min(10, smoothing);
        
        for (let y = radius; y < canvasHeight - radius; y++) {
          for (let x = radius; x < canvasWidth - radius; x++) {
            let alphaSum = 0;
            let count = 0;

            // Average alpha values in neighborhood
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const idx = ((y + dy) * canvasWidth + (x + dx)) * 4;
                alphaSum += data[idx + 3];
                count++;
              }
            }

            const idx = (y * canvasWidth + x) * 4;
            smoothedData[idx + 3] = alphaSum / count;
          }
        }

        // Copy smoothed alpha back
        for (let i = 3; i < data.length; i += 4) {
          data[i] = smoothedData[i];
        }
      }

      // Put processed image data back to canvas
      context.putImageData(imageData, 0, 0);
    },
    [overlay.greenscreen, overlay.styles.objectFit]
  );

  // Reprocess last frame when dimensions change (handles resize while paused)
  useEffect(() => {
    if (overlay.greenscreen?.enabled && lastProcessedFrameRef.current) {
      processVideoFrame(lastProcessedFrameRef.current);
    }
  }, [overlay.width, overlay.height, processVideoFrame, overlay.greenscreen?.enabled]);

  // Greenscreen removal callback for video frame processing
  const onVideoFrame = useCallback(
    (videoFrame: CanvasImageSource) => {
      processVideoFrame(videoFrame);
    },
    [processVideoFrame]
  );

  // Calculate if we're in the exit phase (last 30 frames)
  const isExitPhase = frame >= overlay.durationInFrames - 30;
  
  // Apply enter animation only during entry phase
  const enterAnimation =
    !isExitPhase && overlay.styles.animation?.enter
      ? animationTemplates[getAnimationKey(overlay.styles.animation.enter)]?.enter(
          frame,
          overlay.durationInFrames
        )
      : {};

  // Apply exit animation only during exit phase

  const exitAnimation =
    isExitPhase && overlay.styles.animation?.exit
      ? animationTemplates[getAnimationKey(overlay.styles.animation.exit)]?.exit(
          frame,
          overlay.durationInFrames
        )
      : {};

  const videoStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: overlay.styles.objectFit || "cover",
    objectPosition: (overlay.styles as any)?.objectPosition || "center center",
    opacity: overlay.styles.opacity,
    transform: overlay.styles.transform || "none",
    filter: overlay.styles.filter || "none",
    ...(isExitPhase ? exitAnimation : enterAnimation),
  };

  // Create a container style that includes padding and background color
  const containerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    position: "relative",
    padding: overlay.styles.padding || "0px",
    backgroundColor: overlay.styles.paddingBackgroundColor || "transparent",
    display: "flex", // Use flexbox for centering
    alignItems: "center",
    justifyContent: "center",
    // Padding should be part of the total size
    boxSizing: "border-box",
    // Radius/border/shadow should wrap the padded container
    borderRadius: overlay.styles.borderRadius || "0px",
    border: overlay.styles.border || "none",
    boxShadow: overlay.styles.boxShadow || "none",
    // Ensure inner video respects rounded corners
    overflow: "hidden",
    // Apply clipPath at the container level so padding is also cropped
    clipPath: overlay.styles.clipPath || "none",
  };

  if (!hasVideoSrc) {
    console.error("Video overlay is missing a playable src", overlay);
    return null;
  }

  // Convert videoStartTime from seconds to frames for Html5Video.
  const startFromFrames = Math.round((overlay.videoStartTime || 0) * FPS);
  // If greenscreen removal is enabled, use canvas-based rendering
  if (overlay.greenscreen?.enabled) {
    return (
      <div style={containerStyle}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {/* Hidden video that feeds frames to canvas */}
          <Html5Video
            src={videoSrc}
            trimBefore={startFromFrames}
            style={{ 
              ...videoStyle,
              position: 'absolute',
              top: 0,
              left: 0,
              opacity: 0,
            }}
            volume={effectiveVolume}
            playbackRate={overlay.speed ?? 1}
            onError={(e: any) => {
              const videoEl = (e?.currentTarget as HTMLVideoElement) || null;
              // eslint-disable-next-line no-console
              console.error("[video-layer error][greenscreen source]", {
                id: (overlay as any)?.id,
                src: videoEl?.currentSrc,
                error: (videoEl as any)?.error,
                readyState: videoEl?.readyState,
              });
            }}
          />
          {/* Canvas that displays processed video with greenscreen removed */}
          <canvas
            ref={canvasRef}
            width={overlay.width}
            height={overlay.height}
            style={{
              ...videoStyle,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />
          {cutoutTexts.map(({ overlay: text, from, durationInFrames }) => {
            const maskId = `cutout-mask-${overlay.id}-${text.id}`;
            const dilateFilterId = `${maskId}-dilate`;
            const startFromOffset = Math.max(0, Math.round(from * playbackRate));
            const maskTrimBefore = startFromFrames + startFromOffset;

            const fontSize = `${computeResponsiveFontSize(text)}px`;

            const offsetX = (text.left || 0) - (overlay.left || 0);
            const offsetY = (text.top || 0) - (overlay.top || 0);
            const tintColor = (text.styles as any)?.negativeTintColor;
            const blendMode = (text.styles as any)?.mixBlendMode;
            const fontStretch = (text.styles as any)?.fontStretchScale || 1;
            const align = (text.styles.textAlign || "center") as
              | "left"
              | "center"
              | "right";
            const xPos =
              align === "left"
                ? offsetX
                : align === "right"
                ? offsetX + text.width
                : offsetX + text.width / 2;
            const yPos = offsetY + text.height / 2;
            const textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
            const rotation = text.rotation || 0;
            const fillColor = text.styles.cutoutFill || text.styles.backgroundColor || "#000000";

            const tintOpacity =
              typeof overlay.styles.opacity === "number"
                ? overlay.styles.opacity
                : 1;
            const hasTint = Boolean(tintColor) && tintOpacity > 0;
            return (
              <Sequence
                key={maskId}
                from={from}
                durationInFrames={durationInFrames}
              >
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
                    <defs>
                      <filter id={dilateFilterId} x="-2%" y="-2%" width="104%" height="104%">
                        <feMorphology in="SourceGraphic" operator="dilate" radius="0.4" />
                      </filter>
                      <mask
                        id={maskId}
                        maskContentUnits="userSpaceOnUse"
                        maskType="alpha"
                        x={-cutoutMaskBleed}
                        y={-cutoutMaskBleed}
                        width={cutoutMaskWidth}
                        height={cutoutMaskHeight}
                      >
                        <rect
                          x={-cutoutMaskBleed}
                          y={-cutoutMaskBleed}
                          width={cutoutMaskWidth}
                          height={cutoutMaskHeight}
                          fill="white"
                        />
                        <text
                          x={xPos}
                          y={yPos}
                          textAnchor={textAnchor}
                          dominantBaseline="middle"
                          fill="black"
                          stroke="black"
                          strokeWidth="0.7"
                          strokeLinejoin="round"
                          paintOrder="stroke"
                          fontFamily={text.styles.fontFamily}
                          fontWeight={text.styles.fontWeight}
                          fontSize={fontSize}
                          letterSpacing={text.styles.letterSpacing}
                          style={{ lineHeight: text.styles.lineHeight }}
                          filter={`url(#${dilateFilterId})`}
                          transform={
                            [
                              fontStretch !== 1
                                ? `translate(${xPos}, ${yPos}) scale(1, ${fontStretch}) translate(${-xPos}, ${-yPos})`
                                : "",
                              `rotate(${rotation}, ${xPos}, ${yPos})`,
                            ]
                              .filter(Boolean)
                              .join(" ")
                          }
                        >
                          {text.content}
                        </text>
                      </mask>
                    </defs>
                    <rect
                      x={-cutoutMaskBleed}
                      y={-cutoutMaskBleed}
                      width={cutoutMaskWidth}
                      height={cutoutMaskHeight}
                      fill={fillColor}
                      mask={`url(#${maskId})`}
                    />
                  </svg>
                </div>
              </Sequence>
            );
          })}
          {/* Single inverted video reused; mask updates per-frame for active negatives */}
          <svg width="0" height="0" style={{ position: "absolute" }}>
            <defs>
              <mask id={negativeMaskId} maskContentUnits="userSpaceOnUse">
                <rect width="100%" height="100%" fill="black" />
                {negativeTexts
                  .filter(({ from, durationInFrames }) => {
                    const start = from;
                    const end = from + durationInFrames;
                    return frame >= start && frame < end;
                  })
                  .map(({ overlay: text }) => {
                    const offsetX = (text.left || 0) - (overlay.left || 0);
                    const offsetY = (text.top || 0) - (overlay.top || 0);
                    const fontSize = `${computeResponsiveFontSize(text)}px`;
                    const align = (text.styles.textAlign || "center") as "left" | "center" | "right";
                    const xPos =
                      align === "left"
                        ? offsetX
                        : align === "right"
                        ? offsetX + text.width
                        : offsetX + text.width / 2;
                    const yPos = offsetY + text.height / 2;
                    const textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
                    const rotation = text.rotation || 0;
                    const fontStretch = (text.styles as any)?.fontStretchScale || 1;
                    return (
                      <text
                        key={text.id}
                        x={xPos}
                        y={yPos}
                        textAnchor={textAnchor}
                        dominantBaseline="middle"
                        fill="white"
                        fontFamily={text.styles.fontFamily}
                        fontWeight={text.styles.fontWeight}
                        fontSize={fontSize}
                        letterSpacing={text.styles.letterSpacing}
                        style={{ lineHeight: text.styles.lineHeight }}
                        transform={
                          [
                            fontStretch !== 1
                              ? `translate(${xPos}, ${yPos}) scale(1, ${fontStretch}) translate(${-xPos}, ${-yPos})`
                              : "",
                            `rotate(${rotation}, ${xPos}, ${yPos})`,
                          ]
                            .filter(Boolean)
                            .join(" ")
                        }
                      >
                        {text.content}
                      </text>
                    );
                  })}
              </mask>
            </defs>
          </svg>
          <Html5Video
            src={videoSrc}
            trimBefore={startFromFrames}
            style={{
              ...videoStyle,
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              filter: "invert(1)",
              mixBlendMode: "normal",
              mask: `url(#${negativeMaskId})`,
              WebkitMask: `url(#${negativeMaskId})`,
              pointerEvents: "none",
            }}
            muted
            volume={0}
            playbackRate={overlay.speed ?? 1}
          />
          {negativeTexts.some(({ overlay: text, from, durationInFrames }) => {
            const tintColor = (text.styles as any)?.negativeTintColor;
            const tintOpacity =
              typeof overlay.styles.opacity === "number" ? overlay.styles.opacity : 1;
            const active = frame >= from && frame < from + durationInFrames;
            return active && Boolean(tintColor) && tintOpacity > 0;
          }) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor:
                  (negativeTexts.find(
                    ({ overlay: text, from, durationInFrames }) =>
                      frame >= from &&
                      frame < from + durationInFrames &&
                      (text.styles as any)?.negativeTintColor
                  )?.overlay.styles as any)?.negativeTintColor || undefined,
                mask: `url(#${negativeMaskId})`,
                WebkitMask: `url(#${negativeMaskId})`,
                pointerEvents: "none",
                mixBlendMode: "normal",
                opacity:
                  typeof overlay.styles.opacity === "number" ? overlay.styles.opacity : 1,
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // Normal rendering without greenscreen removal
  return (
    <div style={containerStyle}>
      <Html5Video
        src={videoSrc}
        trimBefore={startFromFrames}
        style={videoStyle}
        volume={effectiveVolume}
        playbackRate={playbackRate}
        onError={(e: any) => {
          const videoEl = (e?.currentTarget as HTMLVideoElement) || null;
          // eslint-disable-next-line no-console
          console.error("[video-layer error]", {
            id: (overlay as any)?.id,
            src: videoEl?.currentSrc,
            error: (videoEl as any)?.error,
            readyState: videoEl?.readyState,
          });
        }}
      />
      {cutoutTexts.map(({ overlay: text, from, durationInFrames }) => {
        const maskId = `cutout-mask-${overlay.id}-${text.id}`;
        const dilateFilterId = `${maskId}-dilate`;
        const startFromOffset = Math.max(0, Math.round(from * playbackRate));
        const maskTrimBefore = startFromFrames + startFromOffset;

        const fontSize = `${computeResponsiveFontSize(text)}px`;

        const offsetX = (text.left || 0) - (overlay.left || 0);
        const offsetY = (text.top || 0) - (overlay.top || 0);
            const fontStretch = (text.styles as any)?.fontStretchScale || 1;
        const align = (text.styles.textAlign || "center") as
          | "left"
          | "center"
          | "right";
        const xPos =
          align === "left"
            ? offsetX
            : align === "right"
            ? offsetX + text.width
            : offsetX + text.width / 2;
        const yPos = offsetY + text.height / 2;
        const textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
        const rotation = text.rotation || 0;
        const fillColor = text.styles.cutoutFill || text.styles.backgroundColor || "#000000";

        return (
          <Sequence key={maskId} from={from} durationInFrames={durationInFrames}>
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
                <defs>
                  <filter id={dilateFilterId} x="-2%" y="-2%" width="104%" height="104%">
                    <feMorphology in="SourceGraphic" operator="dilate" radius="0.4" />
                  </filter>
                  <mask
                    id={maskId}
                    maskContentUnits="userSpaceOnUse"
                    maskType="alpha"
                    x={-cutoutMaskBleed}
                    y={-cutoutMaskBleed}
                    width={cutoutMaskWidth}
                    height={cutoutMaskHeight}
                  >
                    <rect
                      x={-cutoutMaskBleed}
                      y={-cutoutMaskBleed}
                      width={cutoutMaskWidth}
                      height={cutoutMaskHeight}
                      fill="white"
                    />
                    <text
                      x={xPos}
                      y={yPos}
                      textAnchor={textAnchor}
                      dominantBaseline="middle"
                      fill="black"
                      stroke="black"
                      strokeWidth="0.7"
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      fontFamily={text.styles.fontFamily}
                      fontWeight={text.styles.fontWeight}
                      fontSize={fontSize}
                      letterSpacing={text.styles.letterSpacing}
                          style={{ lineHeight: text.styles.lineHeight }}
                          filter={`url(#${dilateFilterId})`}
                          transform={
                            [
                              fontStretch !== 1
                                ? `translate(${xPos}, ${yPos}) scale(1, ${fontStretch}) translate(${-xPos}, ${-yPos})`
                                : "",
                              `rotate(${rotation}, ${xPos}, ${yPos})`,
                            ]
                              .filter(Boolean)
                              .join(" ")
                          }
                    >
                      {text.content}
                    </text>
                  </mask>
                </defs>
                <rect
                  x={-cutoutMaskBleed}
                  y={-cutoutMaskBleed}
                  width={cutoutMaskWidth}
                  height={cutoutMaskHeight}
                  fill={fillColor}
                  mask={`url(#${maskId})`}
                />
              </svg>
            </div>
          </Sequence>
        );
      })}
      {/* Single inverted video reused; mask updates per-frame for active negatives */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <mask id={negativeMaskId} maskContentUnits="userSpaceOnUse">
            <rect width="100%" height="100%" fill="black" />
            {negativeTexts
              .filter(({ from, durationInFrames }) => {
                const start = from;
                const end = from + durationInFrames;
                return frame >= start && frame < end;
              })
              .map(({ overlay: text }) => {
                const offsetX = (text.left || 0) - (overlay.left || 0);
                const offsetY = (text.top || 0) - (overlay.top || 0);
                const fontSize = `${computeResponsiveFontSize(text)}px`;
                const align = (text.styles.textAlign || "center") as "left" | "center" | "right";
                const xPos =
                  align === "left"
                    ? offsetX
                    : align === "right"
                    ? offsetX + text.width
                    : offsetX + text.width / 2;
                const yPos = offsetY + text.height / 2;
                const textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
                const rotation = text.rotation || 0;
                const fontStretch = (text.styles as any)?.fontStretchScale || 1;
                return (
                  <text
                    key={text.id}
                    x={xPos}
                    y={yPos}
                    textAnchor={textAnchor}
                    dominantBaseline="middle"
                    fill="white"
                    stroke="white"
                    strokeWidth="0.7"
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    fontFamily={text.styles.fontFamily}
                    fontWeight={text.styles.fontWeight}
                    fontSize={fontSize}
                    letterSpacing={text.styles.letterSpacing}
                    style={{ lineHeight: text.styles.lineHeight }}
                    transform={
                      [
                        fontStretch !== 1
                          ? `translate(${xPos}, ${yPos}) scale(1, ${fontStretch}) translate(${-xPos}, ${-yPos})`
                          : "",
                        `rotate(${rotation}, ${xPos}, ${yPos})`,
                      ]
                        .filter(Boolean)
                        .join(" ")
                    }
                  >
                    {text.content}
                  </text>
                );
              })}
          </mask>
        </defs>
      </svg>
      <Html5Video
        src={videoSrc}
        trimBefore={startFromFrames}
        style={{
          ...videoStyle,
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          filter: "invert(1)",
          mixBlendMode: "normal",
          mask: `url(#${negativeMaskId})`,
          WebkitMask: `url(#${negativeMaskId})`,
          pointerEvents: "none",
        }}
        muted
        volume={0}
        playbackRate={playbackRate}
      />
      {negativeTexts.some(({ overlay: text, from, durationInFrames }) => {
        const tintColor = (text.styles as any)?.negativeTintColor;
        const tintOpacity = typeof overlay.styles.opacity === "number" ? overlay.styles.opacity : 1;
        const active = frame >= from && frame < from + durationInFrames;
        return active && Boolean(tintColor) && tintOpacity > 0;
      }) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor:
              (negativeTexts.find(
                ({ overlay: text, from, durationInFrames }) =>
                  frame >= from &&
                  frame < from + durationInFrames &&
                  (text.styles as any)?.negativeTintColor
              )?.overlay.styles as any)?.negativeTintColor || undefined,
            mask: `url(#${negativeMaskId})`,
            WebkitMask: `url(#${negativeMaskId})`,
            pointerEvents: "none",
            mixBlendMode: "normal",
            opacity: typeof overlay.styles.opacity === "number" ? overlay.styles.opacity : 1,
          }}
        />
      )}
    </div>
  );
}; 