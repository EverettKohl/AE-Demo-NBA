import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { loadVariantManifest } from "./instantVariants";
import { getVideoMetadata } from "../utils/videoValidation.js";

const PUBLIC_ROOT = path.join(process.cwd(), "public", "instant-edits");
const MIN_PART_DURATION = 0.25;
const EPS = 1e-3;

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pickOne = (list, rng) => {
  if (!list.length) return null;
  const idx = Math.floor(rng() * list.length);
  return list[idx];
};

const ASSEMBLY_TIMEOUT_MS = 3000;

export const assembleInstantEditFromParts = async ({ songSlug, chronologicalOrder = false, seed = Date.now() }) => {
  if (!songSlug) {
    throw new Error("songSlug is required");
  }
  const manifest = loadVariantManifest(songSlug);
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  const byPart = {};
  const rng = mulberry32(seed);

  parts.forEach((p) => {
    const renderUrl = p.renderUrl;
    if (!renderUrl) return;
    const abs = path.join(process.cwd(), "public", renderUrl.replace(/^\//, ""));
    if (!fs.existsSync(abs)) return;
    const partType = (p.partType || "").toLowerCase();
    if (!byPart[partType]) byPart[partType] = [];
    byPart[partType].push({
      variantId: p.id || null,
      renderUrl,
      partType,
      absPath: abs,
      durationSeconds: typeof p.durationSeconds === "number" ? p.durationSeconds : null,
      boundaries: p.boundaries || null,
    });
  });

  const required = ["intro", "body", "outro"];
  const missingRequired = required.filter((p) => !byPart[p] || byPart[p].length === 0);
  if (missingRequired.length) {
    return { ready: false, missingParts: missingRequired, videoUrl: null, partsUsed: [] };
  }

  const safeDuration = (start, end) => Math.max(0, (end || 0) - (start || 0));
  const isPartEntrySane = (entry) => {
    if (!entry?.url) return false;
    const t = (entry.partType || "").toLowerCase();
    if (!required.includes(t)) return false;
    const dur = safeDuration(entry.startSeconds, entry.endSeconds);
    return dur + EPS >= MIN_PART_DURATION;
  };

  const probePart = async (absPath) => {
    const meta = await getVideoMetadata(absPath).catch(() => null);
    if (!meta) return { ok: false, meta: null, reason: "ffprobe failed" };
    if (meta.duration + EPS < MIN_PART_DURATION) {
      return { ok: false, meta, reason: `duration ${meta.duration}s < ${MIN_PART_DURATION}s` };
    }
    if (meta.videoStreams === 0) return { ok: false, meta, reason: "no video stream" };
    return { ok: true, meta, reason: null };
  };

  // Select the newest *sane* variant sequence (do not trust variants[0]).
  // If a variant is poisoned (0s slices / 0-frame mp4s), skip it.
  let selected = [];
  let selectedFromVariantId = null;
  const sequenceCandidates = [];
  // Build candidates: pick one part from each bucket
  const introList = byPart.intro || [];
  const bodyList = byPart.body || [];
  const outroList = byPart.outro || [];
  introList.forEach((intro) => {
    bodyList.forEach((body) => {
      outroList.forEach((outro) => {
        sequenceCandidates.push({ parts: [intro, body, outro], variantId: intro.variantId || null });
      });
    });
  });

  if (sequenceCandidates.length) {
    // Previously we broke on the first sane sequence, making output deterministic regardless of seed.
    const choice = sequenceCandidates[Math.floor(rng() * sequenceCandidates.length)];
    selected = choice.parts;
    selectedFromVariantId = choice.variantId;
  }

  if (!selected.length) {
    selected = required.map((p) => {
      const pick = pickOne(byPart[p], rng) || {};
      const renderUrl = typeof pick === "string" ? pick : pick.renderUrl;
      const absPath = path.join(process.cwd(), "public", (renderUrl || "").replace(/^\//, ""));
      return {
        partType: p,
        renderUrl,
        absPath,
        startSeconds: 0,
        endSeconds: 0,
      };
    });
  }

  const concatDir = path.join(PUBLIC_ROOT, songSlug, "assembled");
  fs.mkdirSync(concatDir, { recursive: true });
  const concatListPath = path.join(concatDir, `list-${seed}.txt`);
  const outputPath = path.join(concatDir, `assembled-${seed}.mp4`);

  // Validate all inputs exist + are non-zero duration before invoking ffmpeg
  let expectedTotal = 0;
  for (const s of selected) {
    const abs = s.absPath || path.join(process.cwd(), "public", s.renderUrl.replace(/^\//, ""));
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing part file: ${abs}`);
    }
    const probe = await probePart(abs);
    if (!probe.ok) {
      throw new Error(`Invalid part file: ${abs} (${probe.reason})`);
    }
    expectedTotal += probe.meta.duration || 0;
  }
  if (expectedTotal + EPS < MIN_PART_DURATION * 3) {
    throw new Error(`Invalid part set: expectedTotal=${expectedTotal}s`);
  }

  const listContent = selected
    .map((s) => `file '${s.absPath || path.join(process.cwd(), "public", (s.renderUrl || "").replace(/^\//, ""))}'`)
    .join("\n");
  fs.writeFileSync(concatListPath, listContent);

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-fflags",
    "+genpts",
    "-avoid_negative_ts",
    "make_zero",
    "-reset_timestamps",
    "1",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath,
  ];
  await new Promise((resolve, reject) => {
    const bin = ffmpegPath && fs.existsSync(ffmpegPath) ? ffmpegPath : "ffmpeg";
    const proc = spawn(bin, args);
    let stderr = "";
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("assembly timeout"));
    }, ASSEMBLY_TIMEOUT_MS);

    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg concat failed: ${code}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Verify output is non-zero (and not drastically truncated).
  const outMeta = await getVideoMetadata(outputPath).catch(() => null);
  if (!outMeta || outMeta.duration + EPS < MIN_PART_DURATION) {
    throw new Error(
      `[assembleInstantEditFromParts] Assembled output invalid (duration=${outMeta?.duration ?? "n/a"}s)`
    );
  }
  // Guard against cinemaedit regressions / truncation: assembled duration must be close to sum of parts.
  if (expectedTotal > 5 && outMeta.duration + 0.75 < expectedTotal) {
    throw new Error(
      `[assembleInstantEditFromParts] Assembled output truncated: ${outMeta.duration.toFixed(2)}s < expected ${expectedTotal.toFixed(2)}s`
    );
  }

  const videoUrl = `/instant-edits/${songSlug}/assembled/assembled-${seed}.mp4`;
  return {
    ready: true,
    videoUrl,
    partsUsed: selected,
    seed,
    fastPathUsed: true,
    variantId: selectedFromVariantId,
  };
};

