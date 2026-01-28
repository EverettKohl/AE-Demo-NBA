"use client";

import React from "react";

/**
 * Minimal clip map viewer/editor for Generate Edit.
 * Shows each slot and lets the user override clip source and timing.
 */
const ClipMapViewer = ({ clipMap, overrides, setOverrides }) => {
  if (!clipMap) return null;

  const handleChange = (slotId, field, value, slot) => {
    setOverrides((prev) => {
      const next = { ...prev };
      const baseline = next[slotId] ?? {
        videoId: slot.assignedClip?.videoId || "",
        indexId: slot.assignedClip?.indexId || null,
        start: slot.assignedClip?.start ?? 0,
        end: slot.assignedClip?.end ?? 0,
      };
      next[slotId] = { ...baseline, [field]: value };
      return next;
    });
  };

  const clearOverride = (slotId) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {clipMap.slots.map((slot) => {
        const override = overrides[slot.id];
        const assigned = slot.assignedClip;
        const valueVideoId = override?.videoId ?? assigned?.videoId ?? "";
        const valueIndexId = override?.indexId ?? assigned?.indexId ?? "";
        const valueStart = override?.start ?? assigned?.start ?? 0;
        const valueEnd = override?.end ?? assigned?.end ?? 0;

        return (
          <div
            key={slot.id}
            className="rounded-lg border border-white/10 bg-white/5 p-3 text-white space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                Slot #{slot.order + 1} — {slot.constraints.kind}
              </div>
              <div className="flex items-center gap-2 text-xs text-white/70">
                {slot.targetDuration != null && <span>Target {slot.targetDuration.toFixed(2)}s</span>}
                {slot.songTime != null && <span>@ {slot.songTime.toFixed(2)}s</span>}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-white/70">
                Video ID
                <input
                  className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-white"
                  value={valueVideoId}
                  onChange={(e) => handleChange(slot.id, "videoId", e.target.value, slot)}
                  placeholder="cloudinary public id or source id"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/70">
                Index ID (optional)
                <input
                  className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-white"
                  value={valueIndexId || ""}
                  onChange={(e) => handleChange(slot.id, "indexId", e.target.value || null, slot)}
                  placeholder="index id"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/70">
                Start (s)
                <input
                  type="number"
                  step="0.001"
                  className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-white"
                  value={valueStart}
                  onChange={(e) => handleChange(slot.id, "start", parseFloat(e.target.value) || 0, slot)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/70">
                End (s)
                <input
                  type="number"
                  step="0.001"
                  className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-white"
                  value={valueEnd}
                  onChange={(e) => handleChange(slot.id, "end", parseFloat(e.target.value) || 0, slot)}
                />
              </label>
            </div>

            <div className="flex items-center justify-between text-xs text-white/60">
              <span>
                Assigned:{" "}
                {assigned
                  ? `${assigned.videoId || "—"} [${(assigned.start ?? 0).toFixed(3)}s → ${(assigned.end ?? 0).toFixed(3)}s]`
                  : "None"}
              </span>
              <button
                type="button"
                className="text-emerald-300 hover:text-emerald-200"
                onClick={() => clearOverride(slot.id)}
                disabled={!override}
              >
                Clear override
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ClipMapViewer;
