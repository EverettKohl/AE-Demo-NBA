/* eslint-disable no-undef */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  TARGET_FPS,
  secondsToFrame,
  frameToSeconds,
  beatGridToFrames,
  rapidRangesToFrames,
  calculateFrameSegments,
  calculateLayerSegments,
  getEditPlanStats,
} from "@/lib/frameAccurateTiming";
import {
  normalizeBeatMetadata,
  normalizeIntroBeat,
  normalizeMixSegments,
} from "@/lib/songEditScheduler";

/**
 * POST /api/format-builder/save
 * Saves/updates format JSON for a song
 * 
 * Pre-computes frame numbers for all timing marks to enable
 * frame-accurate video rendering.
 * 
 * Body: {
 *   slug: string,
 *   format: {
 *     source: string,
 *     meta: { durationSeconds: number, bpm: number | null },
 *     beatGrid: number[],
 *     sections: Array<{ name: string, start: number, end: number, energy: string }>,
 *     rapidClipRanges: Array<{ start: number, end: number, interval: number }>
 *   }
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { slug, format } = body;

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    if (!format) {
      return NextResponse.json(
        { error: "Missing format data" },
        { status: 400 }
      );
    }

    // Ensure the song-formats-6 directory exists
    const formatsDir = path.join(process.cwd(), "data", "song-formats-6");
    if (!fs.existsSync(formatsDir)) {
      fs.mkdirSync(formatsDir, { recursive: true });
    }

    const formatPath = path.join(formatsDir, `${slug}.json`);
    const isNew = !fs.existsSync(formatPath);

    // Add timestamps
    const now = new Date().toISOString();
    
    // Ensure meta has targetFps
    const meta = {
      ...format.meta,
      targetFps: format.meta?.targetFps || TARGET_FPS,
    };
    const fps = meta.targetFps;

    // Resolve beat grid in frames first (canonical), then derive seconds
    const incomingBeatFrames = Array.isArray(format.beatGridFrames)
      ? format.beatGridFrames.map((f) => Math.round(f))
      : null;

    const sortedBeatGridFrames = incomingBeatFrames
      ? [...incomingBeatFrames].sort((a, b) => a - b)
      : Array.isArray(format.beatGrid)
      ? format.beatGrid
          .map((t) => Math.round(secondsToFrame(t, fps)))
          .filter((f) => Number.isFinite(f))
          .sort((a, b) => a - b)
      : [];

    const normalizeFrames = (frames) =>
      Array.from(new Set(frames)).sort((a, b) => a - b);

    const applyForegroundDefaults = (beatMetadata = []) =>
      beatMetadata.map((entry) => {
        const clipSlot = { ...(entry?.clipSlot || {}) };
        if (!Number.isFinite(clipSlot.clipVolume)) clipSlot.clipVolume = 0;
        if (!Number.isFinite(clipSlot.musicVolume)) clipSlot.musicVolume = 1;
        return { ...entry, clipSlot };
      });

    const processLayer = (layerInput = {}, isForeground = false) => {
      const incomingBeatFrames = Array.isArray(layerInput.beatGridFrames)
        ? layerInput.beatGridFrames.map((f) => Math.round(f))
        : null;

      const existingBeatSeconds = Array.isArray(layerInput.beatGrid)
        ? layerInput.beatGrid
            .filter((t) => Number.isFinite(t))
            .sort((a, b) => a - b)
        : [];

      const beatGridFrames = incomingBeatFrames?.length
        ? normalizeFrames(incomingBeatFrames)
        : existingBeatSeconds.length
        ? normalizeFrames(
            existingBeatSeconds.map((t) => secondsToFrame(t, fps))
          )
        : [];

      const beatGrid =
        beatGridFrames.length > 0
          ? beatGridFrames.map((f) => frameToSeconds(f, fps))
          : existingBeatSeconds;

      const beatGridFramePairs =
        beatGridFrames.length > 0
          ? beatGridFrames.map((frame) => ({
              frame,
              time: frameToSeconds(frame, fps),
            }))
          : beatGridToFrames(beatGrid, fps);

      const rapidClipRanges = Array.isArray(layerInput.rapidClipRanges)
        ? layerInput.rapidClipRanges
        : [];
      const rapidClipFrames = rapidRangesToFrames(rapidClipRanges, fps);

      let beatMetadata = normalizeBeatMetadata(
        beatGrid,
        layerInput.beatMetadata || []
      );
      if (isForeground) {
        beatMetadata = applyForegroundDefaults(beatMetadata);
      }

      const { segments, totalFrames } = calculateLayerSegments({
        beatGrid,
        beatMetadata,
        rapidClipRanges,
        meta,
      });

      return {
        beatGrid,
        beatGridFrames,
        beatGridFramePairs,
        rapidClipRanges,
        rapidClipFrames,
        beatMetadata,
        clipSegments: segments.map((seg) => ({
          index: seg.index,
          type: seg.type,
          startFrame: seg.startFrame,
          endFrame: seg.endFrame,
          frameCount: seg.frameCount,
          startSeconds: seg.startSeconds,
          durationSeconds: seg.durationSeconds,
          minSourceDuration: seg.minSourceDuration,
        })),
        totalFrames,
        segments,
      };
    };

    const backgroundLayer = processLayer({
      beatGrid: format.beatGrid,
      beatGridFrames: format.beatGridFrames,
      rapidClipRanges: format.rapidClipRanges,
      beatMetadata: format.beatMetadata,
    });

    const cutoutEnabled = Boolean(format.cutoutEnabled);
    const foregroundLayer = processLayer(
      {
        beatGrid: format.foreground?.beatGrid,
        beatGridFrames: format.foreground?.beatGridFrames,
        rapidClipRanges: format.foreground?.rapidClipRanges,
        beatMetadata: format.foreground?.beatMetadata,
      },
      true
    );

    // Calculate total clip count and frame statistics (background only for meta)
    const stats = getEditPlanStats({
      segments: backgroundLayer.segments,
      fps,
      totalFrames: backgroundLayer.totalFrames,
    });

    const mixSegments = normalizeMixSegments(
      format.mixSegments || [],
      meta.durationSeconds
    );
    const introBeat = normalizeIntroBeat(format.introBeat);

    // Build the enhanced format with pre-computed frame data
    const formatWithFrames = {
      source: format.source,
      meta: {
        ...meta,
        totalFrames: backgroundLayer.totalFrames,
        totalClips: stats.totalClips,
        minClipFrames: stats.minClipFrames,
        maxClipFrames: stats.maxClipFrames,
        avgClipFrames: stats.avgClipFrames,
      },
      cutoutEnabled,
      beatGrid: backgroundLayer.beatGrid,
      beatGridFrames: backgroundLayer.beatGridFrames,
      beatGridFramePairs: backgroundLayer.beatGridFramePairs,
      sections: format.sections || [],
      rapidClipRanges: backgroundLayer.rapidClipRanges,
      rapidClipFrames: backgroundLayer.rapidClipFrames,
      mixSegments,
      beatMetadata: backgroundLayer.beatMetadata,
      introBeat,
      captions: format.captions || null,
      clipSegments: backgroundLayer.clipSegments,
      foreground: {
        ...format.foreground,
        beatGrid: foregroundLayer.beatGrid,
        beatGridFrames: foregroundLayer.beatGridFrames,
        beatGridFramePairs: foregroundLayer.beatGridFramePairs,
        rapidClipRanges: foregroundLayer.rapidClipRanges,
        rapidClipFrames: foregroundLayer.rapidClipFrames,
        beatMetadata: foregroundLayer.beatMetadata,
        clipSegments: foregroundLayer.clipSegments,
      },
      createdAt: isNew ? now : format.createdAt || now,
      updatedAt: now,
    };

    // Write the format file
    fs.writeFileSync(
      formatPath,
      JSON.stringify(formatWithFrames, null, 2),
      "utf-8"
    );

    console.log(
      `[format-builder/save] Saved ${slug}: ${stats.totalClips} clips, ${backgroundLayer.totalFrames} frames @ ${fps}fps`
    );

    return NextResponse.json({
      success: true,
      slug,
      isNew,
      path: formatPath,
      format: formatWithFrames,
      frameStats: stats,
    });
  } catch (error) {
    console.error("[format-builder/save] Error:", error);
    return NextResponse.json(
      { error: "Failed to save format" },
      { status: 500 }
    );
  }
}
