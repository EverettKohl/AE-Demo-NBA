import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { getVideoMetadata } from "../utils/videoValidation.js";

const PUBLIC_ROOT = path.join(process.cwd(), "public", "instant-edits");

const MIN_PART_DURATION = 0.25;
const EPS = 1e-3;
const PROBE_CACHE = new Map(); // absPath -> Promise<metadata>

const probeCached = async (absPath) => {
  if (!absPath) return null;
  if (!PROBE_CACHE.has(absPath)) {
    PROBE_CACHE.set(absPath, getVideoMetadata(absPath).catch(() => null));
  }
  return PROBE_CACHE.get(absPath);
};

const runFfmpegSlice = async (inputPath, startSeconds, endSeconds, outputPath) => {
  const start = Number.isFinite(startSeconds) ? startSeconds : 0;
  const end = Number.isFinite(endSeconds) ? endSeconds : start;
  const duration = end - start;

  // Defensive: never invoke ffmpeg with invalid windows.
  if (end <= start + EPS) {
    throw new Error(`[partRenders] Invalid slice window: end (${end}) <= start (${start})`);
  }
  if (duration + EPS < MIN_PART_DURATION) {
    throw new Error(
      `[partRenders] Slice too short (${duration.toFixed(3)}s) < MIN_PART_DURATION (${MIN_PART_DURATION}s)`
    );
  }

  const bin = ffmpegPath && fs.existsSync(ffmpegPath) ? ffmpegPath : "ffmpeg";

  // Write to a temp file and atomically replace to avoid leaving corrupt/partial mp4s on disk.
  // IMPORTANT: ffmpeg chooses muxer by extension; keep ".mp4" at end.
  const tmpOutput = outputPath.endsWith(".mp4")
    ? `${outputPath}.tmp.mp4`
    : `${outputPath}.tmp`;

  const args = [
    "-y",
    "-ss",
    start.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-i",
    inputPath,
    // Re-encode slices to guarantee:
    // - decodable from t=0 (no keyframe dependency)
    // - no "0-frame mp4 that exists on disk"
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-shortest",
    "-f",
    "mp4",
    tmpOutput,
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
    proc.on("error", (err) => {
      reject(err);
    });
  }).catch((err) => {
    try {
      if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
    } catch (_) {
      // noop
    }
    throw err;
  });

  // Validate the produced slice has non-zero duration and streams.
  const meta = await probeCached(tmpOutput);
  if (!meta || meta.duration + EPS < MIN_PART_DURATION || meta.videoStreams === 0) {
    try {
      if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
    } catch (_) {
      // noop
    }
    throw new Error(
      `[partRenders] Produced invalid slice file (duration=${meta?.duration ?? "n/a"}s) at ${tmpOutput}`
    );
  }

  // Atomically replace.
  fs.renameSync(tmpOutput, outputPath);
  // Ensure subsequent probes see the new file.
  PROBE_CACHE.delete(outputPath);
  PROBE_CACHE.delete(tmpOutput);
};

export const ensurePartRenders = async ({ songSlug, variantId, fullRenderPath, parts = [] }) => {
  if (!songSlug || !variantId || !fullRenderPath || !parts.length) return { byType: {}, sequence: [] };
  // eslint-disable-next-line no-console
  console.log("[partRenders] start", { songSlug, variantId, fullRenderPath, partCount: parts.length });
  const byType = {};
  const sequence = [];

  for (const part of parts) {
    const safeType = (part.partType || "part").toLowerCase();
    const filename = `${variantId}-${safeType}-${Math.round(part.startSeconds || 0)}-${Math.round(
      part.endSeconds || 0
    )}.mp4`;
    const targetDir = path.join(PUBLIC_ROOT, songSlug, "parts");
    fs.mkdirSync(targetDir, { recursive: true });
    const outputPath = path.join(targetDir, filename);
    const url = `/instant-edits/${songSlug}/parts/${filename}`;

    const start = Math.max(0, part.startSeconds || 0);
    const end = Math.max(start, part.endSeconds || start + (part.durationSeconds || 0));
    const duration = end - start;

    // If an existing file is present but invalid (0s / corrupted), regenerate it.
    let needsRender = !fs.existsSync(outputPath);
    if (!needsRender) {
      const meta = await probeCached(outputPath);
      if (!meta || meta.duration + EPS < MIN_PART_DURATION || meta.videoStreams === 0) {
        needsRender = true;
        // eslint-disable-next-line no-console
        console.warn("[partRenders] existing part invalid; regenerating", { outputPath, meta });
      }
    }

    if (needsRender) {
      PROBE_CACHE.delete(outputPath);
      // eslint-disable-next-line no-console
      console.log("[partRenders] slicing", {
        from: fullRenderPath,
        to: outputPath,
        start,
        end,
        duration,
        bin: ffmpegPath,
      });
      await runFfmpegSlice(fullRenderPath, start, end, outputPath);
    } else {
      // eslint-disable-next-line no-console
      console.log("[partRenders] reuse existing", outputPath);
    }

    byType[safeType] = [url];
    sequence.push({
      partType: safeType,
      url,
      startSeconds: start,
      endSeconds: end,
    });
  }
  // eslint-disable-next-line no-console
  console.log("[partRenders] done", { songSlug, variantId, byTypeCount: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])) });
  return { byType, sequence };
};

