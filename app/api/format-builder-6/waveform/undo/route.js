import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * POST /api/format-builder/waveform/undo
 * Restores the previous waveform data from backup
 *
 * Body: {
 *   slug: string
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { slug } = body;

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    const waveformDir = path.join(process.cwd(), "data", "waveform-data-6");
    const waveformPath = path.join(waveformDir, `${slug}.json`);
    const backupPath = path.join(waveformDir, `${slug}.backup.json`);

    // Check if backup exists
    if (!fs.existsSync(backupPath)) {
      return NextResponse.json(
        { error: "No backup available to restore" },
        { status: 404 }
      );
    }

    // Read backup data
    const backupContent = fs.readFileSync(backupPath, "utf-8");
    const backupData = JSON.parse(backupContent);

    // Save current as the new backup (so user can redo if needed)
    if (fs.existsSync(waveformPath)) {
      const currentContent = fs.readFileSync(waveformPath, "utf-8");
      fs.writeFileSync(backupPath, currentContent, "utf-8");
    }

    // Restore backup to main file
    const now = new Date().toISOString();
    const restoredData = {
      ...backupData,
      restoredAt: now,
    };

    fs.writeFileSync(
      waveformPath,
      JSON.stringify(restoredData, null, 2),
      "utf-8"
    );

    console.log(`[format-builder/waveform/undo] Restored waveform for ${slug}`);

    return NextResponse.json({
      success: true,
      slug,
      restoredAt: now,
      waveformData: restoredData,
      // There's now a backup (the data we just overwrote)
      hasBackup: true,
    });
  } catch (error) {
    console.error("[format-builder/waveform/undo] Error:", error);
    return NextResponse.json(
      { error: "Failed to restore waveform data" },
      { status: 500 }
    );
  }
}

