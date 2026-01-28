import { MediaSearchParams, MediaSearchResult, StandardVideo } from "@editor/reactvideoeditor/types/media-adaptors";
import { VideoOverlayAdaptor } from "@editor/reactvideoeditor/types/overlay-adaptors";

const buildUrl = (params: MediaSearchParams, cursor?: string | null) => {
  const search = new URLSearchParams();
  if (params.query) search.set("q", params.query);
  if (params.perPage) search.set("perPage", String(params.perPage));
  if (cursor) search.set("cursor", cursor);
  return `/api/editor/cloudinary/search?${search.toString()}`;
};

export const cloudinaryVideoAdaptor = {
  name: "cloudinary",
  displayName: "Cloudinary",
  description: "Browse videos from your Cloudinary account",
  supportedTypes: ["video"],
  requiresAuth: false,
  async upload(file: File): Promise<StandardVideo> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/editor/cloudinary/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.error || "Cloudinary upload failed");
    }

    const payload = await res.json();
    const url = payload.serverPath || payload.secureUrl || payload.url || "";

    return {
      id: payload.id || url,
      type: "video",
      width: payload.width || 0,
      height: payload.height || 0,
      duration: payload.duration || 0,
      thumbnail: payload.thumbnail || url,
      videoFiles: [
        {
          quality: "hd",
          format: file.type || "video/mp4",
          url,
        },
      ],
      attribution: {
        author: "Cloudinary",
        source: "Cloudinary",
        license: "cloudinary",
        url,
      },
    };
  },
  async search(params: MediaSearchParams, config?: Record<string, any>): Promise<MediaSearchResult<StandardVideo>> {
    const cursor = config?.cursor || params.page;
    const url = buildUrl(params, cursor ? String(cursor) : undefined);
    const res = await fetch(url);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.error || "Cloudinary search failed");
    }
    const payload = await res.json();
    return {
      items: payload.items || [],
      totalCount: payload.totalCount || 0,
      hasMore: Boolean(payload.nextCursor),
      nextPage: payload.nextCursor || null,
    };
  },
  getVideoUrl(video: StandardVideo, quality: "uhd" | "hd" | "sd" | "low" = "hd"): string {
    const preferred = video.videoFiles.find((file) => file.quality === quality);
    return preferred?.url || video.videoFiles[0]?.url || "";
  },
  getThumbnailUrl(video: StandardVideo): string {
    return video.thumbnail;
  },
} satisfies VideoOverlayAdaptor & {
  upload: (file: File) => Promise<StandardVideo>;
};
