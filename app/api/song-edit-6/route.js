import { NextResponse } from "next/server";
import { listSongFormats6 } from "@/lib/songEdit6";

/**
 * GET /api/song-edit-6
 * Returns list of available song formats from the v6 sandbox directory
 */
export async function GET() {
  try {
    const formats = listSongFormats6();
    return NextResponse.json({ formats });
  } catch (error) {
    console.error("[song-edit-6 GET] Error:", error);
    return NextResponse.json({ error: "Failed to list song formats" }, { status: 500 });
  }
}

