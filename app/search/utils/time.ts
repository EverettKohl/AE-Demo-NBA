export const formatSeconds = (value: number | undefined | null): string => {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) return "0:00";
  const wholeSeconds = Math.floor(value);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const clampSeconds = (value: number, min = 0, max = Infinity) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export const roundSeconds = (value: number, decimals = 2) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

export type ClipValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export const validateClipRange = (
  start: number,
  end: number,
  opts?: { maxDuration?: number; allowZero?: boolean }
): ClipValidationResult => {
  const maxDuration = opts?.maxDuration ?? 180;
  const allowZero = opts?.allowZero ?? false;

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, message: "Start and end times must be numbers." };
  }
  if (start < 0) return { ok: false, message: "Start time cannot be negative." };
  if (!allowZero && end <= start) return { ok: false, message: "End time must be greater than start time." };
  if (allowZero && end < start) return { ok: false, message: "End time must be greater than or equal to start time." };
  if (end - start > maxDuration) {
    return { ok: false, message: `Clip length is limited to ${Math.floor(maxDuration / 60)} minutes.` };
  }
  return { ok: true };
};

