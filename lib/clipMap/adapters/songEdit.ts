import type { ClipMap, ClipSlot } from "../types";

const safeNumber = (value: any, fallback: number | null = null) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const fromSongEditPlan = (plan: any): ClipMap => {
  const fps = safeNumber(plan?.fps, safeNumber(plan?.songFormat?.meta?.targetFps, 30)) ?? 30;
  const chronologicalOrder = Boolean(plan?.chronoMode || plan?.chronologicalOrder);
  const segments: any[] = Array.isArray(plan?.segments) ? plan.segments : [];

  const slots: ClipSlot[] = segments.map((segment, idx) => {
    const order = safeNumber(segment?.index, idx) ?? idx;
    const songTime =
      safeNumber(segment?.startSeconds, safeNumber(segment?.songTime, safeNumber(segment?.start, null)));
    const targetDuration =
      safeNumber(segment?.durationSeconds, safeNumber(segment?.duration, safeNumber(segment?.target_length_s, null)));

    /**
     * Rapid segments: treat as pauseMusic slots.
     *
     * Rationale: song-edit rendering uses `segment.rapidClipSlot` (not beatMetadata.clipSlot)
     * and supports extending/ducking behavior; rapid clips are not beat-locked and should
     * allow free duration edits.
     */
    const isRapid = segment?.type === "rapid";
    const pauseMusic = isRapid
      ? true
      : Boolean(segment?.beatMetadata?.clipSlot?.pauseMusic) || Boolean(segment?.rapidClipSlot?.pauseMusic);
    const asset = segment?.asset || null;
    const assignedClip = asset
      ? {
          videoId: asset.videoId || null,
          indexId: asset.indexId || null,
          cloudinaryId: asset.cloudinaryId || null,
          start: safeNumber(asset.start, 0) ?? 0,
          end: safeNumber(asset.end, 0) ?? 0,
          localPath: asset.localPath || null,
        }
      : null;

    return {
      id: `songEdit:${order}`,
      order,
      songTime,
      targetDuration,
      constraints: {
        kind: pauseMusic ? "pauseMusic" : "beatLocked",
        chronological: chronologicalOrder,
      },
      assignedClip,
      upstream: segment,
      metadata: {
        segmentIndex: idx,
        pauseMusic,
        isRapid,
      },
    };
  });

  return {
    id: `songEdit:${plan?.songSlug || "unknown"}`,
    mode: "song",
    fps,
    chronologicalOrder,
    slots,
    upstreamPlan: plan,
  };
};

