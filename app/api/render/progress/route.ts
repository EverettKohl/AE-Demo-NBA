import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRenderState } from "../../latest/ssr/lib/render-state";

const ProgressRequestSchema = z.object({
  id: z.string(),
  bucketName: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = ProgressRequestSchema.parse(body);
    const state = getRenderState(data.id);

    if (!state) {
      return NextResponse.json({
        type: "error",
        message:
          "No render found. The job may have expired or the server restarted. Please try again.",
      });
    }

    switch (state.status) {
      case "done":
        return NextResponse.json({
          type: "done",
          url: state.url ?? `/rendered-videos/${data.id}.mp4`,
          size: state.size ?? 0,
          ...(state.fileName ? { fileName: state.fileName } : {}),
        });
      case "error":
        return NextResponse.json({
          type: "error",
          message:
            state.error ||
            "Render failed. Please try again after checking your inputs.",
        });
      default:
        return NextResponse.json({
          type: "progress",
          progress: state.progress ?? 0,
        });
    }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid progress request", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Render progress failed:", error);
    return NextResponse.json(
      { error: "Failed to get render progress" },
      { status: 500 }
    );
  }
}
