import { NextResponse } from "next/server";
import { listParts, listClipVariants, deletePartEntry } from "@/lib/instantVariants";
import { computeInstantReadiness } from "@/lib/instantReadiness";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const songSlug = searchParams.get("songSlug");
  const parts = listParts(songSlug || undefined);
  const clipVariants = listClipVariants(songSlug || undefined);
  const readiness = songSlug ? computeInstantReadiness(songSlug) : null;
  return NextResponse.json({ parts, clipVariants, readiness });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  return NextResponse.json({ error: "Use /instant-variants/generate for part generation" }, { status: 400 });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const songSlug = searchParams.get("songSlug");
  if (!songSlug) {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }
  try {
    const manifestPath = path.join(process.cwd(), "data", "instant-edit-variants", `${songSlug}.json`);
    const publicDir = path.join(process.cwd(), "public", "instant-edits", songSlug);
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
    }
    if (fs.existsSync(publicDir)) {
      fs.rmSync(publicDir, { recursive: true, force: true });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[instant-variants DELETE] Error:", error);
    return NextResponse.json({ error: error?.message || "Delete failed" }, { status: 500 });
  }
}

