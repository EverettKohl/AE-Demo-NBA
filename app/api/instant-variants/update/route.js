import { NextResponse } from "next/server";
import "@/app/api/song-edit/route";
import { loadVariantManifest, updatePartEntry } from "@/lib/instantVariants";
import { rebuildSinglePart } from "@/lib/instantPartPlanner";
import { computeInstantReadiness } from "@/lib/instantReadiness";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { songSlug, partId, overrides = {}, chronologicalOrder = false } = body || {};
  if (!songSlug || !partId) {
    return NextResponse.json({ error: "songSlug and partId are required" }, { status: 400 });
  }

  const manifest = loadVariantManifest(songSlug);
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  const target = parts.find((p) => p.id === partId);
  if (!target) {
    return NextResponse.json({ error: "partId not found" }, { status: 404 });
  }

  try {
    const rebuilt = await rebuildSinglePart({
      songSlug,
      partEntry: target,
      overrides,
      chronologicalOrder,
    });

    const updated = updatePartEntry(songSlug, partId, {
      ...rebuilt,
      overrides,
    });

    const readiness = computeInstantReadiness(songSlug);

    return NextResponse.json({ part: updated, readiness });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[instant-variants/update] Error:", error);
    return NextResponse.json({ error: error?.message || "Update failed" }, { status: 500 });
  }
}
