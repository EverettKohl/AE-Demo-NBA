"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";

export const WAVEFORM_LAYERS = {
  volume: {
    label: "Volume",
    color: "#38bdf8",
    opacity: 0.35,
    type: "area",
  },
  subBass: {
    label: "Sub Bass",
    color: "#9333ea",
    opacity: 0.4,
    type: "area",
  },
  bass: {
    label: "Bass",
    color: "#ec4899",
    opacity: 0.4,
    type: "area",
  },
  lowMids: {
    label: "Low Mids",
    color: "#f97316",
    opacity: 0.4,
    type: "area",
  },
  mids: {
    label: "Mids",
    color: "#eab308",
    opacity: 0.35,
    type: "area",
  },
  highMids: {
    label: "High Mids",
    color: "#22c55e",
    opacity: 0.35,
    type: "area",
  },
  treble: {
    label: "Treble",
    color: "#06b6d4",
    opacity: 0.35,
    type: "area",
  },
  brilliance: {
    label: "Brilliance",
    color: "#3b82f6",
    opacity: 0.35,
    type: "area",
  },
  spectralFlux: {
    label: "Energy Change",
    color: "#f43f5e",
    opacity: 0.4,
    type: "area",
  },
  onsets: {
    label: "Onsets",
    color: "#10b981",
    opacity: 0.9,
    type: "markers",
  },
};

/**
 * UnifiedTimeline
 * Single horizontal timeline with multiple lanes (BG, FG, captions, rapid ranges)
 * - Displays segment grid (intro + segment intervals)
 * - Draggable segment boundaries (snap to frames)
 * - Click-to-select segments for inspector
 */
const PX_PER_SECOND = 80; // base; scaled by zoom
const LANE_HANDLE_WIDTH = 96; // px reserved on the left for the grab handle

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
const moveItem = (arr = [], from, to) => {
  const next = [...arr];
  const item = next.splice(from, 1)[0];
  next.splice(to, 0, item);
  return next;
};

const UnifiedTimeline = ({
  duration = 0,
  zoom = 1,
  onZoomChange = () => {},
  onSelectSegment = () => {},
  selectedSegment = null,
  currentTime = 0,
  onSeek = () => {},
  waveformData = null,
  waveformEnabled = true,
  onWaveformEnabledChange = () => {},
  waveformActiveLayers = {},
  waveformLayerStrengths = {},
  onWaveformLayerToggle = () => {},
  onWaveformStrengthChange = () => {},
  lanes = null,
  onLaneReorder = () => {},
  onSegmentResize = () => {},
  onSelectLayer = () => {},
  selectedLayerId = null,
  rapidRangesByLane = {},
}) => {
  const containerRef = useRef(null);
  const dragRafRef = useRef(null);
  const dragEventRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [waveformLayersOpen, setWaveformLayersOpen] = useState(false);
  const [laneDrag, setLaneDrag] = useState(null);
  const defaultActiveLayers = useMemo(
    () => ({
      volume: true,
      subBass: false,
      bass: false,
      lowMids: false,
      mids: false,
      highMids: false,
      treble: false,
      brilliance: false,
      spectralFlux: false,
      onsets: false,
    }),
    []
  );
  const activeLayers = useMemo(
    () => ({ ...defaultActiveLayers, ...(waveformActiveLayers || {}) }),
    [defaultActiveLayers, waveformActiveLayers]
  );
  const layerStrengths = useMemo(() => {
    const base = {};
    Object.keys(WAVEFORM_LAYERS).forEach((k) => (base[k] = 1));
    return { ...base, ...(waveformLayerStrengths || {}) };
  }, [waveformLayerStrengths]);

  const laneHeight = 40; // px per lane (thicker lane rows)
  const laneGap = 6; // vertical gap between lanes
  const rulerHeight = 24;
  const topOffset = 6;
  const hasDynamicLanes = Array.isArray(lanes) && lanes.length > 0;
  const laneCount = hasDynamicLanes ? lanes.length : 0;
  const lanesHeight = laneCount * laneHeight + (laneCount - 1) * laneGap;
  const containerHeight = rulerHeight + topOffset + lanesHeight + 6; // small padding bottom

  const totalWidth = useMemo(() => Math.max(800, duration * PX_PER_SECOND * zoom), [duration, zoom]);
  const handleOffset = hasDynamicLanes ? LANE_HANDLE_WIDTH : 0;
  const usableWidth = totalWidth;

  const effectiveLanes = useMemo(() => {
    if (!hasDynamicLanes || !Array.isArray(lanes)) return null;
    if (laneDrag) {
      return moveItem(lanes, laneDrag.startIndex, laneDrag.targetIndex);
    }
    return lanes;
  }, [hasDynamicLanes, lanes, laneDrag]);

  const timeToXRaw = useCallback(
    (timeSec) => {
      if (duration <= 0 || usableWidth <= 0) return 0;
      return (timeSec / duration) * usableWidth;
    },
    [duration, usableWidth]
  );
  const timeToXRuler = useCallback(
    (timeSec) => handleOffset + timeToXRaw(timeSec),
    [handleOffset, timeToXRaw]
  );
  const xToTime = useCallback(
    (x) => {
      if (duration <= 0 || usableWidth <= 0) return 0;
      const clamped = clamp(x - handleOffset, 0, usableWidth);
      return (clamped / usableWidth) * duration;
    },
    [duration, usableWidth, handleOffset]
  );

  const processDragEvent = useCallback(() => {
    dragRafRef.current = null;
    const evt = dragEventRef.current;
    if (!evt || !dragState || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clamp(
      evt.clientX - rect.left + containerRef.current.scrollLeft,
      0,
      handleOffset + usableWidth
    );
    const newTime = xToTime(x);
    const dragEdge = dragState.edge || "move";
    const segIndex = dragState.segmentIndex;
    if (dragEdge === "move") {
      const offsetSec = dragState.startOffsetSec ?? 0;
      const targetStart = Math.max(0, newTime - offsetSec);
      onSegmentResize(dragState.laneId, dragState.segmentId, "move", targetStart, segIndex);
    } else {
      onSegmentResize(dragState.laneId, dragState.segmentId, dragEdge, newTime, segIndex);
    }
  }, [dragState, handleOffset, usableWidth, xToTime, onSegmentResize]);

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragState || !containerRef.current) return;
      dragEventRef.current = e;
      if (dragRafRef.current) return;
      dragRafRef.current = requestAnimationFrame(processDragEvent);
    },
    [dragState, processDragEvent]
  );

  const handleMouseUp = useCallback(() => {
    dragEventRef.current = null;
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    setDragState(null);
  }, []);

  // Attach global listeners for boundary drag
  useEffect(() => {
    if (!dragState) return;
    const move = (e) => handleMouseMove(e);
    const up = () => handleMouseUp();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragState, handleMouseMove, handleMouseUp]);

  // Cleanup RAF if component unmounts during drag
  useEffect(() => {
    return () => {
      if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current);
    };
  }, []);

  // Seek handler for clicks/drag on timeline body
  const handleTimelineMouseDown = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left + containerRef.current.scrollLeft, 0, handleOffset + usableWidth);
    const t = xToTime(x);
    onSeek(t);
    setIsSeeking(true);
  };

  const handleTimelineMouseMove = (e) => {
    if (!isSeeking || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left + containerRef.current.scrollLeft, 0, handleOffset + usableWidth);
    const t = xToTime(x);
    onSeek(t);
  };

  const handleTimelineMouseUp = () => setIsSeeking(false);

  useEffect(() => {
    if (!isSeeking) return;
    const move = (e) => handleTimelineMouseMove(e);
    const up = () => handleTimelineMouseUp();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [isSeeking]);

  // Lane drag/reorder (dynamic lanes mode)
  useEffect(() => {
    if (!laneDrag || !hasDynamicLanes) return;
    const handleMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top - rulerHeight - topOffset;
      const laneSpan = laneHeight + laneGap;
      const target = clamp(Math.floor(y / laneSpan), 0, lanes.length - 1);
      setLaneDrag((prev) => ({
        ...prev,
        targetIndex: target,
        currentY: e.clientY,
      }));
    };
    const handleUp = () => {
      if (laneDrag.targetIndex !== laneDrag.startIndex) {
        const next = moveItem(lanes, laneDrag.startIndex, laneDrag.targetIndex);
        onLaneReorder(next);
      }
      setLaneDrag(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [
    laneDrag,
    hasDynamicLanes,
    lanes,
    laneHeight,
    laneGap,
    rulerHeight,
    topOffset,
    onLaneReorder,
  ]);

  // Segment edge drag (adjust segment boundaries)
  const handleSegmentEdgeMouseDown = (e, seg, lane, edge, laneId, segIndex) => {
    e.stopPropagation();
    setDragState({
      segmentId: seg.id || seg.index,
      laneId: laneId || lane,
      edge,
      startOffsetSec: null,
      segmentIndex: segIndex,
    });
  };

  const handleSegmentBlockMouseDown = (e, seg, lane, laneId, segIndex) => {
    if (!containerRef.current) return;
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left + containerRef.current.scrollLeft, 0, handleOffset + usableWidth);
    const timeAtPointer = xToTime(x);
    const offsetSec = Math.max(0, timeAtPointer - (seg.start || 0));
    setDragState({
      segmentId: seg.id || seg.index,
      laneId: laneId || lane,
      edge: "move",
      startOffsetSec: offsetSec,
      segmentIndex: segIndex,
    });
  };

  const handleLaneHandleMouseDown = (e, laneId, laneIndex) => {
    e.stopPropagation();
    setLaneDrag({
      laneId,
      startIndex: laneIndex,
      targetIndex: laneIndex,
      startY: e.clientY,
      currentY: e.clientY,
    });
  };

  const isSegmentRapid = useCallback(
    (seg, lane) => {
      if (!seg) return false;
      const tol = 1e-3;
      const ranges =
        lane === "fg"
          ? rapidRangesByLane.foreground || []
          : lane === "bg"
          ? rapidRangesByLane.background || []
          : [];
      if (!ranges?.length) return false;
      return ranges.some(
        (r) =>
          Number.isFinite(r?.start) &&
          Number.isFinite(r?.end) &&
          r.start <= seg.start + tol &&
          r.end >= seg.end - tol
      );
    },
    [rapidRangesByLane]
  );

  const renderSegmentBlock = (seg, lane, laneId = null, laneLabel = null, segIndex = null) => {
    const normalizedLane =
      lane === "fg" ? "foreground" : lane === "bg" ? "background" : lane;
    const left = timeToXRaw(seg.start);
    const width = Math.max(6, timeToXRaw(seg.end) - left);
    const segId = seg.id || seg.index;
    const matchesLane =
      !!selectedSegment?.lane &&
      (selectedSegment.lane === lane ||
        selectedSegment.lane === normalizedLane ||
        (selectedSegment.laneId && laneId && selectedSegment.laneId === laneId));
    const isSelected =
      (selectedSegment?.id && selectedSegment.id === segId && matchesLane) ||
      (selectedSegment?.index === seg.index && matchesLane);
    const isRapid = isSegmentRapid(seg, lane);
    const isGap = false;
    const canResize = true;
    const bgColors = {
      bg: "#0ea5e9",
      fg: "#22c55e",
      caps: "#fbbf24",
      stills: "#f97316",
      rapid: "#a855f7",
      gap: "#6b7280",
    };
    const color = isGap
      ? bgColors.gap
      : lane === "fg"
      ? bgColors.fg
      : String(lane).startsWith("caps")
      ? bgColors.caps
      : String(lane).startsWith("stills")
      ? bgColors.stills
      : bgColors.bg;
    return (
      <div
        key={`${lane}-${segId}`}
        className="absolute top-1 bottom-1 rounded-sm border cursor-grab transition-all active:cursor-grabbing"
        style={{
          left,
          width,
          background: isSelected
            ? `${color}dd`
            : isRapid
            ? "linear-gradient(90deg, rgba(168,85,247,0.85), rgba(139,92,246,0.75))"
            : `${color}55`,
          borderColor: isSelected
            ? "#ffffff"
            : isRapid
            ? "rgba(168,85,247,0.9)"
            : "rgba(255,255,255,0.2)",
          borderWidth: isSelected ? 2 : 1,
          boxShadow: isSelected ? "0 0 0 2px rgba(255,255,255,0.6)" : "none",
          transform: isSelected ? "scale(1.02)" : "scale(1)",
          transformOrigin: "center",
          zIndex: isSelected ? 20 : 1,
        }}
        onMouseDown={(e) => handleSegmentBlockMouseDown(e, seg, lane, laneId, segIndex)}
        onClick={() => {
          onSelectSegment({
            id: segId,
            index: seg.index,
            lane: normalizedLane,
            laneId,
            type: seg.type,
          });
        }}
      >
        {/* Left grip */}
        {canResize && (
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
            onMouseDown={(e) => handleSegmentEdgeMouseDown(e, seg, lane, "start", laneId, segIndex)}
          >
            <div className="absolute inset-y-2 left-0.5 w-0.5 bg-white/60" />
          </div>
        )}
        {/* Right grip */}
        {canResize && (
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
            onMouseDown={(e) => handleSegmentEdgeMouseDown(e, seg, lane, "end", laneId, segIndex)}
          >
            <div className="absolute inset-y-2 right-0.5 w-0.5 bg-white/60" />
          </div>
        )}
        <div
          className={`px-1 text-[10px] truncate ${
            isSelected ? "text-black font-bold bg-white/80 rounded-sm" : "text-white"
          }`}
        >
          {lane.startsWith("caps")
            ? seg.text || laneLabel || "Captions"
            : laneLabel ||
              `Segment ${
                Number.isInteger(seg.displayIndex)
                  ? seg.displayIndex
                  : Number.isInteger(seg.index)
                  ? seg.index + 1
                  : ""
              }`}
        </div>
      </div>
    );
  };

  const renderWaveform = () => {
    if (!waveformData || !waveformEnabled) return null;
    const height = 60;

    const renderArea = (data, color, opacity, strength = 1) => {
      if (!data || !waveformData.pointDuration) return null;
      const len = data.length;
      if (!len || duration <= 0) return null;
      const points = [];
      const scale = clamp(strength, 0.2, 100);
      for (let i = 0; i < len; i++) {
        const t = i * waveformData.pointDuration;
        if (t > duration) break;
          const x = timeToXRaw(t);
        const amp = clamp(data[i], -1, 1);
        const yTop = height / 2 - amp * (height / 2) * 0.9 * scale;
        const yBottom = height / 2 + amp * (height / 2) * 0.9 * scale;
        points.push({ x, yTop, yBottom });
      }
      if (points.length < 2) return null;
      const pathUpper = ["M", points[0].x, points[0].yTop];
      const pathLower = ["M", points[0].x, points[0].yBottom];
      for (let i = 1; i < points.length; i++) {
        pathUpper.push("L", points[i].x, points[i].yTop);
        pathLower.push("L", points[i].x, points[i].yBottom);
      }
      pathUpper.push("L", points[points.length - 1].x, height / 2);
      pathLower.push("L", points[points.length - 1].x, height / 2);
      return (
        <>
          <path
            d={pathUpper.join(" ")}
            fill={color}
            fillOpacity={opacity}
            stroke={color}
            strokeWidth="0.5"
            strokeOpacity={opacity + 0.25}
          />
          <path
            d={pathLower.join(" ")}
            fill={color}
            fillOpacity={opacity}
            stroke={color}
            strokeWidth="0.5"
            strokeOpacity={opacity + 0.25}
          />
        </>
      );
    };

    const renderOnsets = (onsets, color, opacity) => {
      if (!onsets || !Array.isArray(onsets)) return null;
      return onsets
        .filter((o) => o.time >= 0 && o.time <= duration)
        .map((onset, i) => {
          const x = timeToXRaw(onset.time);
          const strength = Math.min((onset.strength || 0.2) * 2, 1);
          return (
            <rect
              key={`onset-${i}`}
              x={x}
              y={2}
              width={2}
              height={height - 4}
              fill={color}
              opacity={opacity * strength}
            />
          );
        });
    };

    return (
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${totalWidth} ${height}`}
        preserveAspectRatio="none"
      >
        {activeLayers.volume &&
          renderArea(
            waveformData.volume,
            WAVEFORM_LAYERS.volume.color,
            WAVEFORM_LAYERS.volume.opacity,
            layerStrengths.volume
          )}
        {waveformData.bands &&
          Object.entries(waveformData.bands).map(([band, data]) => {
            const layer = WAVEFORM_LAYERS[band];
            if (!layer || !activeLayers[band]) return null;
            return renderArea(data, layer.color, layer.opacity, layerStrengths[band]);
          })}
        {activeLayers.spectralFlux &&
          renderArea(
            waveformData.spectralFlux,
            WAVEFORM_LAYERS.spectralFlux.color,
            WAVEFORM_LAYERS.spectralFlux.opacity,
            layerStrengths.spectralFlux
          )}
        {activeLayers.onsets &&
          renderOnsets(
            waveformData.onsets,
            WAVEFORM_LAYERS.onsets.color,
            WAVEFORM_LAYERS.onsets.opacity * clamp(layerStrengths.onsets || 1, 0.1, 100)
          )}
      </svg>
    );
  };

  return (
    <>
      <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative w-full overflow-x-auto overflow-y-hidden border border-gray-800 rounded-lg bg-gray-900 scrollbar-thick"
        style={{
          height: containerHeight,
          scrollbarColor: '#94a3b8 #0f172a',
          scrollbarWidth: 'thin',
        }}
      >
        <div className="relative" style={{ width: handleOffset + usableWidth, height: "100%" }}>
          {/* time ruler */}
          <div
            className="absolute left-0 right-0 h-6 border-b border-gray-800 bg-gray-950 flex text-[10px] text-slate-400 cursor-pointer select-none"
            onMouseDown={handleTimelineMouseDown}
            style={{ paddingLeft: `${handleOffset}px`, width: handleOffset + usableWidth }}
          >
            {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => {
              const x = timeToXRuler(i);
              return (
                <div key={i} className="absolute border-l border-gray-700" style={{ left: x, height: "100%" }}>
                  <div className="absolute top-0 left-1">{i}s</div>
                </div>
              );
            })}
          </div>

          {/* Timeline lanes */}
          <div
            className="absolute left-0 right-0 top-6"
            style={{ height: lanesHeight, userSelect: "none", width: handleOffset + usableWidth }}
          >
            {hasDynamicLanes ? (
              (effectiveLanes || []).map((lane, idx, arr) => {
                const laneSegs = Array.isArray(lane.segments) ? lane.segments : [];
                const laneLabel = lane.label || lane.name || lane.id || lane.type || `Lane ${idx + 1}`;
                const laneKey = lane.colorKey || lane.type || lane.id || "bg";
                const mb = idx === arr.length - 1 ? 0 : laneGap;
                const isDragging = laneDrag?.laneId === lane.id;
                const isSelected = selectedLayerId && selectedLayerId === lane.id;
                const dragOffset = isDragging
                  ? (laneDrag.currentY || laneDrag.startY || 0) - (laneDrag.startY || 0)
                  : 0;
                const laneSpan = laneHeight + laneGap;
                const translateY = isDragging
                  ? dragOffset + (laneDrag.startIndex - laneDrag.targetIndex) * laneSpan
                  : 0;
                const renderContent = () => {
                  if (lane.type === "waveform") {
                    return renderWaveform();
                  }
                  return laneSegs.length > 0 ? (
                    laneSegs.map((seg, segIdx) =>
                      renderSegmentBlock(
                        seg,
                        laneKey,
                        lane.id,
                        seg.text || seg.label || laneLabel,
                        segIdx
                      )
                    )
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
                      No items
                    </div>
                  );
                };
                const selectedClasses = isSelected
                  ? "border-amber-400 bg-amber-400/8 ring-2 ring-amber-400/60 shadow-[0_0_0_2px_rgba(251,191,36,0.45)]"
                  : "";
                return (
                  <div
                    key={lane.id || idx}
                    className={`relative bg-gray-800/40 rounded-md border border-gray-700 overflow-visible select-none ${
                      isDragging ? "ring-2 ring-sky-500/70" : selectedClasses
                    }`}
                    style={{
                      height: laneHeight,
                      marginBottom: mb,
                      transform: `translateY(${translateY}px)`,
                      zIndex: isDragging ? 50 : isSelected ? 40 : 1,
                      userSelect: "none",
                      boxShadow: isSelected ? "0 0 0 1px rgba(245, 158, 11, 0.65)" : "none",
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    {isSelected && (
                      <div className="absolute inset-0 rounded-md bg-amber-300/10 pointer-events-none transition-opacity" />
                    )}
                    <div
                      className="absolute inset-y-0 left-0 flex items-center justify-start gap-2 pl-3 pr-2 border-r border-gray-800 bg-gray-950/90 cursor-grab select-none"
                      style={{
                        width: `${LANE_HANDLE_WIDTH}px`,
                        background: isSelected ? "rgba(251, 191, 36, 0.18)" : "rgba(15, 23, 42, 0.9)",
                        borderColor: isSelected ? "rgba(251, 191, 36, 0.6)" : "rgba(75, 85, 99, 1)",
                        color: isSelected ? "#fef3c7" : undefined,
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleLaneHandleMouseDown(e, lane.id, idx);
                      }}
                      onClick={() => {
                        if (isDragging) return;
                        onSelectLayer(lane);
                      }}
                      title="Drag to reorder lane"
                    >
                      <span className="text-base font-semibold text-slate-100 select-none leading-none">≡</span>
                      <span className="text-[12px] font-semibold text-slate-200 truncate max-w-[64px] select-none">
                        {laneLabel}
                      </span>
                    </div>
                    <div
                      className="absolute inset-y-0 right-0"
                      style={{ left: `${LANE_HANDLE_WIDTH}px`, width: usableWidth }}
                    >
                      <div className="absolute inset-0" style={{ left: 0, right: 0 }}>
                        {renderContent()}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-slate-500">
                No lanes to display
              </div>
            )}
          </div>

          {/* Playhead */}
          {duration > 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
              style={{ left: timeToXRuler(clamp(currentTime, 0, duration)) }}
            >
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] text-red-300 font-mono bg-gray-900 px-1 rounded">
                {currentTime.toFixed(2)}s
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      <div className="flex items-center gap-3">
      <label className="text-xs text-slate-400 font-semibold">Zoom</label>
      <input
        type="range"
        min="0.5"
        max="4"
        step="0.1"
        value={zoom}
        onChange={(e) => onZoomChange(parseFloat(e.target.value))}
        className="w-48"
      />
      <span className="text-xs text-slate-400">{zoom.toFixed(1)}x</span>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 border border-gray-700 rounded-md px-3 py-2 bg-gray-900">
        <span className="text-slate-400 font-semibold">Waveform:</span>
        <button
          onClick={() => onWaveformEnabledChange(!waveformEnabled)}
          className={`px-3 py-1 rounded-sm border text-xs ${
            waveformEnabled
              ? "bg-emerald-800 text-white border-emerald-500"
              : "bg-gray-800 text-slate-200 border-gray-700 hover:bg-gray-700"
          }`}
        >
          {waveformEnabled ? "On" : "Off"}
        </button>
        <button
          onClick={() => setWaveformLayersOpen((o) => !o)}
          className="ml-2 px-3 py-1 rounded-sm border border-gray-700 bg-gray-800 text-slate-200 hover:bg-gray-700"
        >
          {waveformLayersOpen ? "Hide Layers" : "Show Layers"}
        </button>
      </div>

      {waveformLayersOpen && (
        <div className="w-full bg-gray-900 border border-gray-800 rounded-md p-3 flex flex-wrap gap-2 text-xs">
          {Object.entries(WAVEFORM_LAYERS).map(([key, layer]) => {
            const isActive = activeLayers[key];
            return (
              <div key={key} className="flex items-center gap-2 border border-gray-800 rounded-md px-2 py-1">
                <button
                  onClick={() => onWaveformLayerToggle(key, !isActive)}
                  className={`px-3 py-1 rounded border text-xs ${
                    isActive
                      ? "bg-emerald-700 text-white border-emerald-500"
                      : "bg-gray-800 text-slate-300 border-gray-700 hover:bg-gray-700"
                  }`}
                  title={layer.label}
                >
                  {layer.label}
                </button>
                <div className="flex items-center gap-1 text-[10px] text-slate-300">
                  <span>Strength</span>
                  <input
                    type="range"
                    min="0.2"
                    max="100"
                    step="0.1"
                    value={layerStrengths[key] ?? 1}
                    onChange={(e) => onWaveformStrengthChange(key, parseFloat(e.target.value))}
                  />
                  <span className="w-14 text-right">{(layerStrengths[key] ?? 1).toFixed(1)}x</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </>
  );
};

export default UnifiedTimeline;
