import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const FORMATS_DIR = path.join(process.cwd(), "data", "song-formats");

export async function POST(request) {
  try {
    const body = await request.json();
    const { slug, captions } = body || {};

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }
    if (!captions) {
      return NextResponse.json({ error: "Missing captions payload" }, { status: 400 });
    }

    if (!fs.existsSync(FORMATS_DIR)) {
      fs.mkdirSync(FORMATS_DIR, { recursive: true });
    }
    const formatPath = path.join(FORMATS_DIR, `${slug}.json`);
    if (!fs.existsSync(formatPath)) {
      return NextResponse.json({ error: "Format not found for song" }, { status: 404 });
    }

    const existing = JSON.parse(fs.readFileSync(formatPath, "utf-8"));
    const next = {
      ...existing,
      captions: {
        ...captions,
      },
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(formatPath, JSON.stringify(next, null, 2), "utf-8");

    return NextResponse.json({ success: true, captions, format: next });
  } catch (error) {
    console.error("[format-builder/captions/save] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save captions" },
      { status: 500 }
    );
  }
}
