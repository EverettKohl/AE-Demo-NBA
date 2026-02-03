import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const FORMAT_DIR = path.join(process.cwd(), "data", "format-editor2");

export async function GET() {
  try {
    await fs.mkdir(FORMAT_DIR, { recursive: true });
    const entries = await fs.readdir(FORMAT_DIR, { withFileTypes: true });
    const formats: Array<{ slug: string; title: string; data: any }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".json")) continue;
      if (entry.name.includes(".backup")) continue;

      const filePath = path.join(FORMAT_DIR, entry.name);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const json = JSON.parse(raw);
        const slug = path.parse(entry.name).name;
        const title =
          json?.meta?.title ||
          json?.timeline?.meta?.title ||
          slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        formats.push({ slug, title, data: json });
      } catch (error) {
        console.error("[format-editor2/list] failed to read", entry.name, error);
      }
    }

    formats.sort((a, b) => a.title.localeCompare(b.title));
    return NextResponse.json({ formats });
  } catch (error) {
    console.error("[format-editor2/list]", error);
    return NextResponse.json({ error: "Failed to list formats" }, { status: 500 });
  }
}
