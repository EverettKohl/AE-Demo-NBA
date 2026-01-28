import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { TARGET_FPS, secondsToFrame } from "@/lib/frameAccurateTiming";

/**
 * GET /api/format-builder/get?slug=song-slug
 * Loads existing format data for a song
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    const formatPath = path.join(process.cwd(), "data", "song-formats-v3-6", `${slug}.json`);

    // Check if format file exists
    if (!fs.existsSync(formatPath)) {
      // Return empty format structure for new songs
      return NextResponse.json({
        exists: false,
        format: {
          source: "",
          meta: {
            durationSeconds: 0,
            bpm: null,
            targetFps: TARGET_FPS,
          },
          schemaVersion: 3,
          layers: [
            {
              id: "video",
              type: "base",
              name: "Video",
              order: 1,
              visible: true,
              locked: false,
              segments: [],
              frameSegments: [],
            },
            {
              id: "waveform",
              type: "waveform",
              name: "Waveform",
              order: 0,
              visible: true,
              locked: true,
              segments: [],
              frameSegments: [],
            },
          ],
          captions: null,
          captionVariants: {},
          activeCaptionVariant: "lyrics",
          captionPlacements: {},
          layeredCaptions: false,
          waveformActiveLayers: {},
          waveformLayerStrengths: {},
          createdAt: null,
          updatedAt: null,
        },
      });
    }

    // Read and parse the format file
    const content = fs.readFileSync(formatPath, "utf-8");
    const format = JSON.parse(content);

    const durationSeconds = Number(format.meta?.durationSeconds) || 0;
    const durationMs = Math.max(0, Math.round(durationSeconds * 1000));
    const fps = format.meta?.targetFps || TARGET_FPS;

    const toMs = (value) => Math.max(0, Math.round(Number(value) || 0));

    const buildSegmentsFromGrid = (grid = [], segmentMetadata = []) => {
      const sorted = Array.isArray(grid) ? [...grid].filter((n) => Number.isFinite(n)).sort((a, b) => a - b) : [];
      const segments = [];
      let cursor = 0;
      sorted.forEach((time, idx) => {
        const startMs = Math.round(cursor * 1000);
        const endMs = Math.round(Math.max(cursor, time) * 1000);
        const metadata = segmentMetadata[idx] || {};
        segments.push({
          id: String(idx + 1),
          startMs,
          endMs,
          payload: {
            ...metadata.clipSlot,
            pauseMusic: metadata.clipSlot?.pauseMusic || false,
            guidelineTags: metadata.guidelineTags || [],
          },
        });
        cursor = time;
      });
      segments.push({
        id: String(sorted.length + 1),
        startMs: Math.round(cursor * 1000),
        endMs: durationMs || Math.round(cursor * 1000),
        payload: {},
      });
      return segments.filter((seg) => Number.isFinite(seg.startMs) && Number.isFinite(seg.endMs) && seg.endMs > seg.startMs);
    };

    const normalizeSegments = (segments = []) =>
      (Array.isArray(segments) ? segments : [])
        .map((seg, idx) => {
          const startMs = toMs(seg.startMs ?? seg.start ?? 0);
          const endMs = toMs(seg.endMs ?? seg.end ?? startMs);
          return {
            id: seg.id || String(idx + 1),
            startMs,
            endMs: Math.max(endMs, startMs),
            payload: seg.payload || {},
          };
        })
        .filter((seg) => seg.endMs > seg.startMs)
        .sort((a, b) => a.startMs - b.startMs);

    const captionSegmentsFromCaptions = (captions) => {
      const lines = Array.isArray(captions?.lines) ? captions.lines : [];
      return lines
        .map((line, idx) => ({
          id: line.id || `cap-${idx + 1}`,
          startMs: toMs(line.startMs ?? 0),
          endMs: toMs(line.endMs ?? line.startMs ?? 0),
          payload: {
            captionMode: line.captionMode || "preset",
            text: line.text || "",
            originalText: line.originalText || line.text || "",
            layer: line.layer || null,
          },
        }))
        .filter((seg) => seg.endMs > seg.startMs);
    };

    const captionsFromSegments = (segments) => ({
      provider: "manual",
      status: "draft",
      lines: (segments || []).map((seg) => ({
        startMs: toMs(seg.startMs),
        endMs: toMs(seg.endMs),
        captionMode: seg.payload?.captionMode || "preset",
        text: seg.payload?.text || "",
        originalText: seg.payload?.originalText || seg.payload?.text || "",
        layer: seg.payload?.layer || null,
      })),
      style: format.captions?.style || {},
      displayRanges: [],
    });

    const withFrameData = (segments) =>
      segments.map((seg, idx) => {
        const startSeconds = seg.startMs / 1000;
        const endSeconds = seg.endMs / 1000;
        const startFrame = secondsToFrame(startSeconds, fps);
        const endFrame = secondsToFrame(endSeconds, fps);
        return {
          ...seg,
          index: idx + 1,
          startSeconds,
          endSeconds,
          durationSeconds: Math.max(0, endSeconds - startSeconds),
          startFrame,
          endFrame,
          frameCount: Math.max(0, endFrame - startFrame),
        };
      });

    const legacyLayersToSegments = () => {
      const layers = [];
      const bgSegmentGrid = Array.isArray(format.segmentGrid) && format.segmentGrid.length
        ? format.segmentGrid
        : format.beatGrid || [];
      const bgSegmentMetadata = Array.isArray(format.segmentMetadata) && format.segmentMetadata.length
        ? format.segmentMetadata
        : format.beatMetadata || [];
      const bgSegments = buildSegmentsFromGrid(bgSegmentGrid, bgSegmentMetadata);
      layers.push({
        id: "video",
        type: "base",
        name: "Video",
        order: 3,
        visible: true,
        locked: false,
        segments: bgSegments,
      });

      if (format.cutoutEnabled) {
        const fgSegments = buildSegmentsFromGrid(
          (format.foreground?.segmentGrid && format.foreground.segmentGrid.length
            ? format.foreground.segmentGrid
            : format.foreground?.beatGrid || []),
          (format.foreground?.segmentMetadata && format.foreground.segmentMetadata.length
            ? format.foreground.segmentMetadata
            : format.foreground?.beatMetadata || [])
        );
        layers.push({
          id: "cutout",
          type: "cutout",
          name: "Cutout",
          order: 2,
          visible: true,
          locked: false,
          segments: fgSegments,
        });
      }

      if (format.captions || format.captionVariants) {
        layers.push({
          id: "captions",
          type: "captions",
          name: "Captions",
          order: 1,
          visible: true,
          locked: false,
          segments: [],
        });
      }

      if (Array.isArray(format.stills) && format.stills.length) {
        layers.push({
          id: "stills",
          type: "stills",
          name: "Stills",
          order: 0,
          visible: true,
          locked: false,
          segments: [],
        });
      }

      layers.push({
        id: "waveform",
        type: "waveform",
        name: "Waveform",
        order: -1,
        visible: true,
        locked: true,
        segments: [],
      });

      return layers;
    };

    const normalizedLayers = Array.isArray(format.layers) && format.layers.length ? format.layers : legacyLayersToSegments();

    const layersWithFrames = normalizedLayers
      .map((layer, idx) => {
        const fallbackCaptionSegments =
          layer.type === "captions"
            ? captionSegmentsFromCaptions(
                format.captions ||
                  format.captionVariants?.[format.activeCaptionVariant || "lyrics"] ||
                  format.captionVariants?.lyrics
              )
            : [];
        const segments = normalizeSegments(
          layer.segments && layer.segments.length ? layer.segments : fallbackCaptionSegments
        );
        const frameSegments = withFrameData(segments);
        return {
          id: layer.id || layer.type || `layer-${idx + 1}`,
          type: layer.type || "base",
          name: layer.name || layer.type || `Layer ${idx + 1}`,
          order: Number.isFinite(layer.order) ? layer.order : idx,
          visible: layer.visible !== false,
          locked: layer.locked === true || layer.type === "waveform",
          segments,
          frameSegments,
        };
      })
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

    const captionLayer = layersWithFrames.find((l) => l.type === "captions");
    const normalizedCaptions =
      captionLayer && captionLayer.segments?.length ? captionsFromSegments(captionLayer.segments) : format.captions || null;
    const normalizedCaptionVariants = {
      ...(format.captionVariants || {}),
      [format.activeCaptionVariant || "lyrics"]: normalizedCaptions,
    };

    const normalizedFormat = {
      ...format,
      schemaVersion: format.schemaVersion || 3,
      meta: {
        ...format.meta,
        targetFps: fps,
        durationSeconds,
      },
      layers: layersWithFrames,
      waveformActiveLayers: format.waveformActiveLayers || {},
      waveformLayerStrengths: format.waveformLayerStrengths || {},
      segmentGrid: [],
      segmentMetadata: [],
      beatGrid: [], // legacy alias
      beatMetadata: [], // legacy alias
      introBeat: null,
      foreground: format.foreground
        ? {
            ...format.foreground,
            segmentGrid: [],
            segmentMetadata: [],
            beatGrid: [], // legacy alias
            beatMetadata: [], // legacy alias
          }
        : undefined,
      captions: normalizedCaptions,
      captionVariants: normalizedCaptionVariants,
      activeCaptionVariant: format.activeCaptionVariant || "lyrics",
      captionPlacements: format.captionPlacements || {},
      layeredCaptions: Boolean(format.layeredCaptions),
    };

    return NextResponse.json({
      exists: true,
      format: normalizedFormat,
    });
  } catch (error) {
    console.error("[format-builder/get] Error:", error);
    return NextResponse.json(
      { error: "Failed to load format" },
      { status: 500 }
    );
  }
}
