/* eslint-disable no-console */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { validateClipRange } from "./time";

export type TrimRequest = {
  sourceUrl: string;
  start: number;
  end: number;
  filename?: string;
  onProgress?: (percent: number) => void;
};

let ffmpegInstance: FFmpeg | null = null;

const getFFmpeg = async (onProgress?: (percent: number) => void) => {
  if (typeof window === "undefined") {
    throw new Error("FFmpeg trimming must run in the browser.");
  }

  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
  }

  ffmpegInstance.on("progress", ({ progress }) => {
    const percent = Math.min(99, Math.max(0, Math.round(progress * 100)));
    onProgress?.(percent);
  });

  if (!ffmpegInstance.loaded) {
    await ffmpegInstance.load({
      // Let the library resolve core scripts; defaults work for most setups.
      // Customize here if hosting assets elsewhere.
    });
  }

  return ffmpegInstance;
};

export const trimClipToBlob = async ({
  sourceUrl,
  start,
  end,
  filename = "clip.mp4",
  onProgress,
}: TrimRequest): Promise<{ blob: Blob; url: string; filename: string }> => {
  const validation = validateClipRange(start, end);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const ffmpeg = await getFFmpeg(onProgress);
  const inputName = "input.mp4";
  const outputName = "output.mp4";

  // Fetch and write input
  const fileData = await fetchFile(sourceUrl);
  await ffmpeg.writeFile(inputName, fileData);

  try {
    onProgress?.(5);
    await ffmpeg.exec([
      "-ss",
      `${start}`,
      "-to",
      `${end}`,
      "-i",
      inputName,
      "-c",
      "copy",
      "-avoid_negative_ts",
      "1",
      "-movflags",
      "+faststart",
      outputName,
    ]);

    const outputData = await ffmpeg.readFile(outputName);
    onProgress?.(100);
    const blob = new Blob([outputData], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    return { blob, url, filename };
  } finally {
    // Clean up temp files
    try {
      await ffmpeg.deleteFile(inputName);
    } catch (e) {
      console.warn("FFmpeg cleanup (input) failed:", e);
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch (e) {
      console.warn("FFmpeg cleanup (output) failed:", e);
    }
  }
};

