import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readSlotsFile } from "@/lib/slotCurator";
import { materializeSlotsToLocal } from "@/lib/localClipStore";

export const runtime = "nodejs";

export async function POST() {
  const root = path.join(process.cwd(), "data", "instant-editor");
  if (!fs.existsSync(root)) {
    return NextResponse.json({ error: "data/instant-editor not found" }, { status: 404 });
  }
  const slugs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const results: any[] = [];
  for (const slug of slugs) {
    const slots = await readSlotsFile(slug);
    if (!slots) {
      results.push({ slug, status: "skipped", reason: "slots missing" });
      continue;
    }
    try {
      const index = await materializeSlotsToLocal({ songSlug: slug, slots, fps: slots?.header?.fps || 30 });
      results.push({ slug, status: "ok", entries: index.entries.length });
    } catch (err: any) {
      results.push({ slug, status: "error", reason: err?.message || "failed" });
    }
  }

  return NextResponse.json({ status: "ok", results });
}

export async function GET() {
  return POST();
}
