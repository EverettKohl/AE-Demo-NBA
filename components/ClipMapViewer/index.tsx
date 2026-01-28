"use client";

import * as React from "react";
import type { AssignedClipOverride, ClipMap } from "@/lib/clipMap/types";
import SlotCard from "./SlotCard";
import { ClipMapViewerContext } from "./context";
import { useClipActions } from "./hooks/useClipActions";
import ClipEditor from "@/components/ClipEditor";
import ReplaceModal from "@/components/ReplaceModal";
import useCloudinaryCloudName from "@/hooks/useCloudinaryCloudName";

export default function ClipMapViewer({
  clipMap,
  overrides,
  setOverrides,
  reselectEndpoint = "/api/quick-edit-3",
}: {
  clipMap: ClipMap;
  overrides: Record<string, AssignedClipOverride>;
  setOverrides: React.Dispatch<React.SetStateAction<Record<string, AssignedClipOverride>>>;
  reselectEndpoint?: string;
}) {
  const [activeSlotId, setActiveSlotId] = React.useState<string | null>(clipMap.slots[0]?.id ?? null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const { getCloudinaryCloudName } = useCloudinaryCloudName();

  React.useEffect(() => {
    // If the clip map changes, reset selection to first slot to avoid dangling ids.
    setActiveSlotId(clipMap.slots[0]?.id ?? null);
  }, [clipMap.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useClipActions({
    clipMap,
    overrides,
    setOverrides,
    setErrorMessage,
    reselectEndpoint,
  });

  return (
    <ClipMapViewerContext.Provider value={{ activeSlotId, setActiveSlotId }}>
      <div className="space-y-4">
        {errorMessage && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Clip map</p>
            <p className="text-lg font-semibold text-white">
              {clipMap.mode === "song" ? "Song mode" : "Freeform"} · {clipMap.slots.length} slots · {clipMap.fps}fps
            </p>
          </div>
          <div className="text-xs text-white/60">
            {Object.keys(overrides).length ? `${Object.keys(overrides).length} override(s)` : "No overrides"}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {clipMap.slots.map((slot) => {
            const override = overrides[slot.id] || null;
            const isEdited = Boolean(override);
            return (
              <SlotCard
                key={slot.id}
                slot={slot}
                effectiveOverride={override}
                isEdited={isEdited}
                active={activeSlotId === slot.id}
                onActivate={() => setActiveSlotId(slot.id)}
                onEdit={() => actions.openEdit(slot)}
                onReplace={() => actions.openReplace(slot)}
                onReselect={() => actions.reselect(slot)}
                onClear={() => actions.clearOverride(slot.id)}
              />
            );
          })}
        </div>

        {/* Edit modal */}
        {actions.editModalState && (
          <ClipEditor
            clip={actions.editModalState.slot.upstream || actions.editModalState.slot}
            videoDetail={actions.editModalState.videoDetail}
            previewUrl={actions.editModalState.previewUrl}
            initialStart={actions.editModalState.initialStart}
            initialEnd={actions.editModalState.initialEnd}
            videoDuration={actions.editModalState.videoDuration}
            isPart1={false}
            fixedDuration={actions.editModalState.fixedDuration}
            fixedDurationTolerance={1 / Math.max(1, clipMap.fps)}
            previewWindowOverride={actions.editModalState.previewWindow}
            onSave={(start: number, end: number) => actions.saveEdit(actions.editModalState!.slotId, start, end)}
            onCancel={actions.closeEdit}
            getCustomCloudinaryUrl={async (clip: any, start: number, end: number) => {
              const cloudName = await getCloudinaryCloudName();
              if (!cloudName) return null;
              const filename = actions.editModalState?.videoDetail?.system_metadata?.filename;
              const cloudinaryId =
                typeof filename === "string" ? filename.replace(/\.mp4$/i, "") : clip.videoId;
              const { buildSafeRange } = await import("@/utils/cloudinary");
              const { startRounded, endRounded } = buildSafeRange(start, end);
              return `https://res.cloudinary.com/${cloudName}/video/upload/so_${startRounded},eo_${endRounded},f_mp4,fl_attachment/${cloudinaryId}.mp4`;
            }}
          />
        )}

        {/* Replace modal */}
        {actions.replaceModalState && (
          <ReplaceModal
            segmentIndex={actions.replaceModalState.slot.order}
            onSave={actions.saveReplace}
            onCancel={actions.closeReplace}
            isClipDisabled={actions.isReplaceClipDisabled}
            getClipDisabledReason={actions.getReplaceClipDisabledReason}
          />
        )}
      </div>
    </ClipMapViewerContext.Provider>
  );
}

