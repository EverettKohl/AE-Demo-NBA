import { NextResponse } from "next/server";
import path from "path";
import { analyzeSong } from "@/lib/audioAnalyzer";

/**
 * POST /api/format-builder/analyze
 * Analyzes an audio file and returns an auto-generated beat map
 *
 * Body: {
 *   songPath: string, // Path relative to public folder (e.g., "songs/mysong.mp3")
 *   minSpacing?: number // Minimum spacing between markers in seconds (default: 0.3)
 * }
 *
 * Response: {
 *   success: boolean,
 *   beatGrid: number[],
 *   meta: {
 *     durationSeconds: number,
 *     bpm: number | null,
 *     bpmConfidence: string | null,
 *     beatCount: number,
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

    return NextResponse.json({
      success: true,
      beatGrid: result.beatGrid,
      meta: result.meta,
    });
  } catch (error) {
    console.error("[format-builder/analyze] Error:", error);
    return NextResponse.json(
      { error: error.message || "Analysis failed" },
      { status: 500 }
    );
  }
}

