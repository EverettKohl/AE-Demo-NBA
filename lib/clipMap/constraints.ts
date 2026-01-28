import type { AssignedClip, ClipSlot } from "./types";

export const DEFAULT_TARGET_FPS = 30;

export const applyTolerance = (fps: number = DEFAULT_TARGET_FPS, frames: number = 1) => {
  const safeFps = typeof fps === "number" && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_TARGET_FPS;
  return frames / safeFps;
};

export const canChangeDuration = (slot: ClipSlot) => {
  // beatLocked: fixed duration (edit UI should prevent changing duration)
  // pauseMusic: special; allow duration changes (the clip can extend to full bed)
  // freeform: allow duration changes
  return slot.constraints.kind !== "beatLocked";
};

export const shouldPreserveDurationOnReplace = (slot: ClipSlot) => {
  // beatLocked slots must preserve target duration on replace/reselect
  return slot.constraints.kind === "beatLocked";
};

export const enforceDuration = (
  slot: ClipSlot,
  clip: Pick<AssignedClip, "start" | "end">,
  fps: number = DEFAULT_TARGET_FPS
) => {
  if (slot.constraints.kind !== "beatLocked") {
    return { ok: true as const };
  }
  const target = slot.targetDuration;
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    return { ok: true as const };
  }
  const actual = (clip.end ?? 0) - (clip.start ?? 0);
  const tol = applyTolerance(fps, 1);
  if (Math.abs(actual - target) > tol) {
    return {
      ok: false as const,
      error: `Duration must stay locked to ${target.toFixed(3)}s (±${tol.toFixed(3)}s)`,
    };
  }
  return { ok: true as const };
};

export const validateChrono = (
  slot: ClipSlot,
  candidate: { sourcePoolIndex?: number | null; songTime?: number | null }
) => {
  if (!slot.constraints.chronological) return { ok: true as const };

  const slotPoolIndex =
    typeof slot.assignedClip?.sourcePoolIndex === "number"
      ? slot.assignedClip.sourcePoolIndex
      : typeof slot.metadata?.sourcePoolIndex === "number"
      ? slot.metadata.sourcePoolIndex
      : null;
  const candPoolIndex = typeof candidate?.sourcePoolIndex === "number" ? candidate.sourcePoolIndex : null;

  // Preferred: pool index ordering
  if (slotPoolIndex !== null && candPoolIndex !== null) {
    const min = Math.max(slotPoolIndex, typeof slot.metadata?.chronoWindowStart === "number" ? slot.metadata.chronoWindowStart : 0);
    const max =
      typeof slot.metadata?.chronoWindowEnd === "number"
        ? slot.metadata.chronoWindowEnd
        : typeof slot.metadata?.chronoWindowSize === "number"
        ? min + slot.metadata.chronoWindowSize
        : null;

    if (candPoolIndex < min) {
      return { ok: false as const, error: "Candidate violates chronological ordering (pool index too early)." };
    }
    if (max !== null && candPoolIndex >= max) {
      return { ok: false as const, error: "Candidate violates chronological window (pool index too late)." };
    }
    return { ok: true as const };
  }

  // Fallback: song time ordering
  if (typeof slot.songTime === "number" && typeof candidate?.songTime === "number") {
    if (candidate.songTime < slot.songTime) {
      return { ok: false as const, error: "Candidate violates chronological ordering (song time too early)." };
    }
  }

  return { ok: true as const };
};

