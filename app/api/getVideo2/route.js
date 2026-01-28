import { NextResponse } from "next/server";
import axios from "axios";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("videoId");
  const indexId = searchParams.get("indexId");

  if (!videoId) return NextResponse.json({ error: "videoId is required" }, { status: 400 });

  const apiKey = process.env.TWELVELABS_API_KEY;
  const apiUrl = process.env.TWELVELABS_API_URL;
  const effectiveIndexId = indexId || process.env.TWELVELABS_INDEX_ID;

  if (!apiKey || !apiUrl || !effectiveIndexId) {
    return NextResponse.json({ error: "API key or Index ID is not set" }, { status: 500 });
  }

  try {
    const response = await axios.get(`${apiUrl}/indexes/${effectiveIndexId}/videos/${videoId}`, {
      headers: { "x-api-key": apiKey },
    });
    return NextResponse.json(response.data);
  } catch (error) {
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.message || error.message;
    return NextResponse.json({ error: message }, { status });
  }
}
