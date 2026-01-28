import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { normalizeIntroBeat } from "@/lib/songEditScheduler";

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

    const formatPath = path.join(
      process.cwd(),
      "data",
      "song-formats",
      `${slug}.json`
    );

    const emptyForeground = {
      beatGrid: [],
      beatGridFrames: [],
      beatGridFramePairs: [],
      rapidClipRanges: [],
      rapidClipFrames: [],
      beatMetadata: [],
      clipSegments: [],
    };

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
          },
          beatGrid: [],
          sections: [],
          rapidClipRanges: [],
          mixSegments: [],
          beatMetadata: [],
          introBeat: normalizeIntroBeat(),
          captions: null,
          cutoutEnabled: false,
          foreground: emptyForeground,
          createdAt: null,
          updatedAt: null,
        },
      });
    }

    // Read and parse the format file
    const content = fs.readFileSync(formatPath, "utf-8");
    const format = JSON.parse(content);
    format.mixSegments = Array.isArray(format.mixSegments) ? format.mixSegments : [];
    format.beatMetadata = Array.isArray(format.beatMetadata) ? format.beatMetadata : [];
    format.captions = format.captions || null;
    format.introBeat = normalizeIntroBeat(format.introBeat);
    format.cutoutEnabled = Boolean(format.cutoutEnabled);

    const fg = typeof format.foreground === "object" && format.foreground ? format.foreground : {};
    format.foreground = {
      beatGrid: Array.isArray(fg.beatGrid) ? fg.beatGrid : [],
      beatGridFrames: Array.isArray(fg.beatGridFrames) ? fg.beatGridFrames : [],
      beatGridFramePairs: Array.isArray(fg.beatGridFramePairs) ? fg.beatGridFramePairs : [],
      rapidClipRanges: Array.isArray(fg.rapidClipRanges) ? fg.rapidClipRanges : [],
      rapidClipFrames: Array.isArray(fg.rapidClipFrames) ? fg.rapidClipFrames : [],
      beatMetadata: Array.isArray(fg.beatMetadata) ? fg.beatMetadata : [],
      clipSegments: Array.isArray(fg.clipSegments) ? fg.clipSegments : [],
    };

    return NextResponse.json({
      exists: true,
      format,
    });
  } catch (error) {
    console.error("[format-builder/get] Error:", error);
    return NextResponse.json(
      { error: "Failed to load format" },
      { status: 500 }
    );
  }
}
