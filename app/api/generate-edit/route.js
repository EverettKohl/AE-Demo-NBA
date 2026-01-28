import { NextResponse } from "next/server";
import "@/app/api/song-edit/route";
import { loadInstantClipPool } from "@/lib/songEdit";
import {
  loadGenerateEditFormat,
  buildGenerateEditSegments,
  assignGenerateEditClips,
  reselectGenerateEditClip,
  trimGenerateEditSegments,
  createClipPoolSummary,
} from "@/lib/generateEdit";
import { buildGenerateEditRveProject } from "@/lib/generateEditAdapter";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function resolveFfmpegBinary() {
  const envPath = process.env.FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (ffmpegPath && fs.existsSync(ffmpegPath)) return ffmpegPath;
  return "ffmpeg";
}

const GE_PREVIEWS_DIR = path.join(process.cwd(), "public", "previews", "generate-edit");
const EDITOR_IMPORTS_DIR = path.join(process.cwd(), "data", "editor-imports");
const DEFAULT_IMPORT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// NOTE: The following caption filter code is intentionally kept in sync with
// `app/api/format-builder/render/route.js`, so Generate Edit's caption overlay
// matches the Format Builder output.
const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const FONT_NAME_MAP = {
  montserrat: {
    family: "Montserrat",
    styles: {
      "400": "montserrat-v31-latin-regular.ttf",
      "600": "montserrat-v31-latin-600.ttf",
      "700": "montserrat-v31-latin-700.ttf",
      "800": "montserrat-v31-latin-800.ttf",
      "900": "montserrat-v31-latin-900.ttf",
    },
  },
  "playfair display": {
    family: "Playfair Display",
    styles: {
      "400": "playfair-display-v40-latin-regular.ttf",
      "700": "playfair-display-v40-latin-700.ttf",
      "800": "playfair-display-v40-latin-800.ttf",
      "900": "playfair-display-v40-latin-900.ttf",
    },
  },
};

function buildDrawtextFilters({ captions, width, height }) {
  const defaultFilters = [];
  const negativeFilters = [];
  const cutoutFilters = [];
  const cutoutRanges = [];
  if (!captions) {
    return { defaultFilters, negativeFilters, cutoutFilters, cutoutRanges, width, height };
  }

  // Apply global style defaults
  const globalStyle = captions.style || {};

  const resolveFontSpec = (fontFamily, fontWeight) => {
    const key = (fontFamily || "").trim().toLowerCase();
    const familyKey = Object.keys(FONT_NAME_MAP).find((k) => key.includes(k));
    if (!familyKey) return { spec: `font='${fontFamily || "Montserrat"}'` };
    const map = FONT_NAME_MAP[familyKey];
    const weightKey = String(fontWeight || "").trim();
    const fileName =
      map.styles[weightKey] ||
      map.styles["800"] ||
      map.styles["700"] ||
      map.styles["400"] ||
      null;
    if (!fileName) return { spec: `font='${map.family}'` };
    const filePath = path.join(FONT_DIR, fileName);
    if (!fs.existsSync(filePath)) return { spec: `font='${map.family}'` };
    const escaped = filePath.replace(/'/g, "\\'");
    return { spec: `fontfile='${escaped}'` };
  };

  const clampFontSizeRatio = (ratio) => {
    const r = Number.isFinite(ratio) ? ratio : 0.25;
    // Avoid absurdly large text that renders off-frame; cap at 30% of height.
    return Math.min(Math.max(r, 0.05), 0.3);
  };

  const computeSpacing = (letterSpacing, fontsize) => {
    if (letterSpacing === null || letterSpacing === undefined) return "";
    const numeric = Number(letterSpacing);
    if (!Number.isFinite(numeric)) return "";
    if (Math.abs(numeric) < 1e-6) return "";
    if (Math.abs(numeric) < 5) {
      return `:spacing=${Math.round(numeric * fontsize)}`;
    }
    return `:spacing=${Math.round(numeric)}`;
  };

  const escapeForFilterValue = (text) =>
    String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ge-captions-"));
  let textFileCounter = 0;
  const writeTextFile = (text) => {
    const fileName = `word-${String(textFileCounter).padStart(4, "0")}.txt`;
    textFileCounter += 1;
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, String(text || ""), "utf8");
    return escapeForFilterValue(filePath);
  };

  const applyStyle = (styleOverride = null) => {
    const s = { ...globalStyle, ...(styleOverride || {}) };
    const fontcolorRaw = s.mode === "default" ? s.color || "#ffffff" : "#ffffff";
    const fontcolor =
      typeof fontcolorRaw === "string" && fontcolorRaw.startsWith("#")
        ? fontcolorRaw.replace("#", "0x")
        : fontcolorRaw;
    const fontsize = Math.max(12, Math.round(clampFontSizeRatio(s.fontSizeRatio) * height));
    const spacing = computeSpacing(s.letterSpacing, fontsize);
    const transform = s.uppercase ? ":text_transform=uppercase" : "";
    const fontSpec = resolveFontSpec(s.fontFamily || "Montserrat", s.fontWeight || "800").spec;
    return {
      fontfile: null, // fontconfig will pick it from family
      font: s.fontFamily || "Montserrat",
      fontcolor,
      fontsize,
      spacing,
      mode: s.mode || "default",
      transform,
      fontWeight: s.fontWeight || "800",
      fontSpec,
    };
  };

  const enableExpr = (startMs, endMs) => {
    const s = Number(startMs) || 0;
    const eRaw = Number(endMs);
    const e = Number.isFinite(eRaw) ? Math.max(eRaw, s) : s;
    // End-exclusive timing prevents boundary-frame double renders for back-to-back captions.
    const startSec = (s / 1000).toFixed(6);
    const endSec = (e / 1000).toFixed(6);
    return `enable='gte(t\\,${startSec})*lt(t\\,${endSec})'`;
  };

  // Decide whether a line/word is active based on displayRanges
  const displayRanges = Array.isArray(captions.displayRanges) ? captions.displayRanges : [];
  const isWordMode = (startMs, endMs) =>
    displayRanges.some(
      (r) =>
        r.mode === "word" &&
        startMs < (r.endMs ?? r.startMs ?? 0) &&
        endMs > (r.startMs ?? 0)
    );

  const lines = Array.isArray(captions.lines) ? captions.lines : [];
  const words = Array.isArray(captions.words) ? captions.words : [];

  const pushFilter = (mode, filter, startMs, endMs) => {
    if (mode === "negative") {
      negativeFilters.push(filter);
      return;
    }
    if (mode === "cutout") {
      cutoutFilters.push(filter);
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        cutoutRanges.push([startMs, endMs]);
      }
      return;
    }
    defaultFilters.push(filter);
  };

  // Build line filters
  lines.forEach((line) => {
    const start = Number(line.startMs) || 0;
    const end = Number(line.endMs) || start;
    if (isWordMode(start, end)) return; // skip lines where word mode is active
    const style = applyStyle(line.useGlobalStyle === false ? line.style || {} : {});
    const rawText = style.transform ? line.text : line.text || "";
    const textfile = writeTextFile(rawText);
    const enable = enableExpr(start, end);
    const draw = [
      `drawtext=textfile=${textfile}:reload=0`,
      style.fontSpec,
      `fontcolor=${style.fontcolor}`,
      `fontsize=${style.fontsize}`,
      `x=(w-text_w)/2`,
      `y=(h-text_h)/2`,
      enable,
    ];
    if (style.spacing) draw.push(style.spacing.replace(":", ""));
    if (style.mode === "cutout") {
      draw.push("borderw=0");
    }
    pushFilter(style.mode || "default", draw.join(":"), start, end);
  });

  // Build word filters where word mode is selected
  words.forEach((word) => {
    const start = Number(word.startMs) || 0;
    const end = Number(word.endMs) || start;
    const style = applyStyle(word.useGlobalStyle === false ? word.style || {} : {});
    const rawText = style.transform ? word.text : word.text || "";
    const textfile = writeTextFile(rawText);
    const enable = enableExpr(start, end);
    const draw = [
      `drawtext=textfile=${textfile}:reload=0`,
      style.fontSpec,
      `fontcolor=${style.fontcolor}`,
      `fontsize=${style.fontsize}`,
      `x=(w-text_w)/2`,
      `y=(h-text_h)/2`,
      enable,
    ];
    if (style.spacing) draw.push(style.spacing.replace(":", ""));
    if (rawText === "TESTIFY") {
      console.log("[generate-edit] TESTIFY drawtext:", draw[0]);
    }
    pushFilter(style.mode || "default", draw.join(":"), start, end);
  });

  return {
    defaultFilters,
    negativeFilters,
    cutoutFilters,
    cutoutRanges,
    width,
    height,
  };
}

function buildFilterComplex({ captions, width, height }) {
  const { defaultFilters, negativeFilters, cutoutFilters, cutoutRanges } = buildDrawtextFilters({
    captions,
    width,
    height,
  });
  const hasCaptionFilters = defaultFilters.length > 0 || negativeFilters.length > 0 || cutoutFilters.length > 0;
  if (!hasCaptionFilters) {
    return { filterComplex: "", hasCaptionFilters: false, cutoutFilters };
  }

  const buildDrawtextChain = ({ inputLabel, prefix, parts }) => {
    let current = inputLabel;
    const steps = [];
    parts.forEach((draw, idx) => {
      const next = `${prefix}${idx + 1}`;
      steps.push(`[${current}]${draw}[${next}]`);
      current = next;
    });
    return { steps, last: current };
  };

  const steps = [];
  let current = "0:v";

  if (defaultFilters.length) {
    const { steps: defaultSteps, last } = buildDrawtextChain({
      inputLabel: current,
      prefix: "v",
      parts: defaultFilters,
    });
    steps.push(...defaultSteps);
    current = last;
  }

  if (negativeFilters.length) {
    const { steps: negSteps, last } = buildDrawtextChain({
      inputLabel: "neg_mask0",
      prefix: "neg_mask",
      parts: negativeFilters,
    });
    steps.push(
      `[${current}]format=rgba,split=2[neg_orig][neg_inv]`,
      "[neg_inv]negate[neg_inverted]",
      `color=c=black@0:size=${width}x${height}[neg_mask0]`,
      ...negSteps,
      `[neg_inverted][${last}]alphamerge[neg_alpha]`,
      `[neg_orig][neg_alpha]overlay[${current}_neg]`
    );
    current = `${current}_neg`;
  }

  if (cutoutFilters.length) {
    const { steps: cutSteps, last } = buildDrawtextChain({
      inputLabel: "cut_mask0",
      prefix: "cut_mask",
      parts: cutoutFilters,
    });
    const enableExpr = (() => {
      if (!cutoutRanges.length) return "";
      const merged = [...cutoutRanges]
        .map(([start, end]) => [Math.max(0, start), Math.max(0, end)])
        .sort((a, b) => a[0] - b[0])
        .reduce((acc, range) => {
          const lastRange = acc[acc.length - 1];
          if (!lastRange || range[0] > lastRange[1]) {
            acc.push(range);
          } else {
            lastRange[1] = Math.max(lastRange[1], range[1]);
          }
          return acc;
        }, []);
      return merged
        .map(
          ([start, end]) =>
            `(gte(t\\,${(start / 1000).toFixed(6)})*lt(t\\,${(end / 1000).toFixed(6)}))`
        )
        .join("+");
    })();
    const enableSuffix = enableExpr ? `=enable='${enableExpr}'` : "";
    steps.push(
      `color=c=black@1:size=${width}x${height}[cut_plate]`,
      `color=c=black@0:size=${width}x${height}[cut_mask0]`,
      `[${current}]split=2[cut_base][cut_src]`,
      `[cut_src]format=rgba[cut_video]`,
      ...cutSteps,
      `[cut_video][${last}]alphamerge[cut_video_alpha]`,
      `[cut_plate][cut_video_alpha]overlay[cutout_frame]`,
      `[cut_base][cutout_frame]overlay${enableSuffix}[${current}_cut]`
    );
    current = `${current}_cut`;
  }

  const filterComplex = [...steps, `[${current}]copy[v]`].join(";");
  return { filterComplex, hasCaptionFilters: true, cutoutFilters };
}

function writeDataUrlToFile(dataUrl, targetPath) {
  const parts = typeof dataUrl === "string" ? dataUrl.split(",") : [];
  if (parts.length < 2) {
    throw new Error("Invalid dataUrl");
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, Buffer.from(parts[1], "base64"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildCloudinaryTrimUrl({ cloudinaryId, start, end, cloudName, fps }) {
  if (!cloudinaryId || !cloudName) return null;
  const startSafe = Math.max(0, Number(start) || 0);
  const endSafe = Math.max(startSafe, Number(end) || startSafe);
  const startStr = startSafe.toFixed(3);
  const endStr = endSafe.toFixed(3);
  const effectiveFps = Math.max(1, Number(fps) || 30);
  const tinyClipThresholdSeconds = 5 / effectiveFps;
  const durationSeconds = Math.max(0, endSafe - startSafe);
  const isTinyClip = durationSeconds <= tinyClipThresholdSeconds;
  const keyframeInterval = isTinyClip ? 1 : 1;
  const transformParts = [
    `so_${startStr}`,
    `eo_${endStr}`,
    "f_mp4",
    "vc_h264:high",
    "q_auto:good",
    `ki_${keyframeInterval}`,
    "fl_splice",
  ];
  const transform = transformParts.join(",");
  return `https://res.cloudinary.com/${cloudName}/video/upload/${transform}/${cloudinaryId}.mp4`;
}

function extractCloudNameFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  // cloudinary://<key>:<secret>@<cloud_name>
  const match = url.match(/^cloudinary:\/\/[^:]+:[^@]+@([^/]+)/i);
  return match?.[1] || null;
}

async function downloadToFile(sourceUrl, targetPath) {
  const res = await fetch(sourceUrl);
  if (!res || !res.ok) {
    throw new Error(`Failed to download clip: ${res?.status || "no response"}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, buf);
}

async function remuxMp4Faststart(inputPath, outputPath) {
  const bin = resolveFfmpegBinary();
  const args = [
    "-y",
    "-i",
    inputPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-fflags",
    "+bitexact",
    "-map_metadata",
    "-1",
    "-movflags",
    "use_metadata_tags+write_colr",
    outputPath,
  ];
  await execFileAsync(bin, args, { timeout: 60_000 });
}

function cleanupOldImports(ttlMs = DEFAULT_IMPORT_TTL_MS) {
  if (!fs.existsSync(EDITOR_IMPORTS_DIR)) return;
  const cutoff = Date.now() - ttlMs;
  const entries = fs.readdirSync(EDITOR_IMPORTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(EDITOR_IMPORTS_DIR, entry.name);
    try {
      const stats = fs.statSync(fullPath);
      if (stats.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

function timestampId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function runFfmpegSpawn(args, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const bin = resolveFfmpegBinary();
  return await new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { env: process.env });
    let stderr = "";
    const timeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch (e) {
        // noop
      }
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);

    proc.stderr.on("data", (d) => {
      // Keep last ~64kb for error reporting, but don't buffer unbounded.
      stderr += d.toString();
      if (stderr.length > 64 * 1024) {
        stderr = stderr.slice(stderr.length - 64 * 1024);
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function renderCaptionsOnMp4({ inputPath, captions, outputPath }) {
  // Match Format Builder defaults: 1920x1080 canvas for filter math.
  const { filterComplex, hasCaptionFilters, cutoutFilters } = buildFilterComplex({
    captions,
    width: 1920,
    height: 1080,
  });

  const args = ["-y", "-i", inputPath];
  if (hasCaptionFilters) {
    args.push("-filter_complex", filterComplex);
  }

  const captionMode = cutoutFilters.length ? "cutout" : "default";
  const crfValue = captionMode === "cutout" ? "0" : "18";
  const pixFmt = captionMode === "cutout" ? "yuvj420p" : "yuv420p";

  args.push(
    "-map",
    hasCaptionFilters ? "[v]" : "0:v",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-crf",
    crfValue,
    "-preset",
    "medium",
    ...(captionMode === "cutout" ? ["-color_range", "pc"] : []),
    "-pix_fmt",
    pixFmt,
    "-shortest",
    outputPath
  );

  await runFfmpegSpawn(args, { timeoutMs: 20 * 60 * 1000 });
}

const STAGE_ORDER = [
  { key: "loadFormat", label: "Load format" },
  { key: "buildSegments", label: "Build beat segments" },
  { key: "assignClips", label: "Assign clips from pool" },
  { key: "trimFrames", label: "Trim to beat frames" },
  { key: "assemble", label: "Assemble / render" },
];

const buildStageResult = ({ key, status, message, durationMs }) => ({
  key,
  status,
  message,
  durationMs,
});

const runStage = async (key, label, callback, stageResults) => {
  const start = Date.now();
  try {
    const payload = await callback();
    const message = payload?.stageMessage || `${label} completed.`;
    stageResults.push(buildStageResult({ key, status: "success", message, durationMs: Date.now() - start }));
    return payload?.result ?? payload;
  } catch (error) {
    stageResults.push(
      buildStageResult({
        key,
        status: "error",
        message: error?.message || `${label} failed`,
        durationMs: Date.now() - start,
      })
    );
    throw error;
  }
};

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    songSlug,
    chronologicalOrder = false,
    editedSegments = null,
    reselect = null,
    includeCaptions = false,
    materialize = true,
  } = body || {};
  if (!songSlug || typeof songSlug !== "string") {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const applyEditedSegments = (segments, edits) => {
    if (!Array.isArray(segments) || !edits || typeof edits !== "object") {
      return segments || [];
    }
    const keys = Object.keys(edits);
    if (!keys.length) return segments;

    return segments.map((segment, index) => {
      const edited = edits[index] ?? edits[String(index)];
      if (!edited) return segment;
      if (!edited.videoId || typeof edited.start !== "number" || typeof edited.end !== "number" || edited.end <= edited.start) {
        return segment;
      }
      return {
        ...segment,
        asset: {
          ...segment.asset,
          videoId: edited.videoId,
          indexId: edited.indexId || segment.asset?.indexId || null,
          start: edited.start,
          end: edited.end,
        },
      };
    });
  };

  const stageResults = [];
  let format;
  let segmentsPayload;
  let pool;
  let assignPayload;
  let plan;
  let renderResult = null;
  let renderError = null;
  let captionedResult = null;
  let localClipUrls = [];
  let editorImportPath = null;
  let rveProject = null;
  const jobId = timestampId();
  const resolvedCloudName =
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
    process.env.CLOUDINARY_CLOUD_NAME ||
    extractCloudNameFromUrl(process.env.CLOUDINARY_URL) ||
    null;

  try {
    cleanupOldImports(DEFAULT_IMPORT_TTL_MS);
    // Minimal reselect flow: return a replacement clip for a single segment without regenerating the full plan.
    if (reselect && typeof reselect === "object") {
      const segmentIndex = typeof reselect.segmentIndex === "number" ? reselect.segmentIndex : null;
      if (segmentIndex === null || segmentIndex < 0) {
        return NextResponse.json({ error: "reselect.segmentIndex is required" }, { status: 400 });
      }
      format = loadGenerateEditFormat(songSlug);
      segmentsPayload = buildGenerateEditSegments(format);
      pool = loadInstantClipPool();
      if (!pool?.clips?.length) {
        throw new Error("Clip pool unavailable. Populate data/instantClipPool.json first.");
      }
      const segments = segmentsPayload.segments || [];
      const segment = segments[segmentIndex];
      if (!segment) {
        return NextResponse.json({ error: `Segment ${segmentIndex} out of range` }, { status: 400 });
      }
      const usedPoolIndices = Array.isArray(reselect.usedPoolIndices) ? reselect.usedPoolIndices : [];
      const bounds = {
        minPoolIndex: typeof reselect.minPoolIndex === "number" ? reselect.minPoolIndex : null,
        maxPoolIndex: typeof reselect.maxPoolIndex === "number" ? reselect.maxPoolIndex : null,
      };
      const replacement = reselectGenerateEditClip({
        segmentIndex,
        segment,
        pool,
        usedPoolIndices,
        bounds,
        options: { chronologicalOrder: Boolean(chronologicalOrder), totalSegments: segments.length },
      });

      const clipStart = replacement?.clip?.start ?? 0;
      const baseDuration = segment.durationSeconds ?? segment.duration ?? 1;
      const pauseMusic =
        segment.type === "rapid"
          ? Boolean(segment.rapidClipSlot?.pauseMusic)
          : Boolean(segment.beatMetadata?.clipSlot?.pauseMusic);
      const duration = pauseMusic && replacement.clipDuration > baseDuration ? replacement.clipDuration : baseDuration;
      const replacementClip = {
        videoId: replacement.clip.videoId || null,
        indexId: replacement.clip.indexId || null,
        cloudinaryId: replacement.clip.cloudinaryId || null,
        start: clipStart,
        end: clipStart + duration,
        duration,
        availableDuration: replacement.clipDuration,
        sourcePoolIndex: replacement.poolIndex,
      };

      return NextResponse.json({ replacementClip });
    }

    format = await runStage(
      "loadFormat",
      STAGE_ORDER[0].label,
      () => ({ result: loadGenerateEditFormat(songSlug), stageMessage: `Loaded format "${songSlug}"` }),
      stageResults
    );

    segmentsPayload = await runStage(
      "buildSegments",
      STAGE_ORDER[1].label,
      () => {
        const segmentsData = buildGenerateEditSegments(format);
        return {
          result: segmentsData,
          stageMessage: `Built ${segmentsData.segments.length} segments`,
        };
      },
      stageResults
    );

    pool = loadInstantClipPool();
    if (!pool?.clips?.length) {
      throw new Error("Clip pool unavailable. Populate data/instantClipPool.json first.");
    }

    assignPayload = await runStage(
      "assignClips",
      STAGE_ORDER[2].label,
      () => {
        const assignResult = assignGenerateEditClips({
          segments: segmentsPayload.segments,
          pool,
          options: { chronologicalOrder },
        });
        return {
          result: assignResult,
          stageMessage: `Assigned ${segmentsPayload.segments.length} clips from ${pool.clips.length}-clip pool${
            chronologicalOrder ? " in chronological mode" : ""
          }`,
        };
      },
      stageResults
    );

    const trimOutcome = await runStage(
      "trimFrames",
      STAGE_ORDER[3].label,
      () => {
        const result = trimGenerateEditSegments({ segments: segmentsPayload.segments, fps: segmentsPayload.fps });
        return { result, stageMessage: "Trimmed clips to exact beat durations" };
      },
      stageResults
    );

    const { segments, fps, stats } = segmentsPayload;
    const totalFrames = trimOutcome?.result?.totalFrames ?? segmentsPayload.totalFrames;
    const uniqueClipsUsed = assignPayload.usedClipIndices.size;
    plan = {
      songSlug,
      songFormat: {
        source: format.source,
        meta: format.meta || {},
        beatCount: format.beatGrid?.length || 0,
        rapidRangeCount: format.rapidClipRanges?.length || 0,
      },
      chronologicalOrder: Boolean(chronologicalOrder),
      selectionMode: chronologicalOrder ? "chronological" : "randomized",
      fps,
      totalFrames,
      totalClips: segments.length,
      stats,
      segments,
      clipPool: {
        ...createClipPoolSummary(pool),
        uniqueClipsUsed,
        usedClipCount: uniqueClipsUsed,
        swapCount: assignPayload.swapHistory.length,
      },
    };

    if (editedSegments && typeof editedSegments === "object" && Object.keys(editedSegments).length > 0) {
      plan.segments = applyEditedSegments(plan.segments, editedSegments);
    }

    // Render stage: allow graceful degradation so we can still return a plan/import when preview render fails.
    {
      const start = Date.now();
      try {
        const renderFn = globalThis.__debugRenderInstantSongEdit;
        if (typeof renderFn !== "function") {
          throw new Error("Instant renderer not available (debug hook missing)");
        }
        const result = await renderFn(plan, {});
        renderResult = result;
        stageResults.push(
          buildStageResult({
            key: "assemble",
            status: "success",
            message: "Rendered MP4",
            durationMs: Date.now() - start,
          })
        );
      } catch (error) {
        renderError = error;
        stageResults.push(
          buildStageResult({
            key: "assemble",
            status: "error",
            message: error?.message || STAGE_ORDER[4].label,
            durationMs: Date.now() - start,
          })
        );
      }
    }

    // Purely additive captions pass: do NOT alter base render output/shape.
    if (includeCaptions && format?.captions && renderResult?.dataUrl) {
      try {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ge-caption-overlay-"));
        const baseAbsPath = path.join(tempDir, "base.mp4");
        writeDataUrlToFile(renderResult.dataUrl, baseAbsPath);

        ensureDir(GE_PREVIEWS_DIR);
        const captionedFileName = `${songSlug}-${timestampId()}-captioned.mp4`;
        const captionedAbsPath = path.join(GE_PREVIEWS_DIR, captionedFileName);
        await renderCaptionsOnMp4({
          inputPath: baseAbsPath,
          captions: format.captions,
          outputPath: captionedAbsPath,
        });
        captionedResult = { url: `/previews/generate-edit/${captionedFileName}` };
      } catch (err) {
        console.warn("[generate-edit] caption overlay failed:", err?.message || err);
      }
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: error?.message || "Generate Edit failed",
        stageResults,
      },
      { status: 500 }
    );
  }

  // Materialize local MP4s for each segment so the editor consumes local assets (no Cloudinary streaming).
  if (materialize && plan?.segments?.length) {
    try {
      const clipDir = path.join(EDITOR_IMPORTS_DIR, jobId, "clips");
      ensureDir(clipDir);
      const cloudName = resolvedCloudName;
      if (!cloudName) {
        throw new Error("Cloudinary cloud name is not configured (set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME or CLOUDINARY_URL)");
      }
      for (let idx = 0; idx < plan.segments.length; idx += 1) {
        const segment = plan.segments[idx];
        const asset = segment?.asset || {};
        const start = Number(asset.start ?? segment.startSeconds ?? 0);
        const end = Number(asset.end ?? segment.endSeconds ?? start);
        const cloudinaryId = asset.cloudinaryId || asset.videoId || null;
        const fallbackUrl = asset.localPath || asset.url || asset.path || null;
        const sourceUrl =
          buildCloudinaryTrimUrl({
            cloudinaryId,
            start,
            end,
            cloudName,
            fps: plan?.fps || plan?.songFormat?.meta?.targetFps || 30,
          }) || fallbackUrl;
        if (!sourceUrl) {
          throw new Error(`Missing source for segment ${idx + 1} (cloudinaryId=${cloudinaryId || "none"})`);
        }
        const clipName = `segment-${String(idx + 1).padStart(4, "0")}.mp4`;
        const clipPath = path.join(clipDir, clipName);
        await downloadToFile(sourceUrl, clipPath);
        // Remux to ensure moov up front and consistent keyframes for seamless playback.
        try {
          const remuxedPath = path.join(clipDir, `remux-${clipName}`);
          await remuxMp4Faststart(clipPath, remuxedPath);
          await fs.promises.rename(remuxedPath, clipPath);
        } catch (err) {
          console.warn(`[generate-edit] remux skipped for ${clipName}:`, err?.message || err);
        }
        const apiUrl = `/api/editor-imports/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipName)}`;
        plan.segments[idx] = {
          ...segment,
          asset: {
            ...asset,
            localPath: apiUrl,
            sourcePoolIndex: asset.sourcePoolIndex ?? asset.poolClipIndex ?? null,
          },
        };
        localClipUrls.push({ index: idx, url: apiUrl, path: clipPath });
      }
      if (!localClipUrls.length) {
        throw new Error("No clips were materialized; check Cloudinary config and source clip availability.");
      }
    } catch (err) {
      console.warn("[generate-edit] Failed to materialize local clips", err);
      return NextResponse.json(
        {
          error: err?.message || "Failed to materialize local clips",
          stageResults,
        },
        { status: 500 }
      );
    }
  }

  // Build editor import payload with local MP4s.
  try {
    rveProject = buildGenerateEditRveProject({
      plan,
      jobId,
      songUrl: plan?.songFormat?.source || null,
    });
    if (!rveProject || !Array.isArray(rveProject?.overlays) || rveProject.overlays.length === 0) {
      throw new Error("Failed to build editor import payload");
    }
  } catch (err) {
    console.warn("[generate-edit] Failed to build rve project", err);
    return NextResponse.json(
      {
        error: err?.message || "Failed to build editor import payload",
        stageResults,
      },
      { status: 500 }
    );
  }

  // Persist import JSON (plan + rve payload + clip refs) for editor3.
  try {
    ensureDir(EDITOR_IMPORTS_DIR);
    editorImportPath = path.join(EDITOR_IMPORTS_DIR, `${jobId}.json`);
    const payload = {
      jobId,
      createdAt: new Date().toISOString(),
      songSlug,
      videoUrl: captionedResult?.url || null,
      baseVideoUrl: null,
      captionedVideoUrl: captionedResult?.url || null,
      plan,
      rveProject: rveProject || null,
      localClipUrls,
    };
    fs.writeFileSync(editorImportPath, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.warn("[generate-edit] Failed to write editor import payload", err);
  }

  return NextResponse.json({
    plan,
    stageResults,
    renderError: renderError ? String(renderError?.message || renderError) : null,
    captionedVideoUrl: captionedResult?.url || null,
    videoDataUrl: renderResult?.dataUrl || null,
    debug: renderResult?.debug || null,
    jobId,
    editorImportPath,
    rveProject,
    localClipUrls,
  });
}

