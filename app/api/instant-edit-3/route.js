import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assembleInstantEditFromParts } from "@/lib/assembleInstantEditFromParts";

const MANIFEST_PATH = path.join(process.cwd(), "data", "instant-edit-3", "manifest.json");

const loadManifest = () => {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[instant-edit-3] Failed to load manifest", err);
    return { combos: [] };
  }
};

export async function OPTIONS() {
  const manifest = loadManifest();
  return NextResponse.json(manifest);
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { songSlug, chronologicalOrder = false } = body || {};
  if (!songSlug || typeof songSlug !== "string") {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const variantSeed = body?.variantSeed || Date.now();
  const start = Date.now();
  // eslint-disable-next-line no-console
  console.log("[instant-edit-3] start", { songSlug, chronologicalOrder, variantSeed });
  try {
    const assembled = await assembleInstantEditFromParts({
      songSlug,
      chronologicalOrder,
      seed: variantSeed,
    });

    if (!assembled.ready) {
      // eslint-disable-next-line no-console
      console.warn("[instant-edit-3] parts not ready", assembled.missingParts);
      return NextResponse.json(
        {
          error: "Parts not ready. Prepare content in Instant Edit Hub.",
          missingParts: assembled.missingParts || [],
          fallbackUsed: true,
        },
        { status: 409 }
      );
    }

    const elapsed = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log("[instant-edit-3] assembled", { elapsedMs: elapsed });
    return NextResponse.json({
      videoUrl: assembled.videoUrl,
      partsUsed: assembled.partsUsed,
      variantSeed,
      fastPathUsed: true,
      instant: true,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[instant-edit-3] assembly failed:", error);
    const manifest = loadManifest();
    const combo = manifest.combos?.find((c) => c.songSlug === songSlug) || null;
    if (combo) {
      return NextResponse.json({
        videoUrl: combo.videoUrl,
        partsUsed: [],
        variantSeed,
        fastPathUsed: false,
        fallbackUsed: true,
        message: "Assembly failed; returned legacy combo.",
      });
    }
    return NextResponse.json({ error: error?.message || "Assembly failed" }, { status: 500 });
  }
}

