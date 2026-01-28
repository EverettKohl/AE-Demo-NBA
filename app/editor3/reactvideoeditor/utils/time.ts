/**
 * Shared time conversion helpers (seconds <-> frames).
 * All conversions round to milliseconds before converting to frames to
 * mirror Project 2 behavior and avoid precision drift.
 */
export const frameToTime = (frame: number, fps: number): number => {
  const timeInSeconds = frame / fps;
  return Math.round(timeInSeconds * 1000) / 1000;
};

export const timeToFrame = (timeInSeconds: number, fps: number): number => {
  const preciseTime = Math.round(timeInSeconds * 1000) / 1000;
  return Math.round(preciseTime * fps);
};
