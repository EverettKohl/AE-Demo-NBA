import { NextResponse } from "next/server";
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { slotsPath } from "@/lib/slotCurator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const songSlug = url.searchParams.get("songSlug");
  if (!songSlug) {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const filePath = slotsPath(songSlug);
  try {
    if (fs.existsSync(filePath)) {
      await fsp.rm(filePath, { force: true });
    }
    const dir = path.dirname(filePath);
    const remaining = fs.existsSync(dir) ? await fsp.readdir(dir) : [];
    if (!remaining.length) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    return NextResponse.json({ status: "ok", removed: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to reset slots" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
