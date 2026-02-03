import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const filePath = path.join(process.cwd(), "data/cv/kill-bill-clip-detections.json");
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Error saving detections:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown error" }, { status: 500 });
  }
}
