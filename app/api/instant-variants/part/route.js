import { NextResponse } from "next/server";
import { loadVariantManifest, saveVariantManifest } from "@/lib/instantVariants";

export const runtime = "nodejs";

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const songSlug = searchParams.get("songSlug");
  const partId = searchParams.get("partId");
  if (!songSlug || !partId) {
    return NextResponse.json({ error: "songSlug and partId are required" }, { status: 400 });
  }
  try {
    const manifest = loadVariantManifest(songSlug);
    const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
    const next = parts.filter((p) => p.id !== partId);
    manifest.parts = next;
    saveVariantManifest(songSlug, manifest);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[instant-variants/part DELETE] Error:", error);
    return NextResponse.json({ error: error?.message || "Delete failed" }, { status: 500 });
  }
}
