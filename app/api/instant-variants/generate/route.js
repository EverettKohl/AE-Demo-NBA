import { NextResponse } from "next/server";
import "@/app/api/song-edit/route";
import { buildInstantPartVariants } from "@/lib/instantPartPlanner";
import { persistPartEntries } from "@/lib/instantVariants";
import { computeInstantReadiness } from "@/lib/instantReadiness";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { songSlug, chronologicalOrder = false, counts = {}, baseSeed = Date.now() } = body || {};
  if (!songSlug) {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  try {
    const partResult = await buildInstantPartVariants({
      songSlug,
      chronologicalOrder,
      bias: true,
      counts,
      baseSeed,
    });

    const entries = partResult.parts.map((p) => ({
      id: p.id,
      songSlug,
      partType: p.partType,
      seed: p.seed,
      renderUrl: p.renderUrl,
      startSeconds: p.startSeconds,
      endSeconds: p.endSeconds,
      durationSeconds: p.durationSeconds,
      boundaries: p.boundaries,
      status: p.status || "ready",
    }));

    persistPartEntries({ songSlug, entries });
    const readiness = computeInstantReadiness(songSlug);

    return NextResponse.json({ parts: entries, readiness });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[instant-variants/generate] Error:", error);
    return NextResponse.json({ error: error?.message || "Generation failed" }, { status: 500 });
  }
}
