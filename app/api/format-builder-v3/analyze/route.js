import { NextResponse } from "next/server";
import path from "path";
import { analyzeSong } from "@/lib/audioAnalyzer";

/**
 * POST /api/format-builder/analyze
 * Analyzes an audio file and returns an auto-generated segment map
 *
 * Body: {
 *   songPath: string, // Path relative to public folder (e.g., "songs/mysong.mp3")
 *   minSpacing?: number // Minimum spacing between markers in seconds (default: 0.3)
 * }
 *
 * Response: {
 *   success: boolean,
 *   segmentGrid: number[],
 *   beatGrid: number[], // legacy alias
 *   meta: {
 *     durationSeconds: number,
 *     bpm: number | null,
 *     bpmConfidence: string | null,
 *     segmentCount: number,
 *     beatCount: number, // legacy alias
 *     analyzedAt: string
 *   }
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { songPath, minSpacing } = body;

    if (!songPath) {
      return NextResponse.json(
        { error: "Missing songPath parameter" },
        { status: 400 }
      );
    }

    // Resolve the full path to the audio file
    const fullPath = path.join(process.cwd(), "public", songPath);

    // Run analysis
    const result = await analyzeSong(fullPath, {
      minSpacing: minSpacing ?? 0.3,
    });

    const segmentGrid = Array.isArray(result.segmentGrid) ? result.segmentGrid : result.beatGrid || [];
    const segmentCount = segmentGrid.length;

    return NextResponse.json({
      success: true,
      segmentGrid,
      beatGrid: segmentGrid, // legacy alias
      meta: {
        ...result.meta,
        segmentCount,
        beatCount: segmentCount, // legacy alias
      },
    });
  } catch (error) {
    console.error("[format-builder/analyze] Error:", error);
    return NextResponse.json(
      { error: error.message || "Analysis failed" },
      { status: 500 }
    );
  }
}

