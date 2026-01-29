import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import {
  completeRender,
  failRender,
  saveRenderState,
  updateRenderProgress,
} from "../../latest/ssr/lib/render-state";
import {
  CompositionProps as CompositionPropsSchema,
  Overlay,
  OverlayType,
} from "../../../editor3/reactvideoeditor/types";

const JOB_ROOT = path.join(process.cwd(), "tmp", "ffmpeg-jobs");
const OUTPUT_DIR = path.join(process.cwd(), "public", "rendered-videos");

if (!fs.existsSync(JOB_ROOT)) {
  fs.mkdirSync(JOB_ROOT, { recursive: true });
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

type CompositionInput = z.infer<typeof CompositionPropsSchema> & {
  backgroundColor?: string;
  baseUrl?: string;
};

type MediaOverlay = Overlay & {
  src?: string;
  content?: string;
};

type PersistedInput = {
  kind: "video" | "image" | "audio" | "text";
  overlay: MediaOverlay;
  filePath: string;
  startSec: number;
  endSec: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

const parseTimeToSeconds = (timeString: string): number => {
  const match = timeString.match(
    /(?<hours>\d+):(?<minutes>\d+):(?<seconds>[\d.]+)/
  );
  if (!match || !match.groups) return 0;
  const hours = Number(match.groups.hours);
  const minutes = Number(match.groups.minutes);
  const seconds = Number(match.groups.seconds);
  return hours * 3600 + minutes * 60 + seconds;
};

const safeNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  if (!Number.isFinite(num)) return fallback;
  return num;
};

const writeBufferToFile = async (buffer: ArrayBuffer, targetPath: string) => {
  await fs.promises.writeFile(targetPath, Buffer.from(buffer));
};

const persistMediaSource = async (
  source: string,
  jobDir: string,
  fileName: string
): Promise<string> => {
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const extFromUrl = path.extname(source.split("?")[0] || "") || ".bin";
  const targetPath = path.join(jobDir, `${sanitizedName}${extFromUrl}`);

  // Data URL (base64)
  if (source.startsWith("data:")) {
    const [, meta] = source.split(",");
    if (!meta) throw new Error("Invalid data URL");
    const buffer = Buffer.from(meta, "base64");
    await fs.promises.writeFile(targetPath, buffer);
    return targetPath;
  }

  // Local absolute path
  if (source.startsWith("file://")) {
    const filePath = source.replace("file://", "");
    return filePath;
  }

  if (source.startsWith("/")) {
    // Assume already on disk relative to project root
    const candidate = path.join(process.cwd(), source);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Remote URL - download to disk
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch media: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await writeBufferToFile(arrayBuffer, targetPath);
  return targetPath;
};

const normalizeOverlay = (
  overlay: MediaOverlay,
  fps: number
): PersistedInput | null => {
  const startSec = safeNumber(overlay.from, 0) / fps;
  const endSec =
    startSec + safeNumber(overlay.durationInFrames, 0) / fps || startSec;

  const width = safeNumber((overlay as any).width, 0);
  const height = safeNumber((overlay as any).height, 0);
  const left = safeNumber((overlay as any).left, 0);
  const top = safeNumber((overlay as any).top, 0);

  if (endSec <= startSec) {
    return null;
  }

  switch (overlay.type) {
    case OverlayType.VIDEO:
      return {
        kind: "video",
        overlay,
        filePath: "",
        startSec,
        endSec,
        width,
        height,
        left,
        top,
      };
    case OverlayType.IMAGE:
    case OverlayType.SHAPE:
    case OverlayType.STICKER:
      return {
        kind: "image",
        overlay,
        filePath: "",
        startSec,
        endSec,
        width,
        height,
        left,
        top,
      };
    case OverlayType.SOUND:
      return {
        kind: "audio",
        overlay,
        filePath: "",
        startSec,
        endSec,
        width,
        height,
        left,
        top,
      };
    case OverlayType.TEXT:
      return {
        kind: "text",
        overlay,
        filePath: "",
        startSec,
        endSec,
        width,
        height,
        left,
        top,
      };
    default:
      return null;
  }
};

const buildFilterGraph = (params: {
  inputs: PersistedInput[];
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  backgroundColor?: string;
}) => {
  const { inputs, durationSeconds, fps, width, height, backgroundColor } =
    params;

  const args: string[] = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=size=${Math.round(width)}x${Math.round(
      height
    )}:duration=${durationSeconds.toFixed(3)}:rate=${fps}:color=${
      backgroundColor || "black"
    }`,
  ];

  const videoInputs: { inputIndex: number; spec: PersistedInput }[] = [];
  const audioInputs: { inputIndex: number; spec: PersistedInput }[] = [];
  const textInputs: PersistedInput[] = [];

  let mediaInputIndex = 1; // Start after the color input

  inputs.forEach((input) => {
    if (input.kind === "text") {
      textInputs.push(input);
      return;
    }

    const overlayDuration = Math.max(0.1, input.endSec - input.startSec);
    const baseArgs: string[] = [];

    if (input.kind === "image") {
      baseArgs.push("-loop", "1", "-t", overlayDuration.toFixed(3));
    }

    baseArgs.push("-i", input.filePath);
    args.push(...baseArgs);

    const inputIndex = mediaInputIndex;
    mediaInputIndex += 1;
    if (input.kind === "audio") {
      audioInputs.push({ inputIndex, spec: input });
    } else {
      videoInputs.push({ inputIndex, spec: input });
    }
  });

  const filterLines: string[] = [];
  let baseLabel = "base0";
  filterLines.push(`[0:v]format=rgba,setsar=1[${baseLabel}]`);

  videoInputs.forEach(({ inputIndex, spec }, overlayIdx) => {
    const scaledLabel = `v${overlayIdx}`;
    const nextBase = `base${overlayIdx + 1}`;
    const start = spec.startSec.toFixed(3);
    const end = spec.endSec.toFixed(3);

    filterLines.push(
      `[${inputIndex}:v]scale=${Math.max(
        1,
        Math.round(spec.width || width)
      )}:${Math.max(
        1,
        Math.round(spec.height || height)
      )}:force_original_aspect_ratio=decrease,format=rgba[${scaledLabel}]`
    );
    filterLines.push(
      `[${baseLabel}][${scaledLabel}]overlay=x=${Math.round(
        spec.left
      )}:y=${Math.round(spec.top)}:enable='between(t,${start},${end})'[${nextBase}]`
    );

    baseLabel = nextBase;
  });

  const escapeText = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");

  textInputs.forEach((spec, idx) => {
    const nextBase = `base_text_${idx}`;
    const start = spec.startSec.toFixed(3);
    const end = spec.endSec.toFixed(3);
    const rawText =
      (spec.overlay as any).content ||
      (spec.overlay as any).text ||
      (spec.overlay as any).title ||
      "";
    const fontSizeRaw = (spec.overlay as any).styles?.fontSize || "32";
    const fontSize = Number.parseInt(
      typeof fontSizeRaw === "string"
        ? fontSizeRaw.replace(/[^\d]/g, "")
        : fontSizeRaw,
      10
    );
    const color =
      (spec.overlay as any).styles?.color ||
      (spec.overlay as any).styles?.fontColor ||
      "white";

    filterLines.push(
      `[${baseLabel}]drawtext=text='${escapeText(
        String(rawText)
      )}':x=${Math.round(spec.left)}:y=${Math.round(
        spec.top
      )}:fontsize=${Number.isFinite(fontSize) ? fontSize : 32}:fontcolor=${color}:enable='between(t,${start},${end})'[${nextBase}]`
    );
    baseLabel = nextBase;
  });

  const audioLines: string[] = [];
  audioInputs.forEach(({ inputIndex, spec }, idx) => {
    const delayMs = Math.max(0, Math.round(spec.startSec * 1000));
    const duration = Math.max(0.1, spec.endSec - spec.startSec);
    audioLines.push(
      `[${inputIndex}:a]adelay=${delayMs}|${delayMs},atrim=0:${duration.toFixed(
        3
      )},asetpts=PTS-STARTPTS[a${idx}]`
    );
  });

  if (audioLines.length) {
    filterLines.push(...audioLines);
    const mixInputs = audioLines.map((_, idx) => `[a${idx}]`).join("");
    filterLines.push(
      `${mixInputs}amix=inputs=${audioLines.length}:dropout_transition=0:normalize=0[mixa]`
    );
  }

  const filterComplex = filterLines.join(";");
  return {
    args,
    filterComplex,
    finalVideoLabel: baseLabel,
    finalAudioLabel: audioLines.length ? "mixa" : null,
  };
};

const runFfmpeg = async (params: {
  renderId: string;
  inputProps: CompositionInput;
  fileName: string;
}) => {
  const { inputProps, renderId, fileName } = params;

  const durationSeconds = Math.max(
    0.1,
    inputProps.durationInFrames / inputProps.fps
  );
  const jobDir = path.join(JOB_ROOT, renderId);
  fs.mkdirSync(jobDir, { recursive: true });

  const normalizedOverlays =
    Array.isArray(inputProps.overlays) && inputProps.overlays.length
      ? inputProps.overlays
          .map((overlay) => normalizeOverlay(overlay as MediaOverlay, inputProps.fps))
          .filter(Boolean) as PersistedInput[]
      : [];

  // Persist media sources to disk
  for (let i = 0; i < normalizedOverlays.length; i++) {
    const overlay = normalizedOverlays[i];
    if (overlay.kind === "text") {
      continue;
    }
    const src =
      (overlay.overlay as any).src ||
      (overlay.overlay as any).content ||
      (overlay.overlay as any).url;
    if (!src) continue;
    const filePath = await persistMediaSource(src, jobDir, `overlay-${i}`);
    normalizedOverlays[i] = { ...overlay, filePath };
  }

  const outputPath = path.join(OUTPUT_DIR, `${renderId}.mp4`);

  const graph = buildFilterGraph({
    inputs: normalizedOverlays,
    durationSeconds,
    fps: inputProps.fps,
    width: inputProps.width,
    height: inputProps.height,
    backgroundColor: inputProps.backgroundColor,
  });

  const args = [
    ...graph.args,
    "-filter_complex",
    graph.filterComplex,
    "-map",
    `[${graph.finalVideoLabel}]`,
  ];

  if (graph.finalAudioLabel) {
    args.push("-map", `[${graph.finalAudioLabel}]`);
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(inputProps.fps),
    "-t",
    durationSeconds.toFixed(3),
    outputPath
  );

  saveRenderState(renderId, {
    status: "rendering",
    progress: 0,
    url: null,
    size: null,
    timestamp: Date.now(),
    fileName,
  });

  const ffmpegBin = ffmpegPath;
  if (!ffmpegBin) {
    failRender(renderId, "ffmpeg binary not found");
    throw new Error("ffmpeg binary not found");
  }

  const child = spawn(ffmpegBin, args);
  child.stderr.on("data", (data) => {
    const message = data.toString();
    const timeMatch = message.match(/time=(\d+:\d+:\d+\.\d+)/);
    if (timeMatch) {
      const seconds = parseTimeToSeconds(timeMatch[1]);
      const progress = Math.min(
        100,
        Math.max(0, (seconds / durationSeconds) * 100)
      );
      updateRenderProgress(renderId, progress);
    }
  });

  return new Promise<void>((resolve) => {
    child.on("exit", (code) => {
      if (code === 0) {
        const stats = fs.statSync(outputPath);
        completeRender(
          renderId,
          `/api/render/download/${renderId}`,
          stats.size
        );
        resolve();
        return;
      }
      failRender(renderId, `ffmpeg exited with code ${code}`);
      resolve();
    });

    child.on("error", (err) => {
      failRender(renderId, err.message);
      resolve();
    });
  });
};

export const startFfmpegRender = async (inputProps: CompositionInput) => {
  const renderId = uuidv4();
  const fileName = `download-video-${renderId}.mp4`;
  saveRenderState(renderId, {
    status: "invoking",
    progress: 0,
    timestamp: Date.now(),
    fileName,
  });

  // Fire and forget
  setImmediate(() => {
    runFfmpeg({ renderId, inputProps, fileName }).catch((err) => {
      failRender(renderId, err.message);
    });
  });

  return renderId;
};

export { buildFilterGraph };
