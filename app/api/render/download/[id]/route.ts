import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import { getRenderState } from "../../../latest/ssr/lib/render-state";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  try {
    const state = getRenderState(id);
    const filePath = path.join(
      process.cwd(),
      "public",
      "rendered-videos",
      `${id}.mp4`
    );

    if (!state && !fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `No render found with ID ${id}` },
        { status: 404 }
      );
    }

    if (state && state.status !== "done") {
      return NextResponse.json(
        { error: `Render ${id} is not completed yet.` },
        { status: 400 }
      );
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `File not found for render ${id}` },
        { status: 404 }
      );
    }

    const fileBuffer = fs.readFileSync(filePath);
    const suggestedName = state?.fileName
      ? state.fileName
      : `rendered-video-${id}.mp4`;

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": fileBuffer.length.toString(),
        "Content-Disposition": `attachment; filename="${suggestedName}"`,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error("Render download failed:", error);
    return NextResponse.json(
      { error: "Failed to download rendered video" },
      { status: 500 }
    );
  }
}
