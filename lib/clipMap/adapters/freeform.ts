import type { AssignedClip, ClipMap, ClipSlot } from "../types";

const safeNumber = (value: any, fallback: number | null = null) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeAssigned = (item: any): AssignedClip | null => {
  const videoId = item?.videoId || item?.video_id || item?.asset?.videoId || null;
  if (!videoId) return null;
  const start = safeNumber(item?.start, safeNumber(item?.asset?.start, 0)) ?? 0;
  const end = safeNumber(item?.end, safeNumber(item?.asset?.end, start)) ?? start;
  return {
    videoId,
    indexId: item?.indexId || item?.asset?.indexId || null,
    cloudinaryId: item?.cloudinaryId || item?.asset?.cloudinaryId || null,
    start,
    end,
  };
};

/**
 * Freeform adapter for Story Builder / Top 5 / arbitrary clip lists.
 * Accepts either `{ clips: [...] }` or a raw array.
 */
export const fromFreeform = (input: any, opts: { id?: string; fps?: number } = {}): ClipMap => {
  const list: any[] = Array.isArray(input) ? input : Array.isArray(input?.clips) ? input.clips : [];
  const fps = safeNumber(opts.fps, 30) ?? 30;

  const slots: ClipSlot[] = list.map((item, idx) => {
    const assignedClip = normalizeAssigned(item);
    const targetDuration = safeNumber(item?.targetDuration, null);
    return {
      id: `freeform:${idx}`,
      order: idx,
      songTime: null,
      targetDuration,
      constraints: { kind: "freeform" },
      assignedClip,
      upstream: item,
      metadata: {},
    };
  });

  return {
    id: opts.id || "freeform",
    mode: "freeform",
    fps,
    slots,
    upstreamPlan: input,
  };
};

