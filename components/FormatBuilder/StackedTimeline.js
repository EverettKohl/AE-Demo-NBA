"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";

const ROWS = 4;

const formatTime = (seconds) => {
  if (!isFinite(seconds) || isNaN(seconds)) return "0.000";
  return seconds.toFixed(3);
};

// Waveform visualization layer definitions
const WAVEFORM_LAYERS = {
  volume: { 
    label: "Volume", 
    color: "#f8fafc", 
    opacity: 0.4,
    description: "Overall amplitude/loudness"
  },
  subBass: { 
    label: "Sub Bass", 
    color: "#9333ea", 
    opacity: 0.6,
    description: "20-60 Hz - Deepest frequencies"
  },
  bass: { 
    label: "Bass", 
    color: "#ec4899", 
    opacity: 0.6,
    description: "60-250 Hz - Kick drums, bass"
  },
  lowMids: { 
    label: "Low Mids", 
    color: "#f97316", 
    opacity: 0.5,
    description: "250-500 Hz - Guitar body, warmth"
  },
  mids: { 
    label: "Mids", 
    color: "#eab308", 
    opacity: 0.5,
    description: "500-2k Hz - Vocals, instruments"
  },
  highMids: { 
    label: "High Mids", 
    color: "#22c55e", 
    opacity: 0.5,
    description: "2-4k Hz - Clarity, presence"
  },
  treble: { 
    label: "Treble", 
    color: "#06b6d4", 
    opacity: 0.5,
    description: "4-8k Hz - Cymbals, brightness"
  },
  brilliance: { 
    label: "Brilliance", 
    color: "#3b82f6", 
    opacity: 0.5,
    description: "8-20k Hz - Air, sparkle"
  },
  spectralFlux: { 
    label: "Energy Change", 
    color: "#f43f5e", 
    opacity: 0.5,
    description: "Rate of frequency change (transients)"
  },
  onsets: { 
    label: "Onsets", 
    color: "#10b981", 
    opacity: 0.8,
    description: "Detected transient events",
    isMarker: true
  },
};

// Waveform rendering component for a single row
const WaveformLayer = ({ 
  data, 
  rowStartTime, 
  rowEndTime, 
  pointDuration, 
  color, 
  opacity,
  height = 56,
}) => {
  if (!data || data.length === 0 || !pointDuration) return null;
  
  // Calculate which data points fall within this row's time range
  const startIndex = Math.floor(rowStartTime / pointDuration);
  const endIndex = Math.ceil(rowEndTime / pointDuration);
  const rowData = data.slice(startIndex, endIndex);
  
  if (rowData.length === 0) return null;
  
  // Generate SVG path for waveform (mirrored around center)
  const pointWidth = 100 / rowData.length;
  const centerY = height / 2;
  
  // Build path - upper half
  let pathUpper = `M 0 ${centerY}`;
  let pathLower = `M 0 ${centerY}`;
  
  rowData.forEach((value, i) => {
    const x = (i / rowData.length) * 100;
    const amplitude = value * (height / 2) * 0.9; // 90% of half height
    pathUpper += ` L ${x} ${centerY - amplitude}`;
    pathLower += ` L ${x} ${centerY + amplitude}`;
  });
  
  // Close the path
  pathUpper += ` L 100 ${centerY}`;
  pathLower += ` L 100 ${centerY}`;
  
  return (
    <svg 
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
    >
      <path
        d={pathUpper}
        fill={color}
        fillOpacity={opacity}
        stroke={color}
        strokeWidth="0.2"
        strokeOpacity={opacity + 0.2}
      />
      <path
        d={pathLower}
        fill={color}
        fillOpacity={opacity}
        stroke={color}
        strokeWidth="0.2"
        strokeOpacity={opacity + 0.2}
      />
    </svg>
  );
};

// Onset markers component
const OnsetMarkers = ({ 
  onsets, 
  rowStartTime, 
  rowEndTime, 
  color,
  opacity,
}) => {
  if (!onsets || onsets.length === 0) return null;
  
  const rowOnsets = onsets.filter(
    (onset) => onset.time >= rowStartTime && onset.time < rowEndTime
  );
  
  if (rowOnsets.length === 0) return null;
  
  const rowDuration = rowEndTime - rowStartTime;
  
  return (
    <>
      {rowOnsets.map((onset, i) => {
        const position = ((onset.time - rowStartTime) / rowDuration) * 100;
        const strength = Math.min(onset.strength * 5, 1); // Normalize strength
        return (
          <div
            key={`onset-${i}`}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ 
              left: `${position}%`,
              width: '2px',
              backgroundColor: color,
              opacity: opacity * strength,
            }}
          />
        );
      })}
    </>
  );
};

const StackedTimeline = ({
  duration,
  currentTime,
  marks,
  onMarkMove,
  onMarkDelete,
  onSeek,
  rapidClipRanges = [],
  waveformData = null,
  markLabels = null,
  lyrics = [],
  wordLyrics = [],
  onLyricSelect = () => {},
  onWordSelect = () => {},
  selectedLyricIndex = null,
  selectedWordIndex = null,
  showMarks = true,
  showRapidRanges = true,
  showLyrics = false,
  showWordLyrics = false,
}) => {
  const [dragState, setDragState] = useState(null);
  const [hoveredMark, setHoveredMark] = useState(null);
  const [selectedMark, setSelectedMark] = useState(null);
  const [activeLayers, setActiveLayers] = useState({
    volume: true,
    bass: false,
    mids: false,
    treble: false,
    spectralFlux: false,
    onsets: false,
  });
  const rowRefs = useRef([]);

  const getMarkLabel = useCallback(
    (index) => {
      if (Array.isArray(markLabels)) {
        return markLabels[index] || `Beat ${index + 1}`;
      }
      if (markLabels && typeof markLabels === "object") {
        return markLabels[index] || `Beat ${index + 1}`;
      }
      return `Beat ${index + 1}`;
    },
    [markLabels]
  );

  // Toggle a waveform layer
  const toggleLayer = useCallback((layerKey) => {
    setActiveLayers((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  }, []);

  // Calculate which row a time falls into
  const getRowForTime = (time) => {
    if (!duration) return 0;
    const rowDuration = duration / ROWS;
    return Math.min(Math.floor(time / rowDuration), ROWS - 1);
  };

  // Calculate position within a row (0-100%)
  const getPositionInRow = (time, row) => {
    if (!duration) return 0;
    const rowDuration = duration / ROWS;
    const rowStart = row * rowDuration;
    const positionInRow = ((time - rowStart) / rowDuration) * 100;
    return Math.max(0, Math.min(100, positionInRow));
  };

  // Get time from mouse position in a row
  const getTimeFromPosition = useCallback(
    (row, clientX) => {
      if (!rowRefs.current[row] || !duration) return 0;
      const rect = rowRefs.current[row].getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const percent = x / rect.width;
      const rowDuration = duration / ROWS;
      const rowStart = row * rowDuration;
      return rowStart + percent * rowDuration;
    },
    [duration]
  );

  // Handle mark click to select
  const handleMarkClick = (e, markIndex) => {
    e.stopPropagation();
    setSelectedMark(selectedMark === markIndex ? null : markIndex);
  };

  // Handle drag start
  const handleMarkMouseDown = (e, markIndex) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ markIndex, initialX: e.clientX });
  };

  // Handle drag
  const handleMouseMove = useCallback(
    (e) => {
      if (!dragState) return;
      
      // Find which row the mouse is over
      for (let row = 0; row < ROWS; row++) {
        const rowEl = rowRefs.current[row];
        if (!rowEl) continue;
        const rect = rowEl.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const newTime = getTimeFromPosition(row, e.clientX);
          onMarkMove(dragState.markIndex, Math.max(0, Math.min(duration, newTime)));
          break;
        }
      }
    },
    [dragState, duration, getTimeFromPosition, onMarkMove]
  );

  // Handle drag end
  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  // Handle row click to seek and deselect
  const handleRowClick = (row, e) => {
    if (dragState) return;
    setSelectedMark(null); // Deselect when clicking empty space
    const time = getTimeFromPosition(row, e.clientX);
    onSeek(time);
  };

  // Handle delete selected mark
  const handleDeleteSelected = () => {
    if (selectedMark !== null) {
      onMarkDelete(selectedMark);
      setSelectedMark(null);
    }
  };

  // Handle mark right-click to delete
  const handleMarkContextMenu = (e, markIndex) => {
    e.preventDefault();
    onMarkDelete(markIndex);
  };

  // Attach global mouse events when dragging
  useEffect(() => {
    if (dragState) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragState, handleMouseMove, handleMouseUp]);

  // Keyboard shortcut to delete selected mark
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedMark !== null) {
        e.preventDefault();
        handleDeleteSelected();
      }
      if (e.key === "Escape") {
        setSelectedMark(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedMark, onMarkDelete]);

  // Generate row info
  const rowDuration = duration / ROWS;
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    index: i,
    startTime: i * rowDuration,
    endTime: (i + 1) * rowDuration,
  }));

  // Get current time indicator row and position
  const currentRow = getRowForTime(currentTime);
  const currentPosition = getPositionInRow(currentTime, currentRow);

  // Count active layers
  const activeLayerCount = Object.values(activeLayers).filter(Boolean).length;

  return (
    <div className="space-y-2">
      {/* Waveform Layer Toggle Panel */}
      <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Audio Visualization Layers
          </h4>
          <span className="text-xs text-slate-500">
            {activeLayerCount} active
          </span>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {Object.entries(WAVEFORM_LAYERS).map(([key, layer]) => {
            const isActive = activeLayers[key];
            return (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition-all
                  ${isActive 
                    ? 'bg-gray-700/80 text-white ring-1 ring-inset' 
                    : 'bg-gray-800/50 text-slate-500 hover:bg-gray-800 hover:text-slate-400'
                  }
                `}
                style={{
                  ringColor: isActive ? layer.color : 'transparent',
                }}
                title={layer.description}
              >
                <div 
                  className={`w-3 h-3 rounded-sm ${layer.isMarker ? 'rounded-full' : ''}`}
                  style={{ 
                    backgroundColor: layer.color,
                    opacity: isActive ? 1 : 0.4,
                  }}
                />
                <span className="truncate">{layer.label}</span>
              </button>
            );
          })}
        </div>
        
        {/* Quick presets */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700/50">
          <span className="text-xs text-slate-500">Presets:</span>
          <button
            onClick={() => setActiveLayers({
              volume: true,
              bass: false,
              mids: false,
              treble: false,
              spectralFlux: false,
              onsets: false,
            })}
            className="px-2 py-1 text-xs bg-gray-800/70 hover:bg-gray-700 text-slate-400 rounded transition-colors"
          >
            Volume Only
          </button>
          <button
            onClick={() => setActiveLayers({
              volume: false,
              bass: true,
              mids: true,
              treble: true,
              spectralFlux: false,
              onsets: false,
            })}
            className="px-2 py-1 text-xs bg-gray-800/70 hover:bg-gray-700 text-slate-400 rounded transition-colors"
          >
            Frequency Bands
          </button>
          <button
            onClick={() => setActiveLayers({
              volume: false,
              subBass: true,
              bass: true,
              lowMids: false,
              mids: false,
              highMids: false,
              treble: false,
              brilliance: false,
              spectralFlux: false,
              onsets: true,
            })}
            className="px-2 py-1 text-xs bg-gray-800/70 hover:bg-gray-700 text-slate-400 rounded transition-colors"
          >
            Beat Detection
          </button>
          <button
            onClick={() => setActiveLayers({
              volume: true,
              subBass: true,
              bass: true,
              lowMids: true,
              mids: true,
              highMids: true,
              treble: true,
              brilliance: true,
              spectralFlux: true,
              onsets: true,
            })}
            className="px-2 py-1 text-xs bg-gray-800/70 hover:bg-gray-700 text-slate-400 rounded transition-colors"
          >
            All
          </button>
          <button
            onClick={() => setActiveLayers({
              volume: false,
              subBass: false,
              bass: false,
              lowMids: false,
              mids: false,
              highMids: false,
              treble: false,
              brilliance: false,
              spectralFlux: false,
              onsets: false,
            })}
            className="px-2 py-1 text-xs bg-gray-800/70 hover:bg-gray-700 text-slate-400 rounded transition-colors"
          >
            None
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-400 mb-1">
        <span>Timeline (4 rows, click to select, drag to move)</span>
        <div className="flex items-center gap-3">
          {selectedMark !== null && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Mark ({formatTime(marks[selectedMark])}s)
            </button>
          )}
          <span>{showMarks ? marks.length : 0} marks</span>
        </div>
      </div>
      
      <div className="space-y-1">
        {rows.map((row) => {
          // Get marks for this row
          const rowMarks = showMarks
            ? marks
                .map((mark, index) => ({ time: mark, index }))
                .filter(({ time }) => {
                  const markRow = getRowForTime(time);
                  return markRow === row.index;
                })
            : [];

          // Get rapid clip ranges for this row
          const rowRanges =
            showRapidRanges && rapidClipRanges
              ? rapidClipRanges.filter((range) => {
                  const startRow = getRowForTime(range.start);
                  const endRow = getRowForTime(range.end);
                  return startRow <= row.index && endRow >= row.index;
                })
              : [];

          const rowLyrics =
            showLyrics && Array.isArray(lyrics)
              ? lyrics.filter((line) => {
                  const start = line.startSeconds ?? line.startMs / 1000 ?? 0;
                  const end = line.endSeconds ?? line.endMs / 1000 ?? start;
                  return start < row.endTime && end > row.startTime;
                })
              : [];

          const rowWordLyrics =
            showWordLyrics && Array.isArray(wordLyrics)
              ? wordLyrics.filter((word) => {
                  const start = word.startSeconds ?? word.startMs / 1000 ?? 0;
                  const end = word.endSeconds ?? word.endMs / 1000 ?? start;
                  return start < row.endTime && end > row.startTime;
                })
              : [];

          return (
            <div
              key={row.index}
              ref={(el) => (rowRefs.current[row.index] = el)}
              className="relative h-14 bg-gray-800 rounded-lg cursor-crosshair overflow-hidden"
              onClick={(e) => handleRowClick(row.index, e)}
            >
              {/* Waveform visualization layers */}
              {waveformData && (
                <>
                  {/* Volume layer */}
                  {activeLayers.volume && waveformData.volume && (
                    <WaveformLayer
                      data={waveformData.volume}
                      rowStartTime={row.startTime}
                      rowEndTime={row.endTime}
                      pointDuration={waveformData.pointDuration}
                      color={WAVEFORM_LAYERS.volume.color}
                      opacity={WAVEFORM_LAYERS.volume.opacity}
                    />
                  )}
                  
                  {/* Frequency band layers */}
                  {waveformData.bands && Object.entries(waveformData.bands).map(([band, data]) => {
                    if (!activeLayers[band]) return null;
                    const layerConfig = WAVEFORM_LAYERS[band];
                    if (!layerConfig) return null;
                    
                    return (
                      <WaveformLayer
                        key={band}
                        data={data}
                        rowStartTime={row.startTime}
                        rowEndTime={row.endTime}
                        pointDuration={waveformData.pointDuration}
                        color={layerConfig.color}
                        opacity={layerConfig.opacity}
                      />
                    );
                  })}
                  
                  {/* Spectral flux layer */}
                  {activeLayers.spectralFlux && waveformData.spectralFlux && (
                    <WaveformLayer
                      data={waveformData.spectralFlux}
                      rowStartTime={row.startTime}
                      rowEndTime={row.endTime}
                      pointDuration={waveformData.pointDuration}
                      color={WAVEFORM_LAYERS.spectralFlux.color}
                      opacity={WAVEFORM_LAYERS.spectralFlux.opacity}
                    />
                  )}
                  
                  {/* Onset markers */}
                  {activeLayers.onsets && waveformData.onsets && (
                    <OnsetMarkers
                      onsets={waveformData.onsets}
                      rowStartTime={row.startTime}
                      rowEndTime={row.endTime}
                      color={WAVEFORM_LAYERS.onsets.color}
                      opacity={WAVEFORM_LAYERS.onsets.opacity}
                    />
                  )}
                </>
              )}

              {/* Time labels */}
              <div className="absolute left-2 top-1 text-xs text-slate-500 font-mono z-10">
                {formatTime(row.startTime)}s
              </div>
              <div className="absolute right-2 top-1 text-xs text-slate-500 font-mono z-10">
                {formatTime(row.endTime)}s
              </div>

              {/* Rapid clip range highlights */}
              {rowRanges.map((range, rangeIdx) => {
                const rangeStartInRow = Math.max(range.start, row.startTime);
                const rangeEndInRow = Math.min(range.end, row.endTime);
                const left = getPositionInRow(rangeStartInRow, row.index);
                const right = getPositionInRow(rangeEndInRow, row.index);
                return (
                  <div
                    key={`range-${rangeIdx}`}
                    className="absolute inset-y-0 bg-purple-500/20 border-l border-r border-purple-500/50"
                    style={{ left: `${left}%`, width: `${right - left}%` }}
                  />
                );
              })}

              {/* Lyrics overlays */}
              {rowLyrics.map((line, idx) => {
                const start = line.startSeconds ?? line.startMs / 1000 ?? 0;
                const end = line.endSeconds ?? line.endMs / 1000 ?? start;
                const left = getPositionInRow(Math.max(start, row.startTime), row.index);
                const right = getPositionInRow(Math.min(end, row.endTime), row.index);
                const width = Math.max(4, right - left);
                const isSelected = selectedLyricIndex === line.index || selectedLyricIndex === idx;
                return (
                  <div
                    key={`lyric-${row.index}-${idx}`}
                    className={`absolute top-2 bg-slate-50/80 text-gray-900 text-[11px] font-semibold px-2 py-1 rounded shadow-sm border max-w-[60%] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer ${
                      isSelected ? "border-emerald-500 ring-1 ring-emerald-400/60" : "border-gray-300/70"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${line.text} (${formatTime(start)}s → ${formatTime(end)}s)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLyricSelect(line.index ?? idx);
                    }}
                  >
                    {line.text}
                  </div>
                );
              })}

              {/* Word-level lyric overlays */}
              {rowWordLyrics.map((word, idx) => {
                const start = word.startSeconds ?? word.startMs / 1000 ?? 0;
                const end = word.endSeconds ?? word.endMs / 1000 ?? start;
                const left = getPositionInRow(Math.max(start, row.startTime), row.index);
                const right = getPositionInRow(Math.min(end, row.endTime), row.index);
                const width = Math.max(1, right - left);
                const isSelected = selectedWordIndex === word.index || selectedWordIndex === idx;
                return (
                  <div
                    key={`word-${row.index}-${idx}`}
                    className={`absolute bottom-1 bg-amber-300/80 text-amber-950 text-[10px] font-semibold px-1 py-0.5 rounded border max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer ${
                      isSelected ? "border-emerald-500 ring-1 ring-emerald-400/60" : "border-amber-400/70"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${word.text} (${formatTime(start)}s → ${formatTime(end)}s)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onWordSelect(word.index ?? idx);
                    }}
                  >
                    {word.text}
                  </div>
                );
              })}

              {/* Marks */}
              {rowMarks.map(({ time, index }) => {
                const position = getPositionInRow(time, row.index);
                const isHovered = hoveredMark === index;
                const isDragging = dragState?.markIndex === index;
                const isSelected = selectedMark === index;
                const labelForMark = getMarkLabel(index);
                
                return (
                  <div
                    key={index}
                    className={`absolute top-0 bottom-0 w-0.5 cursor-pointer transition-all ${
                      isSelected
                        ? "bg-red-400 z-30"
                        : isDragging
                        ? "bg-amber-400 z-30"
                        : isHovered
                        ? "bg-amber-400 z-20"
                        : "bg-emerald-400 z-10"
                    }`}
                    style={{ left: `${position}%` }}
                    onClick={(e) => handleMarkClick(e, index)}
                    onMouseDown={(e) => handleMarkMouseDown(e, index)}
                    onMouseEnter={() => setHoveredMark(index)}
                    onMouseLeave={() => setHoveredMark(null)}
                    onContextMenu={(e) => handleMarkContextMenu(e, index)}
                  >
                    {/* Mark handle */}
                    <div
                      className={`absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 transition-all ${
                        isSelected
                          ? "bg-red-400 border-red-300 scale-125 ring-2 ring-red-500/50"
                          : isDragging
                          ? "bg-amber-400 border-amber-300 scale-125"
                          : isHovered
                          ? "bg-amber-400 border-amber-300 scale-110"
                          : "bg-emerald-400 border-emerald-300"
                      }`}
                    />
                    
                    {/* Tooltip */}
                    {(isHovered || isDragging || isSelected) && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white whitespace-nowrap z-40">
                        {formatTime(time)}s
                      </div>
                    )}
                    {labelForMark && (
                      <div
                        className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[10px] text-amber-100 bg-gray-950/90 border border-gray-700/70 rounded-full px-1.5 py-0.5 font-medium shadow-lg whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ bottom: 2, maxWidth: 150 }}
                        title={labelForMark}
                      >
                        {labelForMark}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Current time indicator */}
              {currentRow === row.index && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
                  style={{ left: `${currentPosition}%` }}
                >
                  <div className="absolute -left-1 top-0 w-2 h-2 bg-red-500 rotate-45" />
                </div>
              )}

              {/* Row number indicator */}
              <div className="absolute left-2 bottom-1 text-xs text-slate-600 font-semibold">
                Row {row.index + 1}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-emerald-400" />
          <span>Beat marks</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-400 ring-2 ring-red-500/50" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-red-500" />
          <span>Current time</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-3 bg-purple-500/30 border border-purple-500/50 rounded-sm" />
          <span>Rapid clip range</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-3 bg-slate-50/70 border border-gray-300/80 rounded-sm" />
          <span>Lyric line</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-3 bg-amber-300/80 border border-amber-400/70 rounded-sm" />
          <span>Lyric word</span>
        </div>
      </div>
    </div>
  );
};

export default StackedTimeline;
