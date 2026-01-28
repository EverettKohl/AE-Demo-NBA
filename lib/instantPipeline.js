import { TARGET_FPS } from "./frameAccurateTiming.js";
import { listSongFormats } from "./songEdit.js";

/**
 * Build a lightweight instant plan.
 * Currently acts as a placeholder so the API can fall back gracefully
 * when instant clip assets are unavailable.
 */
export const buildInstantPlan = ({
  songSlug,
  chronologicalOrder = false,
  variantSeed = null,
  bias = false,
} = {}) => {
  const formats = listSongFormats();
  const selectedFormat = formats.find((f) => f?.slug === songSlug) || formats[0];

  if (!selectedFormat) {
    return null;
  }

  return {
    songSlug: selectedFormat.slug,
    songFormat: {
      source: selectedFormat.source || "",
      meta: {
        durationSeconds: selectedFormat.duration || 0,
        totalClips: selectedFormat.totalClips || 0,
      },
    },
    segments: [],
    covers: [],
    compositeManifest: [],
    coverSummary: null,
    totalClips: 0,
    fps: TARGET_FPS,
    variantSeed,
    chronologicalOrder: !!chronologicalOrder,
    useLocalClips: false,
    hasOptimizedAssets: false,
    bias,
    note: "Instant clip pool not available; standard flow will be used.",
  };
};
