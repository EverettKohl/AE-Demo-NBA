import { VideoOverlayAdaptor } from "@editor/reactvideoeditor/types/overlay-adaptors";
import { MediaSearchParams, MediaSearchResult, StandardVideo } from "@editor/reactvideoeditor/types/media-adaptors";

type TwelveLabsSearchResult = {
  start: number;
  end: number;
  videoId: string;
  clipUrl: string;
  thumbnail_url?: string | null;
  confidence?: number | null;
};

const FALLBACK_THUMB = "/search.gif";

/**
 * NOTE: The legacy proxy endpoints (/api/proxy-image, /api/proxy-video) are not
 * present in this codebase, which was causing 404s and broken previews.
 * We therefore return the direct URL. If a proxy is ever added, you can
 * re-introduce it here.
 */
const preferProxy = (url?: string | null) => {
  if (!url) return "";
  return url;
};

async function searchTwelveLabs(params: MediaSearchParams): Promise<MediaSearchResult<StandardVideo>> {
  const perPage = params.perPage || 24;
  const response = await fetch("/api/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: params.query,
      videoId: [], // server will fall back to full allowlist
      limit: perPage,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Twelve Labs search failed: ${response.status} ${message || ""}`);
  }

  const payload = await response.json();
  const results: TwelveLabsSearchResult[] = Array.isArray(payload?.results) ? payload.results.slice(0, perPage) : [];

  const items: StandardVideo[] = results.map((item, idx) => {
    const duration = Math.max(0, (item.end ?? 0) - (item.start ?? 0));
    const proxiedClip = preferProxy(item.clipUrl);
    const proxiedThumb = preferProxy(item.thumbnail_url || FALLBACK_THUMB);
    return {
      id: `${item.videoId || "tl"}-${item.start}-${item.end}-${idx}`,
      type: "video",
      width: 1920,
      height: 1080,
      thumbnail: proxiedThumb || FALLBACK_THUMB,
      duration,
      videoFiles: [
        {
          quality: "hd",
          format: "video/mp4",
          url: proxiedClip,
        },
      ],
      attribution: {
        author: "Twelve Labs",
        source: "Twelve Labs",
        url: item.clipUrl,
      },
    };
  });

  return {
    items,
    totalCount: items.length,
    hasMore: false,
  };
}

export const twelveLabsVideoAdaptor: VideoOverlayAdaptor = {
  name: "twelve-labs-clips",
  displayName: "Twelve Labs",
  description: "Search indexed Kill Bill clips via Twelve Labs",
  supportedTypes: ["video"],
  requiresAuth: false,
  async search(params: MediaSearchParams): Promise<MediaSearchResult<StandardVideo>> {
    return searchTwelveLabs(params);
  },
  getVideoUrl(video: StandardVideo) {
    return video.videoFiles[0]?.url || "";
  },
  getThumbnailUrl(video: StandardVideo) {
    return video.thumbnail || FALLBACK_THUMB;
  },
};
