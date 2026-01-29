import { NextResponse } from "next/server";

/**
 * GET /api/format-builder/songs
 * Lists all .mp3 files in public/songs/ directory
 */
export async function GET() {
  // Legacy song listing disabled; return an empty list so old tracks no longer
  // surface in the editor.
  return NextResponse.json({ songs: [] });
}
