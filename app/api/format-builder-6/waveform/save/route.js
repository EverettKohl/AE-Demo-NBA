import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * POST /api/format-builder/waveform/save
 * Saves waveform analysis data for a song
 *
 * Body: {
 *   slug: string,
 *   waveformData: Object,
 *   previousWaveform?: Object (for undo support)
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { slug, waveformData, previousWaveform } = body;

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    if (!waveformData) {
      return NextResponse.json(
        { error: "Missing waveformData" },
        { status: 400 }
      );
    }

    // Ensure the waveform-data-6 directory exists
    const waveformDir = path.join(process.cwd(), "data", "waveform-data-6");
    if (!fs.existsSync(waveformDir)) {
      fs.mkdirSync(waveformDir, { recursive: true });
    }

    const waveformPath = path.join(waveformDir, `${slug}.json`);
    const backupPath = path.join(waveformDir, `${slug}.backup.json`);

    // If there's existing waveform data or previousWaveform provided, save backup
    if (previousWaveform) {
      fs.writeFileSync(
        backupPath,
        JSON.stringify(previousWaveform, null, 2),
        "utf-8"
      );
    } else if (fs.existsSync(waveformPath)) {
      // Auto-backup existing data before overwriting
      const existingContent = fs.readFileSync(waveformPath, "utf-8");
      fs.writeFileSync(backupPath, existingContent, "utf-8");
    }

    // Add metadata
    const now = new Date().toISOString();
    const dataToSave = {
      ...waveformData,
      savedAt: now,
      version: 1,
    };

    // Write the waveform file
    fs.writeFileSync(
      waveformPath,
      JSON.stringify(dataToSave, null, 2),
      "utf-8"
    );

    console.log(`[format-builder/waveform/save] Saved waveform for ${slug}`);

    return NextResponse.json({
      success: true,
      slug,
      savedAt: now,
      hasBackup: fs.existsSync(backupPath),
    });
  } catch (error) {
    console.error("[format-builder/waveform/save] Error:", error);
    return NextResponse.json(
      { error: "Failed to save waveform data" },
      { status: 500 }
    );
  }
}

