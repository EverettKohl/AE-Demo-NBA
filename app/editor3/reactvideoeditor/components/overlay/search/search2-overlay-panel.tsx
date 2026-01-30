"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Play, Plus, Search as SearchIcon } from "lucide-react";

import { CloudinaryClipEditor } from "@/app/search/components/CloudinaryClipEditor";
import { DownloadProgressProvider } from "@/app/search/components/DownloadProgressProvider";
import HlsClipPlayer from "@/app/search/components/HlsClipPlayer";
import { formatSeconds } from "@/app/search/utils/time";
import { getClipDownloadUrl, normalizeCloudinaryPublicId } from "@/utils/cloudinary";
import { getClipDownloadManager } from "@/app/editor3/clipDownloadManager";
import { useAddDownloadedClip } from "../../../hooks/use-add-downloaded-clip";

type ClipResult = {
  id: string;
  start: number;
  end: number;
  clipUrl: string | null;
  thumbnail: string | null;
  videoId: string | null;
  confidence: number | null;
  hlsUrl?: string | null;
  videoDetail?: any;
  cloudinaryVideoId?: string | null;
  title?: string;
};

const formatId = (item: any, index: number, start: number, end: number) => {
  const videoId = item.videoId || item.video_id;
  return item.id || `${videoId || "clip"}-${start}-${end}-${index}`;
};

const normalizeResults = (payload: any): ClipResult[] => {
  const items =
    (Array.isArray(payload?.results) && payload.results) ||
    (Array.isArray(payload?.searchData) && payload.searchData) ||
    (Array.isArray(payload?.textSearchResults) && payload.textSearchResults) ||
    [];

  return items.map((item, index) => {
    const start = Number(item.start ?? 0);
    const end = Number(item.end ?? start + 5);

    let confidence: number | null = null;
    if (typeof item.confidence === "number") {
      confidence = item.confidence;
    } else if (item.confidence !== undefined) {
      const numeric = Number(item.confidence);
      confidence = Number.isFinite(numeric) ? numeric : null;
    }

    return {
      id: formatId(item, index, start, end),
      start,
      end,
      videoId: item.videoId || item.video_id || null,
      clipUrl:
        item.clipUrl ||
        item.clip_url ||
        item.video_url ||
        item.videoUrl ||
        item.playback_urls?.mp4 ||
        item.playback_urls?.video ||
        null,
      hlsUrl:
        item.hlsUrl ||
        item.hls_url ||
        item.playlist_url ||
        item.playback_urls?.hls ||
        null,
      thumbnail: item.thumbnail_url || item.thumbnailUrl || item.thumbnail || null,
      confidence,
      videoDetail: item.videoDetail || item.video_detail || item.video || undefined,
      cloudinaryVideoId: item.cloudinaryVideoId || item.cloudinary_video_id || null,
      title: item.title || item.video_title || item.name || null,
    };
  });
};

type Mp4PlayerProps = {
  src: string;
  poster?: string | null;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
};

const Mp4Player = ({ src, poster, playing, onPlay, onPause, onEnded }: Mp4PlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      onPlay();
      video.play().catch(() => {});
    } else {
      video.pause();
      onPause();
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTime = () => setCurrent(video.currentTime || 0);
    const handleMeta = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : null);
      setCurrent(video.currentTime || 0);
    };
    video.addEventListener("timeupdate", handleTime);
    video.addEventListener("loadedmetadata", handleMeta);
    video.addEventListener("durationchange", handleMeta);
    return () => {
      video.removeEventListener("timeupdate", handleTime);
      video.removeEventListener("loadedmetadata", handleMeta);
      video.removeEventListener("durationchange", handleMeta);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        className="h-full w-full object-cover z-0"
        src={src}
        poster={poster || undefined}
        playsInline
        autoPlay={playing}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
      />
      <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium text-white">
        {formatSeconds(current)} / {formatSeconds(duration ?? 0)}
      </div>
    </div>
  );
};

export const Search2OverlayPanel: React.FC = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClipResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedCloudinary, setSelectedCloudinary] = useState<{ clip: ClipResult; detail?: any } | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const cloudName = useMemo(() => process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || null, []);
  const addDownloadedClip = useAddDownloadedClip();

  const summary = useMemo(() => {
    if (!results.length) return null;
    return `${results.length} clip${results.length === 1 ? "" : "s"} found`;
  }, [results]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Enter a search term.");
      return;
    }

    setLoading(true);
    setError(null);
    setPlayingId(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, limit: 12 }),
      });
      if (!res.ok) throw new Error("Search failed. Please try again.");
      const data = await res.json();
      const normalized = normalizeResults(data);
      setResults(normalized);
      if (!normalized.length) {
        setError("No results found.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed. Please try again.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchVideoDetail = useCallback(async (clip: ClipResult) => {
    const videoId = clip.videoId;
    if (!videoId) return null;
    const res = await fetch(`/api/getVideo?videoId=${encodeURIComponent(videoId)}`);
    if (!res.ok) return null;
    return res.json();
  }, []);

  const handleEditCloudinary = async (clip: ClipResult) => {
    setError(null);
    let detail = clip.videoDetail;
    if (!detail) {
      detail = await fetchVideoDetail(clip);
    }
    setSelectedCloudinary({ clip, detail });
  };

  const handleAddToTimeline = async (clip: ClipResult) => {
    const id = clip.id || clip.videoId || "clip";
    const start = Math.max(0, clip.start ?? 0);
    const end = Math.max(start + 0.1, clip.end ?? start + 5);
    const filename = `${clip.videoId || clip.cloudinaryVideoId || "clip"}_${Math.floor(start)}-${Math.floor(end)}.mp4`;
    const downloadId = `${id}-add-${Date.now()}`;
    const mgr = getClipDownloadManager();
    setAddingId(id);
    setError(null);

    try {
      let rawId =
        clip.videoDetail?.system_metadata?.filename ||
        clip.videoDetail?.cloudinaryVideoId ||
        clip.cloudinaryVideoId ||
        null;
      let detail = clip.videoDetail;
      if (!rawId) {
        detail = await fetchVideoDetail(clip);
        rawId =
          detail?.system_metadata?.filename ||
          detail?.cloudinaryVideoId ||
          clip.cloudinaryVideoId ||
          null;
      }
      const publicId = rawId ? normalizeCloudinaryPublicId(rawId) : null;
      if (!publicId) {
        throw new Error("Cloudinary id unavailable for this clip.");
      }

      const url = getClipDownloadUrl(publicId, start, end, { maxDuration: 180 });
      const { objectUrl } = await mgr.download(downloadId, url);

      await addDownloadedClip({
        blobUrl: objectUrl,
        durationSeconds: Math.max(0.1, end - start),
        startSeconds: start,
        endSeconds: end,
        cloudinaryPublicId: publicId || undefined,
        mainCloudinaryPublicId: publicId || undefined,
        thumbnail: clip.thumbnail || detail?.hls?.thumbnail_url || undefined,
        filename,
      });

      // free the temp blob after ingest
      mgr.revoke(downloadId);
    } catch (err: any) {
      setError(err?.message || "Failed to add clip to timeline.");
    } finally {
      setAddingId(null);
    }
  };

  const renderCard = (clip: ClipResult, idx: number) => {
    const id = clip.id || `${clip.videoId || "clip"}-${idx}`;
    const start = Math.max(0, clip.start ?? 0);
    const end = Math.max(start + 0.1, clip.end ?? start + 5);
    const hlsUrl = clip.hlsUrl || clip.videoDetail?.hls?.video_url || clip.videoDetail?.hls?.playlist_url || null;
    const mp4Url =
      clip.clipUrl ||
      clip.videoDetail?.video_url ||
      clip.videoDetail?.url ||
      clip.videoDetail?.source_url ||
      null;
    const thumbnail = clip.thumbnail || clip.videoDetail?.thumbnail_url || clip.videoDetail?.hls?.thumbnail_url || "/search.gif";
    const title =
      clip.title ||
      clip.videoDetail?.system_metadata?.video_title ||
      clip.videoDetail?.system_metadata?.filename ||
      "Video Clip";
    const isPlaying = playingId === id;

    return (
      <div
        key={id}
        className="rounded-lg border border-gray-800 bg-gray-950/80 shadow-sm transition hover:-translate-y-px hover:shadow-lg"
      >
        <div className="aspect-video w-full overflow-hidden bg-black">
          {hlsUrl ? (
            <HlsClipPlayer
              hlsUrl={hlsUrl}
              mp4Url={mp4Url || undefined}
              poster={thumbnail}
              startTime={start}
              playing={isPlaying}
              muted={false}
              onRequestPlay={() => setPlayingId(id)}
              onPlay={() => setPlayingId(id)}
              onPause={() => setPlayingId((current) => (current === id ? null : current))}
              onEnded={() => setPlayingId(null)}
            />
          ) : mp4Url ? (
            <Mp4Player
              src={mp4Url}
              poster={thumbnail}
              playing={isPlaying}
              onPlay={() => setPlayingId(id)}
              onPause={() => setPlayingId((current) => (current === id ? null : current))}
              onEnded={() => setPlayingId(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gray-900 text-xs text-slate-400">
              No playable source
            </div>
          )}
        </div>
        <div className="space-y-2 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white" title={title}>
                {title}
              </p>
              <p className="text-[11px] text-slate-400">
                {formatSeconds(start)} – {formatSeconds(end)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleEditCloudinary(clip)}
              disabled={!cloudName && !clip.clipUrl}
              title={!cloudName && !clip.clipUrl ? "Cloudinary info unavailable" : "Edit clip"}
              className={clsx(
                "rounded-md px-3 py-1 text-[11px] font-semibold text-white transition",
                "bg-indigo-600 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              Edit
            </button>
            <button
              onClick={() => handleAddToTimeline(clip)}
              disabled={addingId === id}
              title="Add this clip to the timeline"
              className={clsx(
                "inline-flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-semibold text-white transition",
                "bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              {addingId === id ? "Adding…" : "Add"}
            </button>
            <button
              onClick={async () => {
                let rawId =
                  clip.videoDetail?.system_metadata?.filename ||
                  clip.videoDetail?.cloudinaryVideoId ||
                  clip.cloudinaryVideoId ||
                  null;
                let detail = clip.videoDetail;
                if (!rawId) {
                  detail = await fetchVideoDetail(clip);
                  rawId =
                    detail?.system_metadata?.filename ||
                    detail?.cloudinaryVideoId ||
                    clip.cloudinaryVideoId ||
                    null;
                }
                if (!rawId || typeof clip.start !== "number" || typeof clip.end !== "number") {
                  alert("Cloudinary download is unavailable for this clip.");
                  return;
                }
                const publicId = normalizeCloudinaryPublicId(rawId);
                try {
                  const url = getClipDownloadUrl(publicId, clip.start, clip.end, { maxDuration: 180 });
                  const res = await fetch(url);
                  if (!res.ok) throw new Error(`Download failed (${res.status})`);
                  const blob = await res.blob();
                  const fname = `${publicId}_${Math.floor(clip.start)}s-${Math.floor(clip.end)}s.mp4`;
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = fname;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(a.href), 500);
                } catch (err: any) {
                  alert(err?.message || "Download failed");
                }
              }}
              disabled={!cloudName || typeof clip.start !== "number" || typeof clip.end !== "number"}
              title="Download this clip range directly"
              className={clsx(
                "rounded-md px-3 py-1 text-[11px] font-semibold text-white transition",
                "bg-slate-700 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              Download
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <DownloadProgressProvider>
      <div className="flex h-full flex-col gap-3 text-white">
        <header className="space-y-1">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-indigo-300">
            <Play className="h-3.5 w-3.5" />
            Search2
          </p>
          <div className="flex items-center gap-2">
            <SearchIcon className="h-4 w-4 text-slate-300" />
            <h2 className="text-lg font-semibold leading-tight">Find Kill Bill moments</h2>
          </div>
          <p className="text-sm text-slate-400">
            Same search as the main page, sized for the sidebar.
          </p>
        </header>

        <form onSubmit={handleSearch} className="flex flex-col gap-2 rounded-xl border border-gray-800 bg-gray-950/80 p-3">
          <label className="text-xs text-slate-300">
            Query
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., katana fight in the snow"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:ring-indigo-600"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Searching…" : "Search"}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setError(null);
              }}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-gray-800"
            >
              Clear
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {summary && <div className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-slate-300">{summary}</div>}
        </form>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {loading && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-4 text-center text-slate-300">
              Searching videos…
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-center text-slate-400">
              Start typing to see search results. Download links will appear on each generated clip.
            </div>
          )}

          {!loading && results.length > 0 && <div className="space-y-3">{results.map(renderCard)}</div>}
        </div>
      </div>

      {selectedCloudinary && (
        <CloudinaryClipEditor
          open
          onClose={() => setSelectedCloudinary(null)}
          publicId={
            selectedCloudinary.clip.videoDetail?.system_metadata?.filename ||
            selectedCloudinary.detail?.system_metadata?.filename ||
            selectedCloudinary.clip.videoDetail?.cloudinaryVideoId ||
            null
          }
          mp4Url={selectedCloudinary.clip.clipUrl}
          hlsUrl={selectedCloudinary.detail?.hls?.video_url}
          start={Math.max(0, selectedCloudinary.clip.start ?? 0)}
          end={Math.max(Math.max(0, selectedCloudinary.clip.start ?? 0) + 0.1, selectedCloudinary.clip.end ?? 5)}
          videoDuration={selectedCloudinary.detail?.system_metadata?.duration || selectedCloudinary.detail?.duration || null}
        />
      )}
    </DownloadProgressProvider>
  );
};
