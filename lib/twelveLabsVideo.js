import { NextResponse } from "next/server.js";

const TL_API_URL = process.env.TWELVELABS_API_URL || "https://api.twelvelabs.io/v1.3";

export async function findVideoDetail(indexId, videoId) {
  const apiKey = process.env.TWELVELABS_API_KEY;
  if (!apiKey) throw new Error("TWELVELABS_API_KEY is required to fetch video detail.");
  if (!indexId) throw new Error("Missing TwelveLabs indexId for video lookup.");
  const url = `${TL_API_URL}/indexes/${indexId}/videos/${videoId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Failed to fetch video detail for ${videoId}: ${res.status} ${msg}`);
  }
  return res.json();
}
