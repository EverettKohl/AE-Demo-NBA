import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { normalizeIntroBeat } from "@/lib/songEditScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseFormatFile = (rawContent = "") => {
  const trimmed = String(rawContent || "").trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch (primaryErr) {
    // Some legacy files accidentally contain multiple JSON objects concatenated
    // without commas. Attempt to coerce them into an array and return the last one.
    try {
      // Replace `}{` (with any whitespace between) with `},{` so multiple JSON
      // objects pasted together become a valid JSON array we can parse.
      const coerced = `[${trimmed.replace(/}\s*{/g, "},{")}]`;
      const parsed = JSON.parse(coerced);
      const last = Array.isArray(parsed) ? parsed[parsed.length - 1] : null;
      if (last && typeof last === "object") return last;
    } catch (secondaryErr) {
      // If the fallback also fails, surface the original parse error for clarity.
      throw primaryErr;
    }

    throw primaryErr;
  }
};

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
      cutoutDefinitions: [],
      cutoutInstances: [],
      cutoutClipInstances: [],
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
          cutoutDefinitions: [],
          cutoutInstances: [],
          cutoutClipInstances: [],
          foreground: emptyForeground,
          createdAt: null,
          updatedAt: null,
        },
      });
    }

    // Read and parse the format file
    const content = fs.readFileSync(formatPath, "utf-8");
    const format = parseFormatFile(content);
    format.slug = format.slug || slug;
    format.mixSegments = Array.isArray(format.mixSegments) ? format.mixSegments : [];
    format.beatMetadata = Array.isArray(format.beatMetadata) ? format.beatMetadata : [];
    format.captions = format.captions || null;
    format.introBeat = normalizeIntroBeat(format.introBeat);
    format.cutoutEnabled = Boolean(format.cutoutEnabled);
    format.cutoutDefinitions = Array.isArray(format.cutoutDefinitions)
      ? format.cutoutDefinitions
      : [];
    format.cutoutInstances = Array.isArray(format.cutoutInstances)
      ? format.cutoutInstances
      : [];
    format.cutoutClipInstances = Array.isArray(format.cutoutClipInstances)
      ? format.cutoutClipInstances
      : [];

    const fg = typeof format.foreground === "object" && format.foreground ? format.foreground : {};
    format.foreground = {
      beatGrid: Array.isArray(fg.beatGrid) ? fg.beatGrid : [],
      beatGridFrames: Array.isArray(fg.beatGridFrames) ? fg.beatGridFrames : [],
      beatGridFramePairs: Array.isArray(fg.beatGridFramePairs) ? fg.beatGridFramePairs : [],
      rapidClipRanges: Array.isArray(fg.rapidClipRanges) ? fg.rapidClipRanges : [],
      rapidClipFrames: Array.isArray(fg.rapidClipFrames) ? fg.rapidClipFrames : [],
      beatMetadata: Array.isArray(fg.beatMetadata) ? fg.beatMetadata : [],
      clipSegments: Array.isArray(fg.clipSegments) ? fg.clipSegments : [],
      cutoutDefinitions: Array.isArray(fg.cutoutDefinitions) ? fg.cutoutDefinitions : [],
      cutoutInstances: Array.isArray(fg.cutoutInstances) ? fg.cutoutInstances : [],
      cutoutClipInstances: Array.isArray(fg.cutoutClipInstances) ? fg.cutoutClipInstances : [],
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
