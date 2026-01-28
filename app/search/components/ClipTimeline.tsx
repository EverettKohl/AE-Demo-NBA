"use client";

import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { formatSeconds } from "../utils/time";

type TimelineProps = {
  playhead: number;
  setPlayhead: (v: number) => void;
  windowStart: number;
  windowEnd: number;
  clipStart: number;
  clipEnd: number;
  onChangeStart: (v: number) => void;
  onChangeEnd: (v: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onTrackClick?: (v: number) => void;
};

export const ClipTimeline: React.FC<TimelineProps> = ({
  playhead,
  setPlayhead,
  windowStart,
  windowEnd,
  clipStart,
  clipEnd,
  onChangeStart,
  onChangeEnd,
  onScrubStart,
  onScrubEnd,
  onTrackClick,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const duration = Math.max(windowEnd - windowStart, 0.1);
  const pct = (val: number) => Math.max(0, Math.min(100, ((val - windowStart) / duration) * 100));

  const startPct = pct(clipStart);
  const endPct = pct(clipEnd);
  const playheadPct = pct(playhead);

  const posToTime = (clientX: number) => {
    if (!trackRef.current) return windowStart;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return windowStart + ratio * duration;
  };

  const startDrag = (handle: "start" | "end") => {
    draggingRef.current = handle;
    setDragging(handle);
    onScrubStart();
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const t = posToTime(e.clientX);
      if (draggingRef.current === "start") {
        onChangeStart(Math.min(t, clipEnd - 0.05));
      } else {
        onChangeEnd(Math.max(t, clipStart + 0.05));
      }
    };
    const handleUp = () => {
      if (draggingRef.current) {
        draggingRef.current = null;
        setDragging(null);
        onScrubEnd();
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [clipEnd, clipStart, duration, onChangeEnd, onChangeStart, onScrubEnd, windowStart]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 text-[10px] font-mono text-slate-400">
        <span>{formatSeconds(windowStart)}</span>
        <span>{formatSeconds(windowEnd)}</span>
      </div>
      <div className="relative h-8 rounded-md bg-gray-900/60 border border-gray-700/70 overflow-visible">
        <div
          ref={trackRef}
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={(e) => {
            if (!trackRef.current || !onTrackClick) return;
            const rect = trackRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, x / rect.width));
            const t = windowStart + ratio * duration;
            onTrackClick(t);
          }}
        />
        <div className="absolute inset-y-0 left-2 right-2 flex items-center">
          <div className="h-[3px] w-full rounded-full bg-gray-600/70" />
        </div>
        <div
          className="absolute inset-y-[calc(50%-2px)] h-[4px] rounded-full bg-indigo-400/80 pointer-events-none"
          style={{ left: `${startPct}%`, width: `${Math.max(1, endPct - startPct)}%` }}
        />
        <Handle
          percent={startPct}
          color="emerald"
          label={formatSeconds(clipStart)}
          active={dragging === "start"}
          onMouseDown={(e) => {
            e.stopPropagation();
            startDrag("start");
          }}
        />
        <Handle
          percent={endPct}
          color="rose"
          label={formatSeconds(clipEnd)}
          active={dragging === "end"}
          onMouseDown={(e) => {
            e.stopPropagation();
            startDrag("end");
          }}
        />
        <div
          className="absolute top-1 bottom-1 z-20 w-[2px] bg-white pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="absolute -top-1.5 left-1/2 w-2.5 h-2.5 -translate-x-1/2 rounded-full bg-white border border-gray-800 shadow" />
        </div>
      </div>
    </div>
  );
};

const Handle = ({
  percent,
  color,
  label,
  active,
  onMouseDown,
}: {
  percent: number;
  color: "emerald" | "rose";
  label: string;
  active?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
}) => (
  <div
    className="absolute top-1 z-30 -translate-x-1/2 cursor-ew-resize"
    style={{ left: `${percent}%` }}
    title={label}
    data-handle
    onMouseDown={onMouseDown}
  >
    <div className="relative">
      <div
        className={clsx(
          "w-[6px] h-4 rounded-full",
          color === "emerald" ? "bg-emerald-400" : "bg-rose-400",
          active && "ring-1 ring-white/70"
        )}
      />
      <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <div
          className={clsx(
            "px-1.5 py-0.5 text-[10px] font-semibold text-white rounded shadow",
            color === "emerald" ? "bg-emerald-500" : "bg-rose-500"
          )}
        >
          {label}
        </div>
      </div>
    </div>
  </div>
);

