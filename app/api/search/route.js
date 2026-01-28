import { NextResponse } from "next/server";
import { getClipUrl } from "@/utils/cloudinary";
import { resolveKillBillVideoIds, listKillBillVideoIds } from "@/lib/twelveLabs/videoCatalog";
import { isBannedClip, getCloudinaryId, getCanonicalVideoId } from "@/lib/killBillAgent/utils";
import { searchTwelveLabsClips } from "@/lib/twelveLabs/searchClient";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const apiKey = process.env.TWELVELABS_API_KEY;
    const indexId = process.env.TWELVELABS_INDEX_ID;

    if (!apiKey || !indexId) {
      return NextResponse.json({ error: "API key or Index ID is not set" }, { status: 500 });
    }

    const { videoId: requestedVideos, query, limit } = await request.json();
    let resolvedVideoIds = resolveKillBillVideoIds(requestedVideos);
    if (!resolvedVideoIds.length) {
      resolvedVideoIds = listKillBillVideoIds();
    }
    if (!resolvedVideoIds.length || !query) {
      return NextResponse.json({ error: "At least one valid Twelve Labs video identifier and query are required" }, { status: 400 });
    }
    const allowedVideoIdSet = new Set(resolvedVideoIds.map((id) => getCanonicalVideoId(id)));

    const searchResults = await searchTwelveLabsClips({
      query,
      videoIds: resolvedVideoIds,
      limit: limit || 12,
    });

    const results = searchResults
      .map((item) => {
        const start = item.start;
        const end = item.end;
        const resultVideoId = item.videoId || resolvedVideoIds[0];
        const canonicalId = getCanonicalVideoId(resultVideoId);
        if (!allowedVideoIdSet.has(canonicalId)) {
          return null;
        }
        const cloudinaryVideoId = getCloudinaryId(resultVideoId);

        if (typeof start !== "number" || typeof end !== "number" || start >= end) {
          console.warn(`Invalid timestamp range for result: start=${start}, end=${end}`);
          return null;
        }

        if (isBannedClip(resultVideoId, start, cloudinaryVideoId)) {
          console.warn(`Rejecting banned clip: ${resultVideoId} at ${start}s`);
          return null;
        }

        const duration = end - start;
        if (duration > 180) {
          console.warn(`Clip duration (${duration}s) exceeds 3 minutes, skipping`);
          return null;
        }

        try {
          const clipUrl = getClipUrl(cloudinaryVideoId, start, end, { download: false, fps: 30 });

          return {
            start: Math.round(start * 100) / 100,
            end: Math.round(end * 100) / 100,
            videoId: resultVideoId,
            cloudinaryVideoId: cloudinaryVideoId,
            clipUrl,
            confidence: item.confidence || null,
            thumbnail_url: item.raw?.thumbnail_url || item.raw?.thumbnailUrl || null,
          };
        } catch (error) {
          console.error(`Error generating clip URL for result:`, error);
          return null;
        }
      })
      .filter((item) => item !== null);

    return NextResponse.json({
      results,
      pageInfo: { total_results: results.length },
    });
  } catch (error) {
    console.error("Error in POST handler:", error?.response?.data || error);
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.message || error.message;

    return NextResponse.json({ error: message }, { status });
  }
}
