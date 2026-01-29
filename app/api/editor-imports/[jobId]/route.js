import { NextResponse } from "next/server.js";
import fs from "fs";
import path from "path";
import getEditorImportsDir from "@/lib/editorImportsDir";

const EDITOR_IMPORTS_DIR = getEditorImportsDir();

export async function GET(_, { params }) {
  const { jobId } = params || {};
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const filePath = path.join(EDITOR_IMPORTS_DIR, `${jobId}.json`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Import not found" }, { status: 404 });
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Failed to load import" }, { status: 500 });
  }
}
