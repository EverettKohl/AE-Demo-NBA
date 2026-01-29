import { NextResponse } from "next/server";

/**
 * GET /api/format-builder/songs
 * Lists all .mp3 files in public/songs/ directory
 */
export async function GET() {
  // Legacy song listing disabled; return empty so old tracks are hidden.
  return NextResponse.json({ songs: [] });
}
