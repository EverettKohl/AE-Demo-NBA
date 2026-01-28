import { NextResponse } from "next/server";
import axios from "axios";
import FormData from "form-data";
import { searchClips } from "@/lib/killBillAgent/tools";
import { KillBillAgent, TASK_MODES } from "@/lib/killBillAgent";
import { resolveKillBillVideoIds } from "@/lib/twelveLabs/videoCatalog";
import { getCanonicalVideoId } from "@/lib/killBillAgent/utils";

export const runtime = "nodejs";
export const maxDuration = 60; // Allow longer timeout for detailed search

/**
 * Quick search - direct TwelveLabs API call (fast)
 */
async function quickSearch(textSearchQuery, { videoFilters } = {}) {
  const apiKey = process.env.TWELVELABS_API_KEY;
  const indexId = process.env.TWELVELABS_INDEX_ID;
  const apiUrl = process.env.TWELVELABS_API_URL;
  const resolvedVideoIds = resolveKillBillVideoIds(videoFilters);
  const allowedVideoIdSet =
    resolvedVideoIds.length > 0
      ? new Set(resolvedVideoIds.map((id) => getCanonicalVideoId(id)))
      : null;

  if (!apiKey || !indexId || !apiUrl) {
    throw new Error("API key or Index ID is not set");
  }

  const searchDataForm = new FormData();
  searchDataForm.append("search_options", "visual");
  searchDataForm.append("search_options", "audio");
  searchDataForm.append("search_options", "transcription");
  searchDataForm.append("index_id", indexId);
  searchDataForm.append("query_text", textSearchQuery);
  if (resolvedVideoIds.length > 0) {
    resolvedVideoIds.forEach((id) => searchDataForm.append("video_ids", id));
  }

  const url = `${apiUrl}/search`;

  const response = await axios.post(url, searchDataForm, {
    headers: {
      "Content-Type": "multipart/form-data",
      "x-api-key": `${apiKey}`,
    },
  });

  const responseData = response.data;
  if (!allowedVideoIdSet?.size) {
    return responseData;
  }

  return {
    ...responseData,
    data: (responseData?.data || []).filter((item) =>
      allowedVideoIdSet.has(getCanonicalVideoId(item.video_id || item.videoId))
    ),
  };
}

/**
 * Detailed search - AI-powered search using Kill Bill Agent (slower but smarter)
 */
async function detailedSearch(textSearchQuery, { videoFilters } = {}) {
  const agent = new KillBillAgent(TASK_MODES.SEARCH);
  
  try {
    const result = await agent.process(
      `Find video clips showing: ${textSearchQuery}. Include visual, audio, and dialogue matches.`,
      {
        maxClips: 20,
        includeContext: true,
      }
    );

    if (!result.success) {
      // Fallback to quick search if agent fails
      console.log("[detailedSearch] Agent failed, falling back to quick search");
      return await quickSearch(textSearchQuery, { videoFilters });
    }

    // Transform agent results to match the expected format
    const clips = result.clips || [];
    
    return {
      page_info: {
        total_results: clips.length,
        page: 1,
        limit_per_page: clips.length,
      },
      data: clips.map((clip) => ({
        video_id: clip.videoId || clip.video_id,
        start: clip.start,
        end: clip.end,
        confidence: clip.confidence || clip.score || 0.5,
        thumbnail_url: clip.thumbnail_url || clip.thumbnail,
        metadata: clip.context || null,
      })),
    };
  } catch (error) {
    console.error("[detailedSearch] Error:", error.message);
    // Fallback to quick search on error
      return await quickSearch(textSearchQuery, { videoFilters });
  }
}

export async function POST(request) {
  try {
    const { textSearchQuery, searchMode = "quick", videoFilters } = await request.json();

    if (!textSearchQuery) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400 }
      );
    }

    console.log(
      `[textSearch] Mode: ${searchMode}, Query: "${textSearchQuery}"${
        videoFilters ? `, Filters: ${JSON.stringify(videoFilters)}` : ""
      }`
    );

    let responseData;
    
    if (searchMode === "detailed") {
      responseData = await detailedSearch(textSearchQuery, { videoFilters });
    } else {
      responseData = await quickSearch(textSearchQuery, { videoFilters });
    }

    if (!responseData) {
      return NextResponse.json(
        { error: "Error getting response from the API" },
        { status: 500 }
      );
    }

    // Return the search results as a JSON response
    return NextResponse.json({
      pageInfo: responseData.page_info || {},
      textSearchResults: responseData.data,
      searchMode,
    });
  } catch (error) {
    console.error("Error in POST handler:", error?.response?.data || error);
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.message || error.message;

    return NextResponse.json({ error: message }, { status });
  }
}
