import path from "path";

/**
 * Build cover definitions over a segment plan.
 * Selection is exact-range based: composites are picked only when their start/end
 * match the manifest entry exactly.
 *
 * @param {Object} params
 * @param {Array} params.segments - plan segments with frameCount and pauseMusic info
 * @param {Array} params.compositeManifest - list of composite candidates:
 *   { startSegmentIndex, endSegmentIndexExclusive, sourceFile, frameCount?, label? }
 * @returns {{ covers: Array, summary: Object }}
 */
export function buildPlanCovers({
  segments = [],
  compositeManifest = [],
} = {}) {
  const covers = [];
  const segCount = segments.length;
  const segFrameSum = segments.reduce((s, seg) => s + (seg.frameCount || 0), 0);

  // Index manifest entries by start index for exact matching
  const manifestByStart = new Map();
  compositeManifest.forEach((entry) => {
    if (
      entry &&
      Number.isInteger(entry.startSegmentIndex) &&
      Number.isInteger(entry.endSegmentIndexExclusive) &&
      entry.endSegmentIndexExclusive > entry.startSegmentIndex &&
      typeof entry.sourceFile === "string"
    ) {
      manifestByStart.set(entry.startSegmentIndex, entry);
    }
  });

  for (let i = 0; i < segCount; ) {
    const seg = segments[i];
    const isPause = Boolean(seg?.beatMetadata?.clipSlot?.pauseMusic);

    const manifestEntry = manifestByStart.get(i);
    const hasComposite =
      manifestEntry &&
      manifestEntry.startSegmentIndex === i &&
      manifestEntry.endSegmentIndexExclusive <= segCount;

    if (hasComposite && !isPause) {
      const { endSegmentIndexExclusive, sourceFile, label } = manifestEntry;
      const coveredSegs = segments.slice(i, endSegmentIndexExclusive);

      // PauseMusic must not be inside composite
      if (coveredSegs.some((s) => Boolean(s?.beatMetadata?.clipSlot?.pauseMusic))) {
        // fall back to segment cover
      } else {
        const expectedFrames = coveredSegs.reduce(
          (s, s0) => s + (s0.frameCount || 0),
          0
        );
        const manifestFrames = manifestEntry.frameCount;
        if (manifestFrames != null && manifestFrames !== expectedFrames) {
          // frame mismatch -> do not use composite
        } else {
          covers.push({
            kind: "composite",
            coverRange: {
              startSegmentIndex: i,
              endSegmentIndexExclusive,
            },
            frameCount: expectedFrames,
            source: {
              sourceFile: path.resolve(sourceFile),
              label: label || path.basename(sourceFile),
            },
          });
          i = endSegmentIndexExclusive;
          continue;
        }
      }
    }

    // Default: single segment cover
    covers.push({
      kind: "segment",
      segmentIndex: i,
      frameCount: seg?.frameCount || 0,
      source: {
        strategy: "plan",
      },
    });
    i += 1;
  }

  // Coverage validation
  const covered = new Array(segCount).fill(false);
  for (const cover of covers) {
    if (cover.kind === "segment") {
      const idx = cover.segmentIndex;
      if (idx < 0 || idx >= segCount) {
        throw new Error(`[buildPlanCovers] Segment cover out of range: ${idx}`);
      }
      if (covered[idx]) {
        throw new Error(`[buildPlanCovers] Overlap detected at segment ${idx}`);
      }
      covered[idx] = true;
      if (cover.frameCount !== segments[idx].frameCount) {
        throw new Error(
          `[buildPlanCovers] Frame mismatch on segment ${idx}: cover ${cover.frameCount} vs segment ${segments[idx].frameCount}`
        );
      }
    } else if (cover.kind === "composite") {
      const { startSegmentIndex, endSegmentIndexExclusive } = cover.coverRange || {};
      if (
        !Number.isInteger(startSegmentIndex) ||
        !Number.isInteger(endSegmentIndexExclusive) ||
        startSegmentIndex < 0 ||
        endSegmentIndexExclusive > segCount ||
        startSegmentIndex >= endSegmentIndexExclusive
      ) {
        throw new Error("[buildPlanCovers] Invalid composite cover range");
      }
      for (let j = startSegmentIndex; j < endSegmentIndexExclusive; j += 1) {
        if (covered[j]) {
          throw new Error(`[buildPlanCovers] Overlap detected at segment ${j}`);
        }
        covered[j] = true;
      }
      const expectedFrames = segments
        .slice(startSegmentIndex, endSegmentIndexExclusive)
        .reduce((s, seg) => s + (seg.frameCount || 0), 0);
      if (expectedFrames !== cover.frameCount) {
        throw new Error(
          `[buildPlanCovers] Composite frame mismatch: cover ${cover.frameCount} vs expected ${expectedFrames}`
        );
      }
    } else {
      throw new Error("[buildPlanCovers] Unknown cover kind");
    }
  }

  if (covered.some((v) => !v)) {
    const missing = covered
      .map((v, idx) => (!v ? idx : null))
      .filter((v) => v !== null);
    throw new Error(`[buildPlanCovers] Coverage gap at segments: ${missing.join(",")}`);
  }

  const sumCoverFrames = covers.reduce((s, c) => s + (c.frameCount || 0), 0);
  if (sumCoverFrames !== segFrameSum) {
    throw new Error(
      `[buildPlanCovers] Cover frame sum mismatch: ${sumCoverFrames} vs segments ${segFrameSum}`
    );
  }

  return {
    covers,
    summary: {
      segmentCount: segCount,
      coverCount: covers.length,
      sumCoverFrames,
      sumSegmentFrames: segFrameSum,
    },
  };
}
