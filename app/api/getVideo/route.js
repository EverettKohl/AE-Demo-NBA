"use server";

import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("videoId");
  const indexIdParam = searchParams.get("indexId");

  const apiKey = process.env.TWELVELABS_API_KEY;
  const indexId = indexIdParam || process.env.TWELVELABS_INDEX_ID;
  const apiUrl = process.env.TWELVELABS_API_URL;

  if (!apiKey || !indexId || !apiUrl) {
    return NextResponse.json(
      { error: "API key or Index ID is not set" },
      { status: 500 }
    );
  }

  if (!videoId) {
    return NextResponse.json(
      { error: "videoId is required" },
      { status: 400 }
    );
  }

  const url = `${apiUrl}/indexes/${indexId}/videos/${videoId}`;

  const options = {
    method: "GET",
    headers: {
      "Content-Type": "multipart/form-data",
      "x-api-key": `${apiKey}`,
    },
  };

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

    const video = await response.json();

    // Return a richer payload so callers can find a playable URL.
    return NextResponse.json({
      hls: video.hls,
      video_url: video.video_url || video.videoUrl || null,
      source_url: video.source_url || video.sourceUrl || null,
      urls: video.urls || video.video_urls || video.videoUrls || null,
      system_metadata: video.system_metadata,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || error },
      { status: 500 }
    );
  }
}
