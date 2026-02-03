import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/format-builder/waveform/get?slug=song-slug
 * Loads saved waveform data for a song
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

    const waveformDir = path.join(process.cwd(), "data", "waveform-data");
    const waveformPath = path.join(waveformDir, `${slug}.json`);
    const backupPath = path.join(waveformDir, `${slug}.backup.json`);

    // Check if waveform file exists
    if (!fs.existsSync(waveformPath)) {
      return NextResponse.json({
        exists: false,
        waveformData: null,
        hasBackup: fs.existsSync(backupPath),
      });
    }

    // Read and parse the waveform file
    const content = fs.readFileSync(waveformPath, "utf-8");
    const waveformData = JSON.parse(content);

    return NextResponse.json({
      exists: true,
      waveformData,
      hasBackup: fs.existsSync(backupPath),
    });
  } catch (error) {
    console.error("[format-builder/waveform/get] Error:", error);
    return NextResponse.json(
      { error: "Failed to load waveform data" },
      { status: 500 }
    );
  }
}

