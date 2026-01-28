import { NextResponse } from "next/server";
import path from "path";
import { analyzeWaveform } from "@/lib/audioWaveformAnalyzer";

/**
 * POST /api/format-builder/waveform
 * Analyzes an audio file and returns detailed waveform data for visualization
 *
 * Body: {
 *   songPath: string, // Path relative to public folder (e.g., "songs/mysong.mp3")
 *   targetPoints?: number // Number of data points to generate (default: 500)
 * }
 *
 * Response: {
 *   success: boolean,
 *   volume: number[], // Overall amplitude envelope (0-1)
 *   bands: {
 *     subBass: number[],
 *     bass: number[],
 *     lowMids: number[],
 *     mids: number[],
 *     highMids: number[],
 *     treble: number[],
 *     brilliance: number[]
 *   },
 *   spectralFlux: number[], // Rate of frequency change
 *   onsets: Array<{time: number, strength: number}>,
 *   segments: number[], // derived timing marks (legacy: beats)
 *   bandDefinitions: Object,
 *   pointDuration: number,
 *   numPoints: number,
 *   meta: Object
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { songPath, targetPoints } = body;

    if (!songPath) {
      return NextResponse.json(
        { error: "Missing songPath parameter" },
        { status: 400 }
      );
    }

    // Resolve the full path to the audio file
    const fullPath = path.join(process.cwd(), "public", songPath);

    // Run waveform analysis
    const result = await analyzeWaveform(fullPath, {
      targetPoints: targetPoints ?? 500,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[format-builder/waveform] Error:", error);
    return NextResponse.json(
      { error: error.message || "Waveform analysis failed" },
      { status: 500 }
    );
  }
}

