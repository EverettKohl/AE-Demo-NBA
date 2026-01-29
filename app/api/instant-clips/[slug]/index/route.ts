import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { slug: string } }) {
  const slug = params?.slug;
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }
  const indexPath = path.join(process.cwd(), "data", "instant-clips", slug, "index.json");
  if (!fs.existsSync(indexPath)) {
    return NextResponse.json({ error: "index not found" }, { status: 404 });
  }
  try {
    const data = await fs.promises.readFile(indexPath, "utf8");
    const parsed = JSON.parse(data);
    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to read index" }, { status: 500 });
  }
}
