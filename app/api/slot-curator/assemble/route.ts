import { NextResponse } from "next/server";
import { assembleSlotPlan, writeSlotPlanImport } from "@/app/editor3/slotDemoAssembler";

export const runtime = "nodejs";

const parseSeed = (value: any) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

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
  if (!songSlug || typeof songSlug !== "string") {
    return NextResponse.json({ error: "songSlug is required" }, { status: 400 });
  }

  const seed = parseSeed(body?.seed ?? params.get("seed"));

  try {
    const assembled = await assembleSlotPlan({ songSlug, seed });
    const { jobId, filePath, rveProject } = await writeSlotPlanImport({
      songSlug,
      plan: assembled.plan,
      fps: assembled.fps,
    });

    return NextResponse.json({
      status: "ok",
      jobId,
      filePath,
      placements: assembled.placements,
      durationSeconds: assembled.durationSeconds,
      fps: assembled.fps,
      warnings: assembled.warnings,
      rveProject,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to assemble slot plan" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
