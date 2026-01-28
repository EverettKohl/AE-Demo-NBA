"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const formatTime = (seconds) => {
  if (!isFinite(seconds) || isNaN(seconds)) return "0.000";
  return seconds.toFixed(3);
};

const RapidClipSelector = ({
  duration,
  currentTime,
  rapidClipRanges,
  onAddRange,
  onRemoveRange,
  onUpdateRange,
  onSeek,
}) => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [interval, setInterval] = useState(0.1);
  const [showForm, setShowForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const timelineRef = useRef(null);

  // Local string state for form inputs (allows free typing)
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formInterval, setFormInterval] = useState("0.1");

  // Get time from mouse position
  const getTimeFromPosition = useCallback(
    (clientX) => {
      if (!timelineRef.current || !duration) return 0;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const percent = x / rect.width;
      return percent * duration;
    },
    [duration]
  );

  // Get position from time (0-100%)
  const getPositionFromTime = useCallback(
    (time) => {
      if (!duration) return 0;
      return (time / duration) * 100;
    },
    [duration]
  );

  // Handle mouse down to start selection
  const handleMouseDown = (e) => {
    if (!isSelecting) return;
    const time = getTimeFromPosition(e.clientX);
    setSelectionStart(time);
    setSelectionEnd(time);
  };

  // Handle mouse move during selection
  const handleMouseMove = useCallback(
    (e) => {
      if (!isSelecting || selectionStart === null) return;
      const time = getTimeFromPosition(e.clientX);
      setSelectionEnd(time);
    },
    [isSelecting, selectionStart, getTimeFromPosition]
  );

  // Handle mouse up to end selection
  const handleMouseUp = useCallback(() => {
    if (!isSelecting || selectionStart === null || selectionEnd === null) return;
    
    // Normalize start/end
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    
    // Only show form if selection is meaningful (> 0.1s)
    if (end - start > 0.1) {
      setSelectionStart(start);
      setSelectionEnd(end);
      // Populate form fields
      setFormStart(start.toFixed(3));
      setFormEnd(end.toFixed(3));
      setFormInterval("0.1");
      setShowForm(true);
    } else {
      setSelectionStart(null);
      setSelectionEnd(null);
    }
    setIsSelecting(false);
  }, [isSelecting, selectionStart, selectionEnd]);

  // Attach global mouse events when selecting
  useEffect(() => {
    if (isSelecting) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isSelecting, handleMouseMove, handleMouseUp]);

  // Handle timeline click to seek
  const handleTimelineClick = (e) => {
    if (isSelecting) return;
    const time = getTimeFromPosition(e.clientX);
    onSeek(time);
  };

  // Start selection mode
  const handleStartSelection = () => {
    setIsSelecting(true);
    setSelectionStart(null);
    setSelectionEnd(null);
    setShowForm(false);
  };

  // Cancel selection
  const handleCancelSelection = () => {
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
    setShowForm(false);
    setEditingIndex(null);
    setFormStart("");
    setFormEnd("");
    setFormInterval("0.1");
  };

  // Start editing a range
  const handleEditRange = (idx, e) => {
    e.stopPropagation();
    const range = rapidClipRanges[idx];
    setSelectionStart(range.start);
    setSelectionEnd(range.end);
    setInterval(range.interval);
    // Populate form fields with string values
    setFormStart(range.start.toFixed(3));
    setFormEnd(range.end.toFixed(3));
    setFormInterval(String(range.interval));
    setEditingIndex(idx);
    setShowForm(true);
    setIsSelecting(false);
  };

  // Save edited range - parse form values on save
  const handleSaveEdit = () => {
    if (editingIndex === null) return;
    
    const start = parseFloat(formStart);
    const end = parseFloat(formEnd);
    const int = parseFloat(formInterval) || 0.1;
    
    if (isNaN(start) || isNaN(end)) {
      alert("Please enter valid numbers for start and end times");
      return;
    }
    
    onUpdateRange(editingIndex, { 
      start: Math.min(start, end), 
      end: Math.max(start, end), 
      interval: int 
    });
    
    setSelectionStart(null);
    setSelectionEnd(null);
    setShowForm(false);
    setEditingIndex(null);
    setFormStart("");
    setFormEnd("");
    setFormInterval("0.1");
  };

  // Confirm and add the range - parse form values on save
  const handleConfirmRange = () => {
    const start = parseFloat(formStart);
    const end = parseFloat(formEnd);
    const int = parseFloat(formInterval) || 0.1;
    
    if (isNaN(start) || isNaN(end)) {
      alert("Please enter valid numbers for start and end times");
      return;
    }
    
    onAddRange({ 
      start: Math.min(start, end), 
      end: Math.max(start, end), 
      interval: int 
    });
    
    setSelectionStart(null);
    setSelectionEnd(null);
    setShowForm(false);
    setIsSelecting(false);
    setFormStart("");
    setFormEnd("");
    setFormInterval("0.1");
  };

  // Calculate preview marks for the selection (using form values)
  const getPreviewMarks = () => {
    const start = parseFloat(formStart);
    const end = parseFloat(formEnd);
    const int = parseFloat(formInterval) || 0.1;
    
    if (isNaN(start) || isNaN(end)) return [];
    
    const minTime = Math.min(start, end);
    const maxTime = Math.max(start, end);
    const marks = [];
    for (let t = minTime; t <= maxTime; t += int) {
      marks.push(t);
    }
    return marks;
  };

  const previewMarks = getPreviewMarks();
  const currentPosition = getPositionFromTime(currentTime);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Rapid Clip Ranges</h3>
          <p className="text-xs text-slate-400">
            Select a section to add marks at a fixed interval (e.g., every 0.1s)
          </p>
        </div>
        {!isSelecting && !showForm && (
          <button
            onClick={handleStartSelection}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            + Add Range
          </button>
        )}
        {isSelecting && (
          <button
            onClick={handleCancelSelection}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Timeline for selection */}
      <div
        ref={timelineRef}
        className={`relative h-12 bg-gray-800 rounded-lg overflow-hidden ${
          isSelecting ? "cursor-crosshair" : "cursor-pointer"
        }`}
        onMouseDown={handleMouseDown}
        onClick={handleTimelineClick}
      >
        {/* Time labels */}
        <div className="absolute left-2 top-1 text-xs text-slate-500 font-mono">0s</div>
        <div className="absolute right-2 top-1 text-xs text-slate-500 font-mono">
          {formatTime(duration)}s
        </div>

        {/* Existing ranges */}
        {rapidClipRanges.map((range, idx) => {
          const left = getPositionFromTime(range.start);
          const width = getPositionFromTime(range.end) - left;
          const isEditing = editingIndex === idx;
          return (
            <div
              key={idx}
              onClick={(e) => handleEditRange(idx, e)}
              className={`absolute inset-y-0 border-l-2 border-r-2 group cursor-pointer transition-all ${
                isEditing
                  ? "bg-amber-500/40 border-amber-500 z-10"
                  : "bg-purple-500/30 border-purple-500 hover:bg-purple-500/40"
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRange(idx);
                }}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-400 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs z-20"
              >
                ×
              </button>
              <div className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap ${
                isEditing ? "text-amber-200" : "text-purple-200"
              }`}>
                {formatTime(range.start)} - {formatTime(range.end)} @ {range.interval}s
                {isEditing && <span className="ml-1">(editing)</span>}
              </div>
            </div>
          );
        })}

        {/* Selection preview */}
        {selectionStart !== null && selectionEnd !== null && (
          <div
            className="absolute inset-y-0 bg-amber-500/30 border-l-2 border-r-2 border-amber-500"
            style={{
              left: `${getPositionFromTime(Math.min(selectionStart, selectionEnd))}%`,
              width: `${Math.abs(getPositionFromTime(selectionEnd) - getPositionFromTime(selectionStart))}%`,
            }}
          >
            {/* Preview marks */}
            {previewMarks.slice(0, 100).map((mark, idx) => (
              <div
                key={idx}
                className="absolute top-0 bottom-0 w-px bg-amber-400/50"
                style={{ left: `${((mark - Math.min(selectionStart, selectionEnd)) / Math.abs(selectionEnd - selectionStart)) * 100}%` }}
              />
            ))}
          </div>
        )}

        {/* Current time indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
          style={{ left: `${currentPosition}%` }}
        />

        {/* Selection mode indicator */}
        {isSelecting && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-amber-400 text-sm font-semibold bg-gray-900/80 px-3 py-1 rounded-lg">
              Click and drag to select range
            </span>
          </div>
        )}
      </div>

      {/* Selection/Edit form */}
      {showForm && selectionStart !== null && selectionEnd !== null && (
        <div className={`rounded-lg p-4 space-y-3 ${
          editingIndex !== null ? "bg-amber-900/30 border border-amber-700/50" : "bg-gray-800"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-sm font-semibold ${editingIndex !== null ? "text-amber-300" : "text-white"}`}>
              {editingIndex !== null ? `Editing Range #${editingIndex + 1}` : "New Range"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Start (seconds)</label>
              <input
                type="text"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                className="w-full border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono"
                style={{ backgroundColor: "#ffffff", color: "#111827" }}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">End (seconds)</label>
              <input
                type="text"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
                className="w-full border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono"
                style={{ backgroundColor: "#ffffff", color: "#111827" }}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Interval (seconds)</label>
              <input
                type="text"
                value={formInterval}
                onChange={(e) => setFormInterval(e.target.value)}
                className="w-full border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono"
                style={{ backgroundColor: "#ffffff", color: "#111827" }}
              />
            </div>
          </div>
          
          <div className="text-xs text-slate-400">
            This will {editingIndex !== null ? "update to" : "add"} <span className="text-amber-400 font-semibold">{previewMarks.length}</span> marks
            every <span className="text-amber-400 font-semibold">{formInterval}s</span> from{" "}
            <span className="text-amber-400 font-mono">{formStart}s</span> to{" "}
            <span className="text-amber-400 font-mono">{formEnd}s</span>
          </div>

          <div className="flex items-center gap-2">
            {editingIndex !== null ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    onRemoveRange(editingIndex);
                    handleCancelSelection();
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Delete Range
                </button>
              </>
            ) : (
              <button
                onClick={handleConfirmRange}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Add Range
              </button>
            )}
            <button
              onClick={handleCancelSelection}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing ranges list */}
      {rapidClipRanges.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-slate-400 font-semibold">Existing Ranges (click to edit):</div>
          <div className="flex flex-wrap gap-2">
            {rapidClipRanges.map((range, idx) => {
              const isEditing = editingIndex === idx;
              return (
                <div
                  key={idx}
                  onClick={(e) => handleEditRange(idx, e)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all ${
                    isEditing
                      ? "bg-amber-900/60 border border-amber-500"
                      : "bg-purple-900/40 border border-purple-700/60 hover:bg-purple-900/60"
                  }`}
                >
                  <span className={`font-mono ${isEditing ? "text-amber-200" : "text-purple-200"}`}>
                    {formatTime(range.start)}s - {formatTime(range.end)}s @ {range.interval}s
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditRange(idx, e);
                    }}
                    className={`${isEditing ? "text-amber-300" : "text-blue-400 hover:text-blue-300"}`}
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRange(idx);
                    }}
                    className="text-red-400 hover:text-red-300"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default RapidClipSelector;

