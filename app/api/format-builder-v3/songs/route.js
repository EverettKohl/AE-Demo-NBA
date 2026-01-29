import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const BANNED_SONG_SLUGS = new Set([
  "electricdemo2",
  "editor-sample-fashionkilla",
]);

/**
 * GET /api/format-builder/songs
 * Lists all .mp3 files in public/songs/ directory
 */
export async function GET() {
  try {
    const songsDir = path.join(process.cwd(), "public", "songs");
    if (!fs.existsSync(songsDir)) {
      return NextResponse.json({ songs: [] });
    }

    const files = fs.readdirSync(songsDir);
    const songs = files
      .filter((file) => file.toLowerCase().endsWith(".mp3"))
      .map((file) => {
        const slug = file
          .replace(/\.mp3$/i, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        return {
          filename: file,
          slug,
          path: `/songs/${file}`,
          displayName: file.replace(/\.mp3$/i, ""),
        };
      })
      .filter((song) => !BANNED_SONG_SLUGS.has(song.slug.toLowerCase()));

    return NextResponse.json({ songs });
  } catch (error) {
    console.error("[format-builder-v3/songs] Error:", error);
    return NextResponse.json(
      { error: "Failed to list songs" },
      { status: 500 }
    );
  }
}
