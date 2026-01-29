"use client";

import React from "react";
import { createPortal } from "react-dom";
import { TIMELINE_CONSTANTS } from "@editor/reactvideoeditor/components/advanced-timeline/constants";
import { SEEK_ANIMATION_PLACEHOLDERS, preloadSeekAnimationPlaceholders } from "../animation/placeholders";
import styles from "../editor2-animation.module.css";

type RectLike = { x: number; y: number; width: number; height: number };

type SeekDragRequest = {
  targetFrame: number;
  targetRow: number;
  fps: number;
  totalFrames: number;
  onCommit: () => Promise<void> | void;
};

type VisualState = {
  phase: "seek" | "lock" | "drag";
  frameSrc: string;
  scanRect: RectLike;
  cursor: { x: number; y: number };
  ghost: { x: number; y: number; width: number; height: number; scale: number };
  target: { x: number; y: number; height: number };
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pickFrames = (count: number) => {
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * SEEK_ANIMATION_PLACEHOLDERS.length);
    frames.push(SEEK_ANIMATION_PLACEHOLDERS[idx]);
  }
  return frames;
};

const getPlayerScanRect = (): RectLike | null => {
  if (typeof document === "undefined") return null;
  const preferred = document.querySelector("[data-seek-scan-container]") as HTMLElement | null;
  const shell = preferred || (document.querySelector("#player-shell") as HTMLElement | null);
  if (!shell) return null;
  const rect = shell.getBoundingClientRect();
  const width = clamp(rect.width * 0.6, 180, rect.width * 0.95);
  const height = Math.min(width * (9 / 16), rect.height * 0.9);
  const x = rect.left + rect.width / 2 - width / 2;
  const y = rect.top + rect.height / 2 - height / 2;
  return { x, y, width, height };
};

const getTimelineTarget = (row: number, targetFrame: number, totalFrames: number): { x: number; y: number; height: number } | null => {
  if (typeof document === "undefined") return null;
  const timeline = document.querySelector(".timeline-zoomable-content") as HTMLElement | null;
  if (!timeline) return null;

  const tracks = Array.from(timeline.querySelectorAll(".timeline-tracks-container .track")) as HTMLElement[];
  const timelineRect = timeline.getBoundingClientRect();
  const scrollContainer = timeline.closest(".timeline-tracks-scroll-container") as HTMLElement | null;
  const scrollLeft = scrollContainer?.scrollLeft ?? 0;
  const scrollTop = scrollContainer?.scrollTop ?? 0;
  const contentWidth = timeline.scrollWidth || timelineRect.width;

  const clampedRow = clamp(row, 0, Math.max(0, tracks.length - 1));
  const trackEl = tracks[clampedRow] || tracks[tracks.length - 1] || timeline;
  const trackRect = trackEl.getBoundingClientRect();

  const ratio = totalFrames > 0 ? clamp(targetFrame / totalFrames, 0, 1) : 0;
  const x = timelineRect.left - scrollLeft + contentWidth * ratio;
  const y = trackRect.top - scrollTop + trackRect.height / 2;
  const height = trackRect.height || TIMELINE_CONSTANTS.TRACK_ITEM_HEIGHT;

  return { x, y, height };
};

const SeekDragOverlay: React.FC<{ visual: VisualState | null }> = ({ visual }) => {
  if (!visual) return null;
  const { scanRect, frameSrc, cursor, ghost, target, phase } = visual;

  return createPortal(
    <div className={styles.seekOverlay}>
      <div
        className={`${styles.scanBox} ${phase === "lock" ? styles.scanBoxLock : ""}`}
        style={{
          left: `${scanRect.x}px`,
          top: `${scanRect.y}px`,
          width: `${scanRect.width}px`,
          height: `${scanRect.height}px`,
        }}
      >
        <img src={frameSrc} alt="scan" className={styles.scanImage} />
        <div className={styles.scanGlow} />
      </div>

      <div
        className={styles.dragGhost}
        style={{
          transform: `translate(${ghost.x}px, ${ghost.y}px) translate(-50%, -50%) scale(${ghost.scale})`,
          width: `${ghost.width}px`,
          height: `${ghost.height}px`,
        }}
      >
        <img src={frameSrc} alt="drag ghost" />
      </div>

      <div
        className={styles.cursor}
        style={{
          transform: `translate(${cursor.x}px, ${cursor.y}px)`,
        }}
      />

    </div>,
    document.body
  );
};

export const useSeekDragAnimation = () => {
  const [visual, setVisual] = React.useState<VisualState | null>(null);
  const [isAnimating, setIsAnimating] = React.useState(false);
  const queueRef = React.useRef(Promise.resolve());

  React.useEffect(() => {
    preloadSeekAnimationPlaceholders();
  }, []);

  const playSeekDragAnimation = React.useCallback(
    (request: SeekDragRequest) => {
      queueRef.current = queueRef.current.then(async () => {
        setIsAnimating(true);
        const scanRect = getPlayerScanRect();
        const target = getTimelineTarget(request.targetRow, request.targetFrame, request.totalFrames);
        const startRect = scanRect || target;

        if (!startRect || !target) {
          await request.onCommit();
          setVisual(null);
          return;
        }

        const seekFrames = pickFrames(8);
        const scanDuration = 60;
        const lockDuration = 15;
        const dragDuration = 35;

        // Seeking frames
        for (let i = 0; i < seekFrames.length; i++) {
          setVisual({
            phase: "seek",
            frameSrc: seekFrames[i],
            scanRect: startRect,
            cursor: { x: startRect.x + startRect.width * 0.5, y: startRect.y + startRect.height * 0.5 },
            ghost: {
              x: startRect.x + startRect.width * 0.5,
              y: startRect.y + startRect.height * 0.5,
              width: startRect.width,
              height: startRect.height,
              scale: 1,
            },
            target,
          });
          await sleep(scanDuration / seekFrames.length);
        }

        // Lock moment
        setVisual((prev) =>
          prev
            ? {
                ...prev,
                phase: "lock",
              }
            : null
        );
        await sleep(lockDuration);

        // Drag animation
        await new Promise<void>((resolve) => {
          let committed = false;
          const start = performance.now();
          const step = async () => {
            const now = performance.now();
            const tRaw = (now - start) / dragDuration;
            const t = clamp(tRaw, 0, 1);

            const ghostX = lerp(startRect.x + startRect.width * 0.5, target.x, t);
            const ghostY = lerp(startRect.y + startRect.height * 0.5, target.y, t);
            const ghostScale = lerp(1, target.height / Math.max(1, startRect.height), t);
            const cursorX = lerp(startRect.x + startRect.width * 0.5 + 10, target.x + 8, t);
            const cursorY = lerp(startRect.y + startRect.height * 0.5 + 10, target.y + 6, t);

            setVisual({
              phase: "drag",
              frameSrc: seekFrames[seekFrames.length - 1],
              scanRect: startRect,
              cursor: { x: cursorX, y: cursorY },
              ghost: {
                x: ghostX,
                y: ghostY,
                width: startRect.width,
                height: startRect.height,
                scale: ghostScale,
              },
              target,
            });

            if (!committed && t >= 0.65) {
              committed = true;
              Promise.resolve(request.onCommit()).catch(() => undefined);
            }

            if (t < 1) {
              requestAnimationFrame(step);
            } else {
              resolve();
            }
          };
          requestAnimationFrame(step);
        });

        // Brief settle
        await sleep(10);
        setVisual(null);
        setIsAnimating(false);
      });

      return queueRef.current;
    },
    []
  );

  const overlayElement = visual ? <SeekDragOverlay visual={visual} /> : null;

  return { playSeekDragAnimation, overlayElement, isAnimating };
};
