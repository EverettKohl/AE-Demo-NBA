import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const TARGET_DIR = path.join(process.cwd(), "data", "format-editor2");

const normalizeSlug = (value?: string | null) => {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { slug?: string; payload?: unknown };
    const { slug, payload } = body || {};

    if (!payload) {
      return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    }

    const safeSlug = normalizeSlug(slug) || `format-${Date.now()}`;
    const filename = `${safeSlug}.json`;

    await fs.mkdir(TARGET_DIR, { recursive: true });
    const targetPath = path.join(TARGET_DIR, filename);

    const content =
      typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

    await fs.writeFile(targetPath, content, "utf-8");

    return NextResponse.json({ ok: true, filename, path: targetPath });
  } catch (error) {
    console.error("[format-editor2/save]", error);
    return NextResponse.json(
      { error: "Failed to save format" },
      { status: 500 },
    );
  }
}
