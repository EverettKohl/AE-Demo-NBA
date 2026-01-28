import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import os from "node:os";

const execFileAsync = promisify(execFile);

function resolveFfmpegBinary() {
  const envPath = process.env.FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (ffmpegPath && fs.existsSync(ffmpegPath)) return ffmpegPath;
  return "ffmpeg";
}

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

const FORMATS_DIR = path.join(process.cwd(), "data", "song-formats");
const SONGS_DIR = path.join(process.cwd(), "public", "songs");
const PREVIEWS_DIR = path.join(process.cwd(), "public", "previews");
const BASE_VIDEO = path.join(process.cwd(), "public", "sampleEdit.mp4");

function loadFormat(slug) {
  const formatPath = path.join(FORMATS_DIR, `${slug}.json`);
  if (!fs.existsSync(formatPath)) return null;
  return JSON.parse(fs.readFileSync(formatPath, "utf-8"));
}

function findSongPath(slug) {
  if (!fs.existsSync(SONGS_DIR)) return null;
  const file = fs
    .readdirSync(SONGS_DIR)
    .find((f) => f.toLowerCase().endsWith(".mp3") && f.replace(/\.mp3$/i, "").toLowerCase() === slug);
  return file ? path.join(SONGS_DIR, file) : null;
}

function formatTorontoTimestamp() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "format-captions-"));
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
    // IMPORTANT:
    // Use end-exclusive timing so back-to-back captions (end == next start) never overlap.
    // This avoids inclusive `between(t,a,b)` drawing both captions on the boundary frame.
    // Also keep higher precision than milliseconds to reduce rounding artifacts.
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
      console.log("[format-builder/render] TESTIFY drawtext:", draw[0]);
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

export async function POST(request) {
  try {
    const body = await request.json();
    const { slug } = body || {};
    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const format = loadFormat(slug);
    if (!format) {
      return NextResponse.json({ error: "Format not found" }, { status: 404 });
    }
    if (!format.captions) {
      return NextResponse.json({ error: "No captions to render" }, { status: 400 });
    }
    const songPath = findSongPath(slug);
    if (!songPath) {
      return NextResponse.json({ error: "Song audio not found" }, { status: 404 });
    }
    if (!fs.existsSync(BASE_VIDEO)) {
      return NextResponse.json({ error: "Base video not found" }, { status: 500 });
    }

    if (!fs.existsSync(PREVIEWS_DIR)) {
      fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
    }
  // Cleanup older previews for this slug so the newest file is served
  fs.readdirSync(PREVIEWS_DIR)
    .filter((f) => f.startsWith(`${slug}-captions`) && f.endsWith(".mp4"))
    .forEach((f) => {
      try {
        fs.unlinkSync(path.join(PREVIEWS_DIR, f));
      } catch (err) {
        console.warn("Failed to remove old preview", f, err);
      }
    });
  const timestamp = formatTorontoTimestamp();
  const outputFile = `${slug}-captions-${timestamp}.mp4`;
  const outputPath = path.join(PREVIEWS_DIR, outputFile);

    const duration = format.meta?.durationSeconds || null;

    // Build drawtext filters
    const {
      defaultFilters,
      negativeFilters,
      cutoutFilters,
      cutoutRanges,
      width,
      height,
    } = buildDrawtextFilters({
      captions: format.captions,
      width: 1920,
      height: 1080,
    });
    const hasCaptionFilters =
      defaultFilters.length > 0 || negativeFilters.length > 0 || cutoutFilters.length > 0;
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

    let filterComplex = "";
    if (hasCaptionFilters) {
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

      filterComplex = [...steps, `[${current}]copy[v]`].join(";");
    }

    // ffmpeg args: trim/loop base video to duration, replace audio with song, overlay captions
    const args = [
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      BASE_VIDEO,
      "-i",
      songPath,
    ];
    if (duration) {
      args.push("-t", `${duration}`);
    }
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
      "1:a",
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

    const bin = resolveFfmpegBinary();
    await execFileAsync(bin, args, { env: process.env });

    return NextResponse.json({
      success: true,
      url: `/previews/${path.basename(outputPath)}`,
      path: outputPath,
    });
  } catch (error) {
    console.error("[format-builder/render] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to render captions" },
      { status: 500 }
    );
  }
}
