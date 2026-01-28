import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance = null;
let isLoading = false;
let loadPromise = null;

export async function initFFmpeg() {
  if (typeof window === "undefined") throw new Error("FFmpeg can only be initialized in the browser");
  if (typeof SharedArrayBuffer === "undefined") {
    const isHTTPS = window.location.protocol === "https:" || window.location.hostname === "localhost";
    if (!isHTTPS) throw new Error("SharedArrayBuffer requires HTTPS. Please access the site over HTTPS.");
    throw new Error("SharedArrayBuffer is not available. This usually means the required security headers (COOP/COEP) are not set.");
  }
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  if (isLoading && loadPromise) return loadPromise;

  isLoading = true;
  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpegInstance = ffmpeg;
    ffmpeg.on("log", ({ message, type }) => {
      if (type === "fferr") console.error("FFmpeg error:", message);
      else console.log("FFmpeg:", message);
    });
    try {
      const coreVersion = "0.12.6";
      const baseURL = `https://unpkg.com/@ffmpeg/core@${coreVersion}/dist/esm`;
      const coreURL = `${baseURL}/ffmpeg-core.js`;
      const wasmURL = `${baseURL}/ffmpeg-core.wasm`;
      await ffmpeg.load({ coreURL, wasmURL });
      isLoading = false;
      return ffmpeg;
    } catch (error) {
      isLoading = false;
      loadPromise = null;
      const errorMessage = error?.message || error?.toString() || "Unknown error";
      if (errorMessage.includes("NetworkError") || errorMessage.includes("Failed to fetch") || errorMessage.includes("CORS")) {
        throw new Error("Failed to download FFmpeg files. This might be a network or CORS issue. Please check your internet connection and try again.");
      } else if (errorMessage.includes("SharedArrayBuffer")) {
        throw new Error("SharedArrayBuffer is not available. This is required for video processing. Please ensure you are using HTTPS and a modern browser.");
      } else {
        throw new Error(`Failed to initialize video processor: ${errorMessage}. Check the browser console for more details.`);
      }
    }
  })();
  return loadPromise;
}

export async function processVideoClip(videoUrl, start, end, onProgress) {
  const ffmpeg = await initFFmpeg();
  const duration = end - start;
  try {
    if (onProgress) onProgress(5);
    const outputFileName = "output.mp4";
    const inputUrl = videoUrl;
    const args = ["-ss", String(start), "-i", inputUrl, "-t", String(duration), "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-y", outputFileName];
    let lastProgress = 5;
    ffmpeg.on("progress", ({ progress }) => {
      const progressPercent = Math.min(95, Math.max(5, Math.round(progress * 100)));
      if (progressPercent > lastProgress) {
        lastProgress = progressPercent;
        if (onProgress) onProgress(progressPercent);
      }
    });
    if (onProgress) onProgress(10);
    await ffmpeg.exec(args);
    if (onProgress) onProgress(95);
    const data = await ffmpeg.readFile(outputFileName);
    if (onProgress) onProgress(98);
    try {
      await ffmpeg.deleteFile(outputFileName);
    } catch (cleanupError) {
      console.warn("Could not delete output file:", cleanupError);
    }
    if (onProgress) onProgress(100);
    return new Blob([data.buffer], { type: "video/mp4" });
  } catch (error) {
    try {
      await ffmpeg.deleteFile("output.mp4");
    } catch {
      // ignore
    }
    if (error.message.includes("NetworkError") || error.message.includes("fetch")) {
      throw new Error("Failed to fetch video stream. Please check your internet connection and try again.");
    } else if (error.message.includes("timeout")) {
      throw new Error("Video processing timed out. Please try a shorter clip.");
    } else {
      throw new Error(`Video processing failed: ${error.message}`);
    }
  }
}
