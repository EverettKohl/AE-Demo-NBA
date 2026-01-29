import { NextResponse } from "next/server";
import { readSlotsFile, summarizeSlots } from "@/lib/slotCurator";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const songSlug = searchParams.get("songSlug");
  if (!songSlug) {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const slots = await readSlotsFile(songSlug);
  if (!slots) {
    return NextResponse.json({ error: "Slots not found" }, { status: 404 });
  }

  const summary = summarizeSlots(slots);
  return NextResponse.json({ status: "ok", slots, coverage: summary.coverage, header: summary.header });
}
