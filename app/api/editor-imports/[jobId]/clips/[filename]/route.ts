import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import getEditorImportsDir from "@/lib/editorImportsDir";

const EDITOR_IMPORTS_DIR = getEditorImportsDir();

export async function GET(request: Request, { params }: { params: { jobId?: string; filename?: string } }) {
  const { jobId, filename } = params || {};
  if (!jobId || !filename) {
    return NextResponse.json({ error: "Missing jobId or filename" }, { status: 400 });
  }

  const filePath = path.join(EDITOR_IMPORTS_DIR, jobId, "clips", filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.get("range");

  // Support range requests for HTML5 video
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const file = fs.createReadStream(filePath, { start, end });
    const headers = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize.toString(),
      "Content-Type": "video/mp4",
    };
    return new Response(file as any, {
      status: 206,
      headers,
    });
  }

  const file = fs.createReadStream(filePath);
  const headers = {
    "Content-Length": fileSize.toString(),
    "Content-Type": "video/mp4",
  };

  return new Response(file as any, {
    status: 200,
    headers,
  });
}
