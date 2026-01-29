"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import HLSVideoPlayer from "@/components/HLSVideoPlayer";
import { Search, Sparkles, Clock3, Film, FolderOpen, AlertCircle } from "lucide-react";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import { CloudinaryClipEditor } from "@/app/search/components/CloudinaryClipEditor";
import { DownloadProgressProvider } from "@/app/search/components/DownloadProgressProvider";
import { hasPreCachedClips, normalizeCloudinaryPublicId, getOptimalClipUrl } from "@/utils/cloudinary";
import { useAddDownloadedClip } from "../../../hooks/use-add-downloaded-clip";

type SearchHit = {
  id: string;
  videoId: string;
  start: number;
  end: number;
  thumbnail: string | null;
  confidence?: number | null;
  clipUrl?: string | null;
  indexId?: string | null;
  metadata?: unknown;
};

const trendingQueries = ["bride fights", "katana duel", "church fight", "crazy 88"];

const recentQueriesSeed = ["showdown", "whistle song", "nightclub hallway"];

const formatSeconds = (value: number) => {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
};

/**
 * Twelve Labs powered search panel – matches the video tab layout.
 * Uses the existing /api/textSearch quick mode to query the Twelve Labs index.
 */
export const SearchOverlayPanel: React.FC = () => {
  const [query, setQuery] = useState("");
  const [recentQueries, setRecentQueries] = useState(recentQueriesSeed);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [pageInfo, setPageInfo] = useState<{ total_results?: number } | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [playingMap, setPlayingMap] = useState<Record<string, boolean>>({});
  const [resolvedUrls, setResolvedUrls] = useState<
    Record<string, { hlsUrl: string | null; directUrl: string | null }>
  >({});
  const [modalItem, setModalItem] = useState<SearchHit | null>(null);
  const [modalResolved, setModalResolved] = useState<{ hlsUrl: string | null; directUrl: string | null } | null>(null);
  const [editItem, setEditItem] = useState<{ clip: SearchHit; detail?: any } | null>(null);
  const detailCache = useRef<Map<string, any>>(new Map());
  const addDownloadedClip = useAddDownloadedClip();

  const extractPublicIdFromUrl = useCallback((url?: string | null) => {
    if (!url) return null;
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      const uploadIdx = parts.findIndex((p) => p === "upload");
      const tail = uploadIdx >= 0 ? parts.slice(uploadIdx + 1) : parts;

      // Remove obvious Cloudinary transformation/version segments before the actual public_id.
      const cleanedSegments = tail.filter((segment) => {
        if (!segment) return false;
        if (/^v\d+$/i.test(segment)) return false; // version
        if (segment.includes(",")) return false; // transformation directives
        if (/^(so_|eo_|q_|f_|vc_|t_)/i.test(segment)) return false; // common transform prefixes
        return true;
      });

      const last = cleanedSegments[cleanedSegments.length - 1];
      if (!last) return null;

      const cleaned = last.replace(/\.(mp4|m3u8|mov|webm)$/i, "");
      return cleaned || null;
    } catch {
      // ignore
    }
    return null;
  }, []);
  const fetchRequestedRef = useRef<Set<string>>(new Set());

  const getSearchBase = () => {
    const windowOrigin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : null;

    // In production, prefer the current window origin so requests stay same-origin.
    if (windowOrigin) {
      try {
        const host = new URL(windowOrigin).hostname;
        if (!(host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0")) {
          return windowOrigin;
        }
      } catch {
        // fall through
      }
    }

    const envBases = [
      process.env.NEXT_PUBLIC_KB_SEARCH_API_BASE_URL,
      process.env.NEXT_PUBLIC_MAIN_APP_BASE_URL,
    ].filter(Boolean) as string[];

    // During local development, use window origin; otherwise fall back to env or blank.
    if (windowOrigin) {
      return windowOrigin;
    }

    return envBases[0] || "";
  };

  const normalizeHits = (payload: any, source: string): SearchHit[] => {
    const items = payload?.textSearchResults || payload?.searchData || [];
    return (items || []).map((item: any, idx: number) => {
      const videoDetail = item.videoDetail || item.video_detail || item.video || {};
      const hlsFromDetail =
        videoDetail?.hls?.video_url ||
        videoDetail?.hls?.videoUrl ||
        videoDetail?.hls?.playlist_url ||
        videoDetail?.hls?.playlistUrl ||
        null;
      const directFromDetail =
        videoDetail?.video_url ||
        videoDetail?.videoUrl ||
        videoDetail?.source_url ||
        videoDetail?.sourceUrl ||
        null;

      return {
        id:
          item.id ||
          `${item.video_id || item.videoId || "clip"}-${item.start ?? idx}-${idx}-${source}`,
        videoId: item.video_id || item.videoId || "unknown",
        start: Number(item.start) || 0,
        end: Number(item.end) || 0,
        thumbnail: item.thumbnail_url || item.thumbnailUrl || videoDetail?.thumbnail_url || null,
        confidence: item.confidence ?? item.score ?? null,
        clipUrl:
          item.clipUrl ||
          item.clip_url ||
          item.video_url ||
          item.videoUrl ||
          directFromDetail ||
          null,
        indexId: item.index_id || item.indexId || videoDetail?.index_id || null,
        metadata: item.metadata || item.videoDetail || videoDetail || {},
      };
    });
  };

  const runSearch = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setResults([]);
    setVisibleCount(10);
    setResolvedUrls({});
    setPlayingMap({});
    fetchRequestedRef.current = new Set();
    const base = getSearchBase().replace(/\/$/, "");
    const textSearchBase = (
      getSearchBase() ||
      process.env.NEXT_PUBLIC_MAIN_APP_BASE_URL ||
      process.env.NEXT_PUBLIC_KB_SEARCH_API_BASE_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");

    const tryFetch = async (
      endpoint: string,
      body: any,
      source: string,
      overrideBase?: string | null
    ) => {
      const chosenBase = overrideBase === undefined ? base : overrideBase;
      const isAbsolute = /^https?:\/\//i.test(endpoint);
      const url = isAbsolute ? endpoint : chosenBase ? `${chosenBase}${endpoint}` : endpoint;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(payload?.error || `Search failed at ${source}`);
      }
      return { payload, source };
    };

    try {
      let result:
        | { payload: any; source: string }
        | null = null;

      // 1) vendor kb-search (same-origin proxy to main app)
      try {
        result = await tryFetch("/api/kb-search", { textSearchQuery: trimmed, searchMode: "quick" }, "kb-search");
      } catch {
        // ignore and fallback
      }

      // 2) fallback: still go through kb-search to avoid CORS, but allow absolute base override
      if (!result) {
        result = await tryFetch(
          "/api/kb-search",
          { textSearchQuery: trimmed, searchMode: "quick" },
          "kb-search-fallback",
          base || textSearchBase
        );
      }

      const hits = normalizeHits(result.payload, result.source);

      setResults(hits);
      setVisibleCount(Math.min(hits.length, 10, 50));
      setPageInfo(result.payload?.pageInfo || { total_results: hits.length });
      setRecentQueries((prev) => {
        const next = [trimmed, ...prev.filter((item) => item !== trimmed)];
        return next.slice(0, 6);
      });
    } catch (err: any) {
      setError(err?.message || "Something went wrong while searching");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleQuickQuery = (value: string) => {
    setQuery(value);
    runSearch(value);
  };

  const pauseAllExcept = (id: string) => {
    Object.entries(videoRefs.current).forEach(([key, vid]) => {
      if (key !== id && vid && !vid.paused) {
        vid.pause();
      }
    });
  };

  const togglePlay = (id: string, resetToStart = false) => {
    const video = videoRefs.current[id];
    if (!video) return;
    if (video.paused) {
      pauseAllExcept(id);
      if (resetToStart) {
        video.currentTime = 0;
      }
      void video.play();
      setExclusivePlaying(id);
    } else {
      video.pause();
      setExclusivePlaying(null);
    }
  };

  const markPlaying = (id: string, isPlaying: boolean) => {
    setPlayingMap((prev) => ({ ...prev, [id]: isPlaying }));
  };

  const setExclusivePlaying = (id: string | null) => {
    setPlayingMap((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((key) => {
        next[key] = false;
      });
      if (id) next[id] = true;
      return next;
    });
  };

  const triggerPlay = (id: string, start?: number) => {
    setExclusivePlaying(id);
    const video = videoRefs.current[id];
    if (video) {
      video.muted = false;
      if (typeof start === "number" && start > 0) {
        video.currentTime = Math.max(0, start);
      }
      void video.play().catch(() => {
        // ignore autoplay failures; user can click to play
      });
    } else {
      // HLS component is controlled via playingMap
      setPlayingMap((prev) => ({ ...prev, [id]: true }));
    }
  };

  const seekToStart = (id: string, start?: number) => {
    const video = videoRefs.current[id];
    if (!video) return;
    if (typeof start === "number" && start > 0) {
      const target = Math.max(0, start);
      if (Math.abs(video.currentTime - target) > 0.25) {
        video.currentTime = target;
      }
    }
  };

  const loadMore = () => {
    setVisibleCount((current) => {
      const next = current + 10;
      return Math.min(next, 50);
    });
  };

  const openModal = (item: SearchHit) => {
    const resolved = resolvedUrls[item.id];
    setModalItem(item);
    setModalResolved({
      hlsUrl: resolved?.hlsUrl || null,
      directUrl: resolved?.directUrl || item.clipUrl || null,
    });
    setExclusivePlaying(null);
    pauseAllExcept("");
  };

  const closeModal = () => {
    setModalItem(null);
    setModalResolved(null);
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (results.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      { root: null, rootMargin: "200px 0px 200px 0px", threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [results.length]);

  // Resolve playable URLs similar to /search page, with multi-endpoint fallback
  useEffect(() => {
    const resolveForItem = async (item: SearchHit) => {
      if (resolvedUrls[item.id] !== undefined) return;
      if (fetchRequestedRef.current.has(item.id)) return;
      fetchRequestedRef.current.add(item.id);

      // 1) metadata-derived URLs (matches /search)
      const meta: any = item.metadata || {};
      const metaHls =
        meta?.hls?.video_url ||
        meta?.hls?.videoUrl ||
        meta?.hls?.playlist_url ||
        meta?.hls?.playlistUrl ||
        meta?.videoDetail?.hls?.video_url ||
        meta?.videoDetail?.hls?.videoUrl ||
        meta?.videoDetail?.hls?.playlist_url ||
        meta?.videoDetail?.hls?.playlistUrl ||
        null;
      const metaDirectRaw =
        meta?.video_url ||
        meta?.videoUrl ||
        meta?.source_url ||
        meta?.sourceUrl ||
        (Array.isArray(meta?.urls) && meta.urls.length > 0 ? meta.urls[0] : null) ||
        meta?.videoDetail?.video_url ||
        meta?.videoDetail?.videoUrl ||
        meta?.videoDetail?.source_url ||
        meta?.videoDetail?.sourceUrl ||
        (Array.isArray(meta?.videoDetail?.urls) && meta.videoDetail.urls.length > 0
          ? meta.videoDetail.urls[0]
          : null) ||
        null;
      const metaDirect =
        typeof metaDirectRaw === "string" && metaDirectRaw.includes(".m3u8") ? null : metaDirectRaw;
      const metaHlsFromDirect =
        typeof metaDirectRaw === "string" && metaDirectRaw.includes(".m3u8") ? metaDirectRaw : null;

      if (metaHls || metaDirect || item.clipUrl) {
        setResolvedUrls((prev) => ({
          ...prev,
          [item.id]: {
            hlsUrl: metaHls || metaHlsFromDirect || null,
            directUrl: metaDirect || item.clipUrl || null,
          },
        }));
        return;
      }

      if (!item.videoId) {
        setResolvedUrls((prev) => ({
          ...prev,
          [item.id]: { hlsUrl: null, directUrl: null },
        }));
        return;
      }

      // 2) proxy fetches (local vendor, then root/base app)
      const baseCandidates = [""];
      const envBase =
        process.env.NEXT_PUBLIC_MAIN_APP_BASE_URL ||
        process.env.NEXT_PUBLIC_KB_SEARCH_API_BASE_URL ||
        process.env.NEXT_PUBLIC_TWELVELABS_API_URL ||
        "";
      if (envBase) baseCandidates.push(envBase.replace(/\/$/, ""));
      if (typeof window !== "undefined" && window.location?.origin) {
        baseCandidates.push(window.location.origin.replace(/\/$/, ""));
      }

      const query = new URLSearchParams();
      query.set("videoId", item.videoId);
      if (item.indexId) query.set("indexId", item.indexId);

      for (const base of baseCandidates) {
        try {
          const endpoint = base ? `${base}/api/getVideo?${query.toString()}` : `/api/getVideo?${query.toString()}`;
          const res = await fetch(endpoint);
          const text = await res.text();
          const data = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;

          if (!res.ok) {
            continue;
          }

          const hls =
            data?.hls?.video_url ||
            data?.hls?.videoUrl ||
            data?.hls?.playlist_url ||
            data?.hls?.playlistUrl ||
            null;
          const directRaw =
            data?.video_url ||
            data?.videoUrl ||
            data?.source_url ||
            data?.sourceUrl ||
            data?.url ||
            (Array.isArray(data?.urls) && data.urls.length > 0 ? data.urls[0] : null) ||
            null;
          const direct =
            typeof directRaw === "string" && directRaw.includes(".m3u8") ? null : directRaw;
          const hlsFromDirect =
            typeof directRaw === "string" && directRaw.includes(".m3u8") ? directRaw : null;

          setResolvedUrls((prev) => ({
            ...prev,
            [item.id]: {
              hlsUrl: hls || hlsFromDirect || null,
              directUrl: direct || item.clipUrl || null,
            },
          }));
          return;
        } catch (err) {
          // try next candidate
        }
      }

      // Final fallback: none found
      setResolvedUrls((prev) => ({
        ...prev,
        [item.id]: { hlsUrl: null, directUrl: null },
      }));
    };

    const targetList = results.slice(0, Math.min(visibleCount, 50));
    targetList.forEach((item) => {
      void resolveForItem(item);
    });
  }, [results, resolvedUrls, visibleCount]);

  // Update modal resolved URLs if they become available after opening.
  useEffect(() => {
    if (!modalItem) return;
    const resolved = resolvedUrls[modalItem.id];
    if (!resolved) return;
    setModalResolved({
      hlsUrl: resolved.hlsUrl,
      directUrl: resolved.directUrl || modalItem.clipUrl || null,
    });
  }, [modalItem, resolvedUrls]);

  const fetchVideoDetail = useCallback(async (videoId?: string | null) => {
    if (!videoId) return null;
    const cached = detailCache.current.get(videoId);
    if (cached) return cached;
    try {
      const res = await fetch(`/api/getVideo?videoId=${encodeURIComponent(videoId)}`);
      if (!res.ok) return null;
      const data = await res.json();
      detailCache.current.set(videoId, data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const resolvePublicId = useCallback(
    (clip: SearchHit, detail?: any) => {
      const systemMeta =
        detail?.system_metadata ||
        detail?.metadata?.system_metadata ||
        detail?.videoDetail?.system_metadata ||
        clip.metadata?.system_metadata ||
        null;
      const meta = detail?.metadata || detail || clip.metadata || {};
      const videoMeta = detail?.video || detail?.videoDetail || meta?.video || {};
      const nestedVideoMeta =
        meta?.videoDetail?.system_metadata ||
        meta?.videoDetail ||
        meta?.video_detail ||
        {};

      const rawCandidates: Array<string | null | undefined> = [
        systemMeta?.filename,
        systemMeta?.public_id,
        systemMeta?.cloudinaryVideoId,
        systemMeta?.cloudinary_video_id,
        systemMeta?.video_id,
        meta?.filename,
        meta?.public_id,
        meta?.cloudinaryVideoId,
        meta?.cloudinary_video_id,
        meta?.video_id,
        videoMeta?.filename,
        videoMeta?.cloudinaryVideoId,
        videoMeta?.cloudinary_video_id,
        videoMeta?.video_id,
        (nestedVideoMeta as any)?.filename,
        (nestedVideoMeta as any)?.public_id,
        (nestedVideoMeta as any)?.cloudinaryVideoId,
        (nestedVideoMeta as any)?.cloudinary_video_id,
        (nestedVideoMeta as any)?.video_id,
        clip?.videoId,
        clip?.id,
      ];

      const urlCandidates = [clip?.clipUrl, meta?.clip_url, meta?.video_url, meta?.source_url]
        .map((candidateUrl) => extractPublicIdFromUrl(candidateUrl))
        .filter(Boolean) as string[];

      const normalizedCandidates = [...rawCandidates, ...urlCandidates]
        .filter((val): val is string => typeof val === "string" && val.trim().length > 0)
        .map((val) => normalizeCloudinaryPublicId(val));

      const preCached = normalizedCandidates.find((id) => hasPreCachedClips(id));
      if (preCached) return preCached;

      return normalizedCandidates[0] || null;
    },
    [extractPublicIdFromUrl]
  );

  return (
    <div className="space-y-4 pb-3">
      <Card className="border-border/80 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
            <Sparkles className="h-4 w-4" />
            <span>Smart search</span>
          </div>
          <CardTitle className="text-base font-semibold text-foreground">Find the perfect clip</CardTitle>
          <CardDescription className="text-xs">
            Type a query, press enter, or hit search. Results come straight from the Twelve Labs Kill Bill index.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="flex-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search scenes, dialogue, actions..."
                className="h-10"
                aria-label="Search media"
              />
            </div>
            <Button type="submit" className="h-10 px-4" variant="default">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </form>

          <div className="flex flex-wrap gap-2">
            {trendingQueries.map((item) => (
              <Button
                key={item}
                variant="outline"
                size="sm"
                className="border-dashed"
                onClick={() => handleQuickQuery(item)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                {item}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {modalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative w-full max-w-4xl rounded-lg border border-border bg-card shadow-2xl">
            <button
              type="button"
              onClick={closeModal}
              className="absolute right-3 top-3 rounded-full bg-black/40 px-3 py-1 text-xs text-white hover:bg-black/60"
            >
              Close
            </button>
            <div className="p-4 space-y-3">
              <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Film className="h-4 w-4 text-primary" />
                {modalItem.videoId} ({formatSeconds(modalItem.start)} - {formatSeconds(modalItem.end)})
              </div>
              <div className="relative w-full">
                {(() => {
                  const resolved = modalResolved || { hlsUrl: null, directUrl: null };
                  const hlsUrl = resolved.hlsUrl || null;
                  const directUrl = resolved.directUrl || null;
                  const directLooksHls =
                    typeof directUrl === "string" && directUrl.includes(".m3u8") ? directUrl : null;
                  const hlsSource = hlsUrl || directLooksHls || null;
                  const effectiveHls = hlsSource
                    ? `/api/media-proxy?url=${encodeURIComponent(hlsSource)}`
                    : null;
                  const playableDirect =
                    directUrl && !directLooksHls
                      ? `/api/media-proxy?url=${encodeURIComponent(directUrl)}`
                      : null;

                  if (effectiveHls) {
                    return (
                      <div className="w-full aspect-video relative rounded-md overflow-hidden border border-border/60 bg-black">
                        <HLSVideoPlayer
                          hlsUrl={effectiveHls}
                          thumbnailUrl={modalItem.thumbnail || undefined}
                          startTime={modalItem.start}
                          endTime={modalItem.end}
                          isPlaying
                          muted={false}
                          onPlay={() => setExclusivePlaying(modalItem.id)}
                          onPause={() => setExclusivePlaying(null)}
                          onEnded={() => setExclusivePlaying(null)}
                        />
                      </div>
                    );
                  }

                  if (playableDirect) {
                    return (
                      <div className="w-full aspect-video relative rounded-md overflow-hidden border border-border/60 bg-black">
                        <video
                          src={playableDirect}
                          poster={modalItem.thumbnail || undefined}
                          className="h-full w-full object-cover"
                          controls
                          preload="metadata"
                          playsInline
                          onLoadedMetadata={(e) => {
                            if (modalItem.start > 0 && Math.abs(e.currentTarget.currentTime - modalItem.start) > 0.5) {
                              e.currentTarget.currentTime = modalItem.start;
                            }
                          }}
                        />
                      </div>
                    );
                  }

                  return (
                    <div className="w-full aspect-video flex items-center justify-center rounded-md border border-border/60 bg-muted/20 text-sm text-muted-foreground">
                      No playable source found for this clip.
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>
                    {formatSeconds(modalItem.start)} → {formatSeconds(modalItem.end)}
                  </span>
                </div>
                <span className="text-foreground/80">Twelve Labs</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="py-3 flex items-center gap-3 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card className="border-border/70 bg-card/70">
          <CardContent className="py-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Search className="h-4 w-4 animate-pulse" />
            <span className="text-sm">Searching Twelve Labs…</span>
          </CardContent>
        </Card>
      )}

      {!isLoading && results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span>
              Showing {Math.min(visibleCount, results.length, 50)} of{" "}
              {Math.min(results.length, 50)} clip{results.length === 1 ? "" : "s"}
            </span>
            {pageInfo?.total_results !== undefined && (
              <span>{pageInfo.total_results} total matches</span>
            )}
          </div>
          <div className="space-y-3">
            {results.slice(0, Math.min(visibleCount, 50)).map((item) => {
              const resolved = resolvedUrls[item.id];
              const hlsUrl = resolved?.hlsUrl || null;
              const directUrl = resolved?.directUrl || item.clipUrl || null;
              const directLooksHls =
                typeof directUrl === "string" && directUrl.includes(".m3u8") ? directUrl : null;
              const hlsSource = hlsUrl || directLooksHls || null;
              const effectiveHls = hlsSource
                ? `/api/media-proxy?url=${encodeURIComponent(hlsSource)}`
                : null;
              const playableDirect =
                directUrl && !directLooksHls
                  ? `/api/media-proxy?url=${encodeURIComponent(directUrl)}`
                  : null;
              const hasPlayable = !!effectiveHls || !!playableDirect;

              return (
                <Card
                  key={item.id}
                  className="border-border/70 bg-card/70 shadow-sm transition hover:border-primary/60 hover:shadow-md"
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Film className="h-4 w-4 text-primary" />
                      {item.videoId}
                    </CardTitle>
                    <CardDescription className="text-xs flex items-center gap-2 text-muted-foreground">
                      <FolderOpen className="h-3.5 w-3.5" />
                      {formatSeconds(item.start)} - {formatSeconds(item.end)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="relative overflow-hidden rounded-md border border-border/60 bg-card/80">
                      <button
                        type="button"
                        onClick={() => openModal(item)}
                        disabled={!hasPlayable}
                        className="group block w-full text-left"
                        aria-label="Open clip preview"
                      >
                        <div className="w-full aspect-video relative">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt={`Preview for ${item.videoId}`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs bg-muted/20">
                              No preview available
                            </div>
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/35 group-hover:bg-black/45 transition-colors">
                            <span className="h-14 w-14 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg opacity-90 group-hover:scale-105 transition-transform">
                              <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </span>
                          </div>
                          {!hasPlayable && (
                            <div className="absolute inset-0 flex items-center justify-center text-white text-xs bg-black/40">
                              No playable source resolved
                            </div>
                          )}
                        </div>
                      </button>
                      {item.confidence !== null && item.confidence !== undefined && (
                        <div className="absolute right-2 top-2 rounded-full bg-background/80 px-2 py-1 text-[10px] font-medium text-foreground border border-border/80">
                          {(item.confidence * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground space-y-1 break-all">
                      <div className="font-medium text-foreground">Source attempt</div>
                      <div>
                        {hlsSource
                          ? `HLS (proxied): ${hlsSource}`
                          : playableDirect
                          ? `Direct (proxied): ${directUrl}`
                          : "No playable source resolved"}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>
                          {formatSeconds(item.start)} → {formatSeconds(item.end)}
                        </span>
                      </div>
                      <span className="text-foreground/80">Twelve Labs</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={() => openModal(item)}
                        disabled={!hasPlayable}
                      >
                        Play preview
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                onClick={async () => {
                  const detail = await fetchVideoDetail(item.videoId);
                  setEditItem({ clip: item, detail: detail ?? undefined });
                }}
                        disabled={!hasPlayable && !directUrl}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        asChild
                        className="flex-1"
                        disabled={!item.clipUrl}
                      >
                        <a href={item.clipUrl || "#"} target="_blank" rel="noreferrer">
                          Open clip
                        </a>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setQuery(item.videoId)}>
                        Copy ID
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {visibleCount < Math.min(results.length, 50) && (
              <div
                ref={sentinelRef}
                className="flex items-center justify-center py-3 text-xs text-muted-foreground"
              >
                Scroll to load more…
              </div>
            )}
          </div>
        </div>
      )}

      {!isLoading && hasSearched && results.length === 0 && !error && (
        <Card className="border-dashed border-border/70 bg-card/60">
          <CardContent className="py-10 text-center space-y-2">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">No matches yet</p>
            <p className="text-xs text-muted-foreground">
              Try broader keywords or pick a trending search above.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5" />
            Recent searches
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-1">
          {recentQueries.map((item) => (
            <Button
              key={item}
              variant="ghost"
              size="sm"
              className="border border-transparent hover:border-border"
              onClick={() => handleQuickQuery(item)}
            >
              {item}
            </Button>
          ))}
        </CardContent>
      </Card>

      {editItem && (() => {
        const publicId = resolvePublicId(editItem.clip, editItem.detail);
        const normalized = publicId ? normalizeCloudinaryPublicId(publicId) : null;
        const hasStartEnd = typeof editItem.clip.start === "number" && typeof editItem.clip.end === "number";
        const optimal =
          normalized && hasStartEnd
            ? getOptimalClipUrl(normalized, editItem.clip.start, editItem.clip.end)
            : null;
        const playbackOverride = optimal?.url || null;
        const previewStartOverride = optimal?.previewStart ?? null;
        const previewEndOverride = optimal?.previewEnd ?? null;
        const thumbnail =
          editItem.clip.thumbnail ||
          editItem.detail?.thumbnail_url ||
          editItem.detail?.hls?.thumbnail_url ||
          null;

        return (
          <DownloadProgressProvider>
            <CloudinaryClipEditor
              open
              onClose={() => setEditItem(null)}
              thumbnail={thumbnail}
              publicId={publicId}
              mp4Url={
                publicId
                  ? undefined
                  : resolvedUrls[editItem.clip.id]?.directUrl || editItem.clip.clipUrl || undefined
              }
              hlsUrl={editItem.detail?.hls?.video_url || resolvedUrls[editItem.clip.id]?.hlsUrl || undefined}
              start={editItem.clip.start}
              end={editItem.clip.end}
              videoDuration={
                editItem.detail?.system_metadata?.duration ||
                editItem.detail?.duration ||
                Math.max(0, (editItem.clip.end ?? 0) - (editItem.clip.start ?? 0))
              }
              portalSelector="#player-shell"
              playbackUrlOverride={playbackOverride}
              previewStartOverride={previewStartOverride}
              previewEndOverride={previewEndOverride}
              onAddToTimeline={(payload) => {
                addDownloadedClip({
                  ...payload,
                  thumbnail: payload.thumbnail || thumbnail || undefined,
                  cloudinaryPublicId: payload.cloudinaryPublicId || normalized || undefined,
                  mainCloudinaryPublicId: payload.mainCloudinaryPublicId || normalized || undefined,
                });
                setEditItem(null);
              }}
            />
          </DownloadProgressProvider>
        );
      })()}
    </div>
  );
};
