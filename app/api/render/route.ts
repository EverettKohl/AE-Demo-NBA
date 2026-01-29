import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { startFfmpegRender } from "./lib/ffmpeg-runner";
import { CompositionProps as CompositionPropsSchema } from "../../editor3/reactvideoeditor/types";

const RenderRequestSchema = z.object({
  id: z.string(),
  inputProps: CompositionPropsSchema.extend({
    backgroundColor: z.string().optional(),
    baseUrl: z.string().optional(),
  }),
});

export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_RENDERING_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Rendering is currently disabled" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const data = RenderRequestSchema.parse(body);
    const renderId = await startFfmpegRender({
      ...data.inputProps,
      // Preserve the composition id for future use/debugging
      src: data.inputProps.src || "",
    });

    return NextResponse.json({ renderId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid render request", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Render start failed:", error);
    return NextResponse.json(
      { error: "Failed to start render" },
      { status: 500 }
    );
  }
}
