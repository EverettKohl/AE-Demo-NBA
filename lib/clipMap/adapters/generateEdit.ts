import type { ClipMap, ClipSlot } from "../types";

const safeNumber = (value: any, fallback: number | null = null) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const fromGenerateEditPlan = (plan: any): ClipMap => {
  const fps = safeNumber(plan?.fps, safeNumber(plan?.songFormat?.meta?.targetFps, 30)) ?? 30;
  const chronologicalOrder = Boolean(plan?.chronologicalOrder);
  const segments: any[] = Array.isArray(plan?.segments) ? plan.segments : [];
  const poolSize = safeNumber(plan?.clipPool?.totalClips, null);
  const totalSegments = segments.length || 0;
  const chronologicalWindowSize =
    chronologicalOrder && typeof poolSize === "number"
      ? Math.max(15, Math.floor(poolSize / Math.max(totalSegments, 1)) + 5)
      : null;

  const slots: ClipSlot[] = segments.map((segment, idx) => {
    const order = safeNumber(segment?.index, idx) ?? idx;
    const songTime = safeNumber(segment?.startSeconds, safeNumber(segment?.start, null));
    const targetDuration =
      safeNumber(segment?.durationSeconds, safeNumber(segment?.duration, safeNumber(segment?.target_length_s, null)));
    const isRapid = segment?.type === "rapid";
    const pauseMusic = isRapid ? true : Boolean(segment?.beatMetadata?.clipSlot?.pauseMusic);

    const asset = segment?.asset || null;
    const assignedClip = asset
      ? {
          videoId: asset.videoId || null,
          indexId: asset.indexId || null,
          cloudinaryId: asset.cloudinaryId || null,
          start: safeNumber(asset.start, 0) ?? 0,
          end: safeNumber(asset.end, 0) ?? 0,
          sourcePoolIndex: safeNumber(asset.sourcePoolIndex, null),
          localPath: asset.localPath || null,
        }
      : null;

    const selectionTarget =
      chronologicalOrder && typeof poolSize === "number"
        ? Math.floor(((idx || 0) / Math.max(totalSegments - 1, 1)) * Math.max(poolSize - 1, 0))
        : null;

    return {
      id: `ge:${order}`,
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
        sourcePoolIndex: assignedClip?.sourcePoolIndex ?? null,
        chronoWindowSize: chronologicalWindowSize,
        chronoWindowStart: selectionTarget,
        chronoWindowEnd:
          chronologicalOrder && typeof selectionTarget === "number" && typeof chronologicalWindowSize === "number"
            ? selectionTarget + chronologicalWindowSize
            : null,
        pauseMusic,
        isRapid,
      },
    };
  });

  return {
    id: `generateEdit:${plan?.songSlug || "unknown"}`,
    mode: "song",
    fps,
    chronologicalOrder,
    slots,
    upstreamPlan: plan,
  };
};

