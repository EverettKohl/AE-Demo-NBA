/* global process */
import axios from "axios";
import FormData from "form-data";
import { resolveKillBillVideoIds, listKillBillVideoIds } from "./videoCatalog.js";
import { getCanonicalVideoId } from "../killBillAgent/utils.js";

const buildVideoIdAllowList = (videoIds) => {
  const resolved = resolveKillBillVideoIds(videoIds);
  if (resolved.length) return resolved;
  return listKillBillVideoIds();
};

export const searchTwelveLabsClips = async ({
  query,
  videoIds = [],
  limit = 5,
  searchOptions = ["visual", "audio", "transcription"],
}) => {
  const apiKey = process.env.TWELVELABS_API_KEY;
  const indexId = process.env.TWELVELABS_INDEX_ID;
  const apiUrl = process.env.TWELVELABS_API_URL || "https://api.twelvelabs.io/v1.3";

  if (!apiKey || !indexId) {
    throw new Error("TWELVELABS_API_KEY and TWELVELABS_INDEX_ID are required.");
  }

  const allowList = buildVideoIdAllowList(videoIds);
  if (!allowList.length) {
    throw new Error("No Twelve Labs video IDs are registered.");
  }

  const form = new FormData();
  searchOptions.forEach((opt) => form.append("search_options", opt));
  form.append("index_id", indexId);
  form.append("query_text", query);
  form.append("page_limit", String(limit));
  form.append("page", "1");
  allowList.forEach((videoId) => form.append("video_ids", videoId));

  const response = await axios.post(`${apiUrl}/search`, form, {
    headers: {
      ...form.getHeaders(),
      "x-api-key": apiKey,
    },
  });

  const payload = response.data;
  const results = Array.isArray(payload?.data) ? payload.data : [];
  const allowedSet = new Set(allowList.map((id) => getCanonicalVideoId(id)));

  return results
    .filter((item) => allowedSet.has(getCanonicalVideoId(item.video_id || item.videoId)))
    .map((item) => ({
      videoId: item.video_id || item.videoId,
      start: typeof item.start === "number" ? item.start : Number(item.start) || 0,
      end: typeof item.end === "number" ? item.end : Number(item.end) || 0,
      confidence: item.confidence || item.score || null,
      raw: item,
    }));
};

export default searchTwelveLabsClips;

