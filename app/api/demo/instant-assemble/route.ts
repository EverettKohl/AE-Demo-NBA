import { NextResponse } from "next/server";
import { assembleInstantEditFromParts } from "@/lib/assembleInstantEditFromParts";
import { getVideoMetadata } from "@/utils/videoValidation";

export const runtime = "nodejs";

const safeNumber = (v: any, fb: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const DEFAULT_FPS = 30;
const DEFAULT_ASPECT: any = "16:9";

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const songSlug = body?.songSlug;
  const variantSeed = body?.seed ?? Date.now();
  if (!songSlug || typeof songSlug !== "string") {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  try {
    const assembled = await assembleInstantEditFromParts({ songSlug, chronologicalOrder: false, seed: variantSeed });
    if (!assembled.ready) {
      return NextResponse.json(
        { error: "Parts not ready. Prepare instant-edit parts first.", missingParts: assembled.missingParts || [] },
        { status: 409 }
      );
    }

    const parts = assembled.partsUsed || [];
    const probed = [];
    for (const p of parts) {
      const abs = p.absPath || null;
      let durationSeconds = 0;
      if (abs) {
        const meta = await getVideoMetadata(abs).catch(() => null);
        durationSeconds = safeNumber(meta?.duration, 0);
      }
      probed.push({
        renderUrl: p.renderUrl,
        partType: p.partType || null,
        durationSeconds,
      });
    }

    return NextResponse.json({
      status: "ok",
      parts: probed,
      fps: DEFAULT_FPS,
      aspectRatio: DEFAULT_ASPECT,
      jobId: assembled.variantId || null,
      seed: variantSeed,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Assembly failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
