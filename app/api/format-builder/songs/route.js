import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/format-builder/songs
 * Lists all .mp3 files in public/songs/ directory
 */
export async function GET() {
  try {
    const songsDir = path.join(process.cwd(), "public", "songs");
    
    // Check if directory exists
    if (!fs.existsSync(songsDir)) {
      return NextResponse.json({ songs: [] });
    }

    // Read all files and filter for .mp3
    const files = fs.readdirSync(songsDir);
    const songs = files
      .filter((file) => file.toLowerCase().endsWith(".mp3"))
      .map((file) => {
        // Create a slug from the filename for use as an ID
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
      });

    return NextResponse.json({ songs });
  } catch (error) {
    console.error("[format-builder/songs] Error:", error);
    return NextResponse.json(
      { error: "Failed to list songs" },
      { status: 500 }
    );
  }
}
