import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const getFfmpegPath = () => {
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && typeof ffmpegStatic === "string" && existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // ignore
  }
  return "ffmpeg";
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("videoId");
  const start = parseFloat(searchParams.get("start"));
  const end = parseFloat(searchParams.get("end"));
  const videoUrl = searchParams.get("videoUrl");

  if (!videoId || start === null || end === null || !videoUrl) {
    return NextResponse.json({ error: "Missing required parameters: videoId, start, end, videoUrl" }, { status: 400 });
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end <= start) {
    return NextResponse.json({ error: "Invalid time range: start and end must be valid numbers with start < end" }, { status: 400 });
  }
  if (end - start > 180) {
    return NextResponse.json({ error: "Clip duration cannot exceed 3 minutes" }, { status: 400 });
  }

  const apiKey = process.env.TWELVELABS_API_KEY;
  const indexId = process.env.TWELVELABS_INDEX_ID;
  const apiUrl = process.env.TWELVELABS_API_URL;
  if (!apiKey || !indexId || !apiUrl) {
    return NextResponse.json({ error: "API key or Index ID is not set" }, { status: 500 });
  }

  try {
    const videoResponse = await fetch(`${apiUrl}/indexes/${indexId}/videos/${videoId}`, { headers: { "x-api-key": apiKey } });
    if (!videoResponse.ok) throw new Error("Failed to fetch video details");
    const videoData = await videoResponse.json();
    const hlsUrl = videoData.hls?.video_url || videoUrl;
    if (!hlsUrl || typeof hlsUrl !== "string" || !hlsUrl.match(/^https?:\/\//)) {
      throw new Error("Invalid video URL format");
    }
    const filename = videoData.system_metadata?.filename || `video-${videoId}`;
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const clipFilename = `${sanitizedFilename}_clip_${Math.floor(start)}s-${Math.floor(end)}s.mp4`;
    const outputPath = join(tmpdir(), `clip-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`);
    const duration = end - start;

    const runFfmpeg = (args) =>
      new Promise((resolve, reject) => {
        const ffmpegExecutable = getFfmpegPath();
        const ffmpeg = spawn(ffmpegExecutable, args);
        let stderr = "";
        ffmpeg.stderr.on("data", (data) => {
          stderr += data.toString();
        });
        ffmpeg.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        });
        ffmpeg.on("error", (error) => {
          if (error.code === "ENOENT") {
            const isVercel = process.env.VERCEL === "1" || process.env.VERCEL_ENV;
            if (isVercel) {
              reject(new Error("Video clip download is not available on this deployment platform. Please use a platform that supports ffmpeg."));
            } else {
              reject(new Error("ffmpeg is not installed or not found in PATH. Please install ffmpeg or add ffmpeg-static."));
            }
          } else {
            reject(error);
          }
        });
      });

    const ffmpegArgs = ["-ss", String(start), "-i", hlsUrl, "-t", String(duration), "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outputPath];
    try {
      await runFfmpeg(ffmpegArgs);
    } catch {
      const ffmpegArgsOutputSeek = ["-i", hlsUrl, "-ss", String(start), "-t", String(duration), "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outputPath];
      try {
        await runFfmpeg(ffmpegArgsOutputSeek);
      } catch {
        const ffmpegArgsReencode = ["-ss", String(start), "-i", hlsUrl, "-t", String(duration), "-c:v", "libx264", "-c:a", "aac", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outputPath];
        await runFfmpeg(ffmpegArgsReencode);
      }
    }

    if (!existsSync(outputPath)) throw new Error("Failed to create video clip");

    const videoBuffer = readFileSync(outputPath);
    try {
      unlinkSync(outputPath);
    } catch (cleanupError) {
      console.error("Failed to cleanup temp file:", cleanupError);
    }

    const responseHeaders = {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(clipFilename)}`,
    };
    return new NextResponse(videoBuffer, { status: 200, headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
