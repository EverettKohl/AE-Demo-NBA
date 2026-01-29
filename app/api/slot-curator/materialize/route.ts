import { NextResponse } from "next/server";
import { materializeSlotsToLocal, loadClipIndex, loadSharedClipIndex, buildCandidateKey } from "@/lib/localClipStore";
import { readSlotsFile } from "@/lib/slotCurator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // ignore
  }
  const url = new URL(request.url);
  const params = url.searchParams;
  const songSlug = body?.songSlug || params.get("songSlug");
  const mode = (body?.mode || params.get("mode") || "full").toLowerCase();
  if (!songSlug || typeof songSlug !== "string") {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const slots = await readSlotsFile(songSlug);
  if (!slots) {
    return NextResponse.json({ error: "Slots not found. Rebuild slots first." }, { status: 404 });
  }

  try {
    const clipIndex = await loadClipIndex(songSlug);
    const sharedIndex = await loadSharedClipIndex();

    // Build missing-only filter if requested
    const missingKeys = new Set<string>();
    if (mode === "missing") {
      for (const segment of slots.segments || []) {
        for (const cand of segment?.candidates || []) {
          const key = buildCandidateKey(cand);
          const inSong = clipIndex?.entries?.some((e: any) => e.candidateId === key);
          const inShared = sharedIndex?.entries?.some((e: any) => e.candidateId === key);
          if (!inSong && !inShared) {
            missingKeys.add(key);
          }
        }
      }
    }

    const index = await materializeSlotsToLocal({
      songSlug,
      slots,
      fps: slots?.header?.fps || 30,
      missingOnly: mode === "missing",
      signal: undefined,
    });
    return NextResponse.json({
      status: "ok",
      indexPath: `/data/instant-clips/${songSlug}/index.json`,
      entries: index.entries.length,
      mode: mode === "missing" ? "missing" : "full",
      missingCount: missingKeys.size,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to materialize clips" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
