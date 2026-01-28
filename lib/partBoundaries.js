"use strict";

const EPS = 1e-6;

/**
 * Compute intro/body/outro boundaries on the song timeline using beat/unit boundaries.
 * Boundaries are chosen as the nearest unit boundary to 1/3 and 2/3 of the total song time.
 *
 * @param {Array} segments - Song-timeline units (from buildQuickEdit3Segments / calculateFrameAccurateSegments)
 * @returns {{introEndIdx: number, outroStartIdx: number, boundariesSeconds: {introEnd:number, outroStart:number}}}
 */
export const computeTriPartBoundaries = (segments = []) => {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { introEndIdx: 0, outroStartIdx: 0, boundariesSeconds: { introEnd: 0, outroStart: 0 } };
  }

  const units = [...segments]
    .map((s, idx) => ({
      idx,
      start: typeof s.startSeconds === "number" ? s.startSeconds : 0,
      end:
        typeof s.endSeconds === "number"
          ? s.endSeconds
          : typeof s.durationSeconds === "number"
          ? (typeof s.startSeconds === "number" ? s.startSeconds : 0) + s.durationSeconds
          : 0,
    }))
    .sort((a, b) => (a.start === b.start ? a.idx - b.idx : a.start - b.start));

  const firstStart = units[0].start;
  const lastEnd = units[units.length - 1].end;
  const total = Math.max(0, lastEnd - firstStart);
  if (total <= EPS) {
    return { introEndIdx: Math.max(1, units.length - 2), outroStartIdx: Math.max(2, units.length - 1), boundariesSeconds: { introEnd: 0, outroStart: 0 } };
  }

  const target1 = firstStart + total / 3;
  const target2 = firstStart + (2 * total) / 3;

  const boundaryTimes = units.map((u) => u.end);

  const nearestBoundaryIdx = (target) => {
    let bestIdx = 1;
    let bestDist = Number.POSITIVE_INFINITY;
    boundaryTimes.forEach((t, idx) => {
      if (idx === 0 || idx === boundaryTimes.length - 1) return; // avoid first/last
      const dist = Math.abs(t - target);
      if (dist < bestDist - EPS) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return bestIdx;
  };

  let introEndIdx = nearestBoundaryIdx(target1);
  let outroStartIdx = nearestBoundaryIdx(target2);

  // Enforce ordering and at least one unit per part
  if (introEndIdx < 1) introEndIdx = 1;
  if (outroStartIdx <= introEndIdx) outroStartIdx = Math.min(units.length - 1, introEndIdx + 1);
  if (outroStartIdx >= units.length) outroStartIdx = units.length - 1;

  const boundariesSeconds = {
    introEnd: boundaryTimes[introEndIdx] ?? target1,
    outroStart: boundaryTimes[outroStartIdx] ?? target2,
  };

  return { introEndIdx, outroStartIdx, boundariesSeconds };
};

export default {
  computeTriPartBoundaries,
};
