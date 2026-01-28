import fs from "fs/promises";
import path from "path";

const CACHE_PATH = path.join(process.cwd(), "movieIndex.json");
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

const DEFAULT_ANCHORS = [
  { label: "Vernita Green kitchen fight", keywords: ["vernita", "kitchen", "suburb"] },
  { label: "House of Blue Leaves showdown", keywords: ["crazy 88", "blue leaves", "snow", "o-ren"] },
  { label: "Bride wakes from coma", keywords: ["hospital", "coma", "wiggle your big toe"] },
  { label: "Hattori Hanzo sword forge", keywords: ["hanzo", "sword", "forge", "okinawa"] },
];

const parseIndexIds = () => {
  if (process.env.TWELVELABS_INDEX_IDS) {
    return process.env.TWELVELABS_INDEX_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  }
  if (process.env.TWELVELABS_INDEX_ID) {
    return [process.env.TWELVELABS_INDEX_ID.trim()];
  }
  return [];
};

const parseDuration = (value) => {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) return asNumber;
  }
  return 0;
};

const readCachedIndex = async () => {
  try {
    const contents = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(contents);
    return parsed;
  } catch (error) {
    return null;
  }
};

const writeCachedIndex = async (data) => {
  try {
    await fs.writeFile(CACHE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.warn("Unable to write movie index cache:", error.message);
  }
};

const fetchAllVideos = async (apiUrl, indexId, apiKey) => {
  let page = 1;
  const pageLimit = 50;
  const videos = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${apiUrl}/indexes/${indexId}/videos?page_limit=${pageLimit}&page=${page}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Failed to list videos for index ${indexId}: ${res.status} ${msg}`);
    }

    const payload = await res.json();
    const data = payload?.data || payload?.videos || [];
    const pageInfo = payload?.page_info || payload?.pageInfo || {};
    videos.push(
      ...data.map((video) => ({
        indexId,
        videoId: video.video_id || video.videoId || video.id || video._id,
        title: video.video_title || video.title || video.system_metadata?.video_title || video.system_metadata?.filename || "Untitled",
        filename: video.system_metadata?.filename,
        duration: parseDuration(video.duration || video.system_metadata?.duration),
        thumbnail: video.thumbnail_url || video.thumbnailUrl,
        createdAt: video.created_at || video.createdAt,
      }))
    );

    const hasMore =
      Boolean(pageInfo?.next_page_token || pageInfo?.nextPageToken || pageInfo?.next_page) &&
      data.length > 0;
    if (!hasMore) break;
    page += 1;
  }

  return videos;
};

const normalizeChunks = (videos) => {
  // Sort by created date then title to keep offsets predictable
  const sorted = [...videos].sort((a, b) => {
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return a.title.localeCompare(b.title);
  });

  let rollingOffset = 0;
  return sorted.map((video, idx) => {
    const safeDuration = parseDuration(video.duration);
    const startOffset = Number.isFinite(video.start_offset) ? video.start_offset : rollingOffset;
    const endOffset = startOffset + safeDuration;
    rollingOffset = endOffset;

    return {
      ...video,
      chunkLabel: video.title || `Chunk ${idx + 1}`,
      start_offset: startOffset,
      end_offset: endOffset,
      duration: safeDuration,
      order: idx + 1,
    };
  });
};

const buildAnchors = (chunks) => {
  return DEFAULT_ANCHORS.map((anchor) => {
    const found = chunks.find((chunk) =>
      anchor.keywords?.some((keyword) => chunk.chunkLabel?.toLowerCase().includes(keyword))
    );
    return {
      ...anchor,
      chunkId: found?.videoId || null,
      indexId: found?.indexId || null,
      approx_start: found?.start_offset ?? null,
      approx_end: found?.end_offset ?? null,
    };
  });
};

export const loadMovieIndex = async ({ forceRefresh = false } = {}) => {
  const apiKey = process.env.TWELVELABS_API_KEY;
  const apiUrl = process.env.TWELVELABS_API_URL || "https://api.twelvelabs.io/v1.3";
  const indexIds = parseIndexIds();

  if (!apiKey || !indexIds.length) {
    const cached = await readCachedIndex();
    if (cached) {
      return { ...cached, fromCache: true, missingConfig: true };
    }

    // Fall back to an empty index so the app can still render without secrets.
    return {
      movieTitle: "Kill Bill",
      generatedAt: new Date().toISOString(),
      fromCache: true,
      chunkCount: 0,
      totalDuration: 0,
      anchors: [],
      chunks: [],
      missingConfig: true,
    };
  }

  if (!forceRefresh) {
    const cached = await readCachedIndex();
    const cachedAt = cached?.generatedAt ? new Date(cached.generatedAt).getTime() : 0;
    const freshEnough = cached && Date.now() - cachedAt < CACHE_TTL_MS;
    if (freshEnough) {
      return { ...cached, fromCache: true };
    }
  }

  const videos = [];
  for (const indexId of indexIds) {
    const indexVideos = await fetchAllVideos(apiUrl, indexId, apiKey);
    videos.push(...indexVideos);
  }

  const chunks = normalizeChunks(videos);
  const totalDuration = chunks.reduce((acc, chunk) => acc + parseDuration(chunk.duration), 0);

  const movieIndex = {
    movieTitle: "Kill Bill",
    generatedAt: new Date().toISOString(),
    fromCache: false,
    chunkCount: chunks.length,
    totalDuration,
    anchors: buildAnchors(chunks),
    chunks,
  };

  await writeCachedIndex(movieIndex);
  return movieIndex;
};

export const findChunkForTimestamp = (movieIndex, timestampSeconds) => {
  if (!movieIndex?.chunks?.length || typeof timestampSeconds !== "number") return null;
  return (
    movieIndex.chunks.find(
      (chunk) =>
        typeof chunk.start_offset === "number" &&
        typeof chunk.end_offset === "number" &&
        timestampSeconds >= chunk.start_offset &&
        timestampSeconds <= chunk.end_offset
    ) || null
  );
};

export const pickChunkCandidates = (movieIndex, estimatedTimestamp) => {
  if (!movieIndex?.chunks?.length) return movieIndex?.chunks || [];
  if (typeof estimatedTimestamp !== "number") return movieIndex.chunks.slice(0, 3);
  const match = findChunkForTimestamp(movieIndex, estimatedTimestamp);
  if (!match) return movieIndex.chunks.slice(0, 3);
  const idx = movieIndex.chunks.findIndex((c) => c.videoId === match.videoId);
  return movieIndex.chunks.slice(Math.max(0, idx - 1), idx + 2);
};

export const movieIndexPath = CACHE_PATH;
