import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HlsClipPlayer from "@/app/search/components/HlsClipPlayer";
import { DownloadProgressProvider } from "@/app/search/components/DownloadProgressProvider";
import { CloudinaryClipEditor } from "@/app/search/components/CloudinaryClipEditor";
import { getClipDownloadUrl, normalizeCloudinaryPublicId } from "@/utils/cloudinary";
import { formatSeconds } from "@/app/search/utils/time";
import { useEditorContext } from "../../../contexts/editor-context";
import { useAddDownloadedClip } from "../../../hooks/use-add-downloaded-clip";
import { ClipOverlay, Overlay, OverlayType } from "../../../types";
import { useVideoReplacement } from "../../../hooks/use-video-replacement";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { useDownloadProgress } from "@/app/search/components/DownloadProgressProvider";
import { AlertCircle, Clock, Play, Search, Sparkles } from "lucide-react";
import { VideoDetails } from "./video-details";
import { getClipDownloadManager } from "../../../../clipDownloadManager";

type SearchClip = {
  id: string;
  start: number;
  end: number;
  thumbnail?: string | null;
  clipUrl?: string | null;
  hlsUrl?: string | null;
  playback_urls?: any;
  videoId?: string | null;
  videoDetail?: any;
  title?: string | null;
  cloudinaryVideoId?: string | null;
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
    const handleTime = () => {
      setCurrent(video.currentTime || 0);
    };
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
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
      <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">
        {formatSeconds(current)} / {formatSeconds(duration ?? 0)}
      </div>
    </div>
  );
};

const getClipThumbnail = (clip: SearchClip) =>
  clip.thumbnail ||
  clip.videoDetail?.thumbnail_url ||
  clip.videoDetail?.hls?.thumbnail_url ||
  null;

const getClipSources = (clip: SearchClip) => {
  const hls =
    clip.hlsUrl ||
    clip.playback_urls?.hls ||
    clip.videoDetail?.hls?.video_url ||
    clip.videoDetail?.hls?.playlist_url ||
    null;
  const mp4 =
    clip.clipUrl ||
    clip.playback_urls?.mp4 ||
    clip.playback_urls?.video ||
    clip.videoDetail?.video_url ||
    clip.videoDetail?.url ||
    clip.videoDetail?.source_url ||
    null;
  return { hlsUrl: hls, mp4Url: mp4 };
};

const VideoOverlayPanelInner: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchClip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDurationLoading, setIsDurationLoading] = useState(false);
  const [loadingItemKey, setLoadingItemKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedClipForEdit, setSelectedClipForEdit] = useState<{ clip: SearchClip; detail?: any } | null>(null);
  const cloudName = useMemo(() => process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || null, []);

  const { isReplaceMode, startReplaceMode, cancelReplaceMode, replaceVideo } = useVideoReplacement();
  const { overlays, selectedOverlayId, changeOverlay } = useEditorContext();
  const addDownloadedClip = useAddDownloadedClip();
  const [localOverlay, setLocalOverlay] = useState<Overlay | null>(null);
  const { startDownload, completeDownload, failDownload } = useDownloadProgress();

  useEffect(() => {
    if (selectedOverlayId === null) {
      setLocalOverlay(null);
      return;
    }

    const selectedOverlay = overlays.find((overlay) => overlay.id === selectedOverlayId);
    if (selectedOverlay?.type === OverlayType.VIDEO) {
      setLocalOverlay(selectedOverlay);
    }
  }, [selectedOverlayId, overlays]);

  const normalizeResults = useCallback((payload: any): SearchClip[] => {
    const items =
      (Array.isArray(payload?.results) && payload.results) ||
      (Array.isArray(payload?.searchData) && payload.searchData) ||
      (Array.isArray(payload?.textSearchResults) && payload.textSearchResults) ||
      [];

    return items.map((item: any, idx: number) => {
      const start = Number(item.start ?? 0);
      const end = Number(item.end ?? start + 5);
      const vid = item.videoId || item.video_id || null;
      const detail = item.videoDetail || item.video_detail || item.video || undefined;

      return {
        id: item.id || `${vid || "clip"}-${start}-${end}-${idx}`,
        start,
        end,
        videoId: vid,
        clipUrl:
          item.clipUrl ||
          item.clip_url ||
          item.video_url ||
          item.videoUrl ||
          item.playback_urls?.mp4 ||
          item.playback_urls?.video ||
          null,
        hlsUrl: item.hlsUrl || item.hls_url || item.playlist_url || item.playback_urls?.hls || null,
        thumbnail: item.thumbnail_url || item.thumbnailUrl || item.thumbnail || null,
        videoDetail: detail,
        cloudinaryVideoId: item.cloudinaryVideoId || item.cloudinary_video_id || null,
        playback_urls: item.playback_urls,
        title: item.title || item.video_title || detail?.system_metadata?.video_title || detail?.system_metadata?.filename || vid || "Video Clip",
      };
    });
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setError("Enter a search term.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults([]);
    setPlayingId(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, limit: 18 }),
      });
      if (!res.ok) throw new Error("Search failed. Please try again.");
      const data = await res.json();
      const normalized = normalizeResults(data);
      setResults(normalized);
      if (!normalized.length) {
        setError("No results found.");
      }
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Search failed. Please try again.");
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchVideoDetail = useCallback(async (clip: SearchClip) => {
    const vid = clip.videoId;
    if (!vid) return null;
    try {
      const res = await fetch(`/api/getVideo?videoId=${encodeURIComponent(vid)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const handleAddClip = async (clip: SearchClip) => {
    const itemKey = clip.id;
    setIsDurationLoading(true);
    setLoadingItemKey(itemKey);
    setError(null);

    const startVal = Math.max(0, clip.start || 0);
    const endVal = Math.max(startVal + 0.1, clip.end || startVal + 5);
    const filename = `${clip.videoId || clip.cloudinaryVideoId || "clip"}_${Math.floor(startVal)}-${Math.floor(
      endVal
    )}.mp4`;
    const downloadId = `${itemKey}-${Date.now()}`;
    startDownload(downloadId, filename);
    const mgr = getClipDownloadManager();

    try {
      let rawId =
        clip.videoDetail?.system_metadata?.filename ||
        clip.videoDetail?.cloudinaryVideoId ||
        clip.cloudinaryVideoId ||
        null;
      let detail = clip.videoDetail;
      if (!rawId) {
        detail = await fetchVideoDetail(clip);
        rawId = detail?.system_metadata?.filename || detail?.cloudinaryVideoId || clip.cloudinaryVideoId || null;
      }

      const publicId = rawId ? normalizeCloudinaryPublicId(rawId) : null;
      if (!publicId) {
        throw new Error("Cloudinary id not available for this clip.");
      }

      const url = getClipDownloadUrl(publicId, startVal, endVal, { maxDuration: 180 });
      const { objectUrl } = await mgr.download(downloadId, url);

      await addDownloadedClip({
        blobUrl: objectUrl,
        durationSeconds: Math.max(0.1, endVal - startVal),
        startSeconds: startVal,
        endSeconds: endVal,
        cloudinaryPublicId: publicId || undefined,
        mainCloudinaryPublicId: publicId || undefined,
        thumbnail: undefined,
        filename,
      });

      completeDownload(downloadId);
      // Mirror QuickEdit import behavior: revoke temp download URL after ingest.
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    } catch (err: any) {
      failDownload(downloadId, err instanceof Error ? err.message : String(err));
      setError(err?.message || "Failed to add clip to timeline.");
    } finally {
      setIsDurationLoading(false);
      setLoadingItemKey(null);
    }
  };

  const handleReplaceClip = async (clip: SearchClip) => {
    if (!localOverlay) return;
    const { hlsUrl, mp4Url } = getClipSources(clip);
    const videoUrl = mp4Url || hlsUrl;
    if (!videoUrl) {
      setError("No playable source available to replace the current clip.");
      return;
    }

    const proxyVideo: any = {
      id: clip.id,
      type: "video",
      width: clip.videoDetail?.width || clip.videoDetail?.system_metadata?.width || 1920,
      height: clip.videoDetail?.height || clip.videoDetail?.system_metadata?.height || 1080,
      thumbnail: getClipThumbnail(clip) || "",
      videoFiles: [
        {
          quality: "hd",
          format: "video/mp4",
          url: videoUrl,
        },
      ],
      _source: "search-page",
      _sourceDisplayName: "Twelve Labs",
    };

    await replaceVideo(
      localOverlay,
      proxyVideo,
      () => videoUrl,
      (updatedOverlay) => {
        setLocalOverlay(updatedOverlay);
        setSearchQuery("");
        setResults([]);
      }
    );
  };

  const handleUpdateOverlay = (updatedOverlay: Overlay) => {
    setLocalOverlay(updatedOverlay);
    changeOverlay(updatedOverlay.id, () => updatedOverlay);
  };

  const handleCancelReplace = () => {
    cancelReplaceMode();
    setSearchQuery("");
    setResults([]);
  };

  const playableResults = useMemo(
    () =>
      results.filter((clip) => {
        const { hlsUrl, mp4Url } = getClipSources(clip);
        return Boolean(hlsUrl || mp4Url);
      }),
    [results]
  );

  const renderCard = (clip: SearchClip, idx: number) => {
    const key = clip.id || `${clip.videoId || "clip"}-${idx}`;
    const { hlsUrl: previewHls, mp4Url: previewMp4 } = getClipSources(clip);
    const { hlsUrl: actionHls, mp4Url: actionMp4 } = getClipSources(clip);
    const thumbnail = getClipThumbnail(clip);
    const startVal = Math.max(0, clip.start || 0);
    const endVal = Math.max(clip.end || 0, startVal + 0.1);
    const durationDisplay = `${formatSeconds(startVal)} – ${formatSeconds(endVal)}`;

    const publicId =
      normalizeCloudinaryPublicId(
        clip.videoDetail?.system_metadata?.filename ||
          clip.videoDetail?.system_metadata?.public_id ||
          clip.videoDetail?.cloudinaryVideoId ||
          clip.videoId ||
          ""
      ) || null;

    return (
      <div
        key={key}
        className="rounded-xl border border-border bg-card/70 p-3 shadow-sm transition hover:border-primary/60 hover:shadow-md"
      >
        
        <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg border border-border/70 bg-black">
          {previewHls ? (
            <HlsClipPlayer
              hlsUrl={previewHls}
              mp4Url={previewMp4 || undefined}
              poster={thumbnail || undefined}
              startTime={clip.start}
              playing={playingId === key}
              muted={false}
              onRequestPlay={() => setPlayingId(key)}
              onPlay={() => setPlayingId(key)}
              onPause={() => setPlayingId((current) => (current === key ? null : current))}
              onEnded={() => setPlayingId((current) => (current === key ? null : current))}
            />
          ) : previewMp4 ? (
            <Mp4Player
              src={previewMp4}
              poster={thumbnail || undefined}
              playing={playingId === key}
              onPlay={() => setPlayingId(key)}
              onPause={() => setPlayingId((current) => (current === key ? null : current))}
              onEnded={() => setPlayingId((current) => (current === key ? null : current))}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gray-900 text-sm text-muted-foreground">No playable source</div>
          )}
          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
            <Clock className="h-3.5 w-3.5" />
            <span>{durationDisplay}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={() => (isReplaceMode ? handleReplaceClip(clip) : handleAddClip(clip))}
            disabled={isDurationLoading && loadingItemKey === key}
          >
            {isReplaceMode ? "Replace" : "Add"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={!cloudName && !publicId && !actionMp4 && !actionHls}
            onClick={() => setSelectedClipForEdit({ clip, detail: clip.videoDetail })}
          >
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setPlayingId((curr) => (curr === key ? null : key))}
          >
            <Play className="mr-1.5 h-4 w-4" />
            {playingId === key ? "Pause" : "Play"}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col gap-3 p-2 overflow-hidden">
      {isReplaceMode && (
        <div className="shrink-0 flex items-center justify-between rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-blue-100">
            <Sparkles className="h-4 w-4" />
            <span>Select a clip to replace the current video</span>
          </div>
          <Button size="sm" variant="ghost" onClick={handleCancelReplace}>
            Cancel
          </Button>
        </div>
      )}

      {localOverlay && !isReplaceMode && (
        <div className="shrink-0 rounded-md border border-border/60 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
          Editing selected video. Click “Change” to switch sources.
          <Button size="sm" variant="ghost" className="ml-2" onClick={startReplaceMode}>
            Change
          </Button>
          <div className="mt-2">
            <VideoDetails
              localOverlay={localOverlay as ClipOverlay}
              setLocalOverlay={handleUpdateOverlay}
              onChangeVideo={startReplaceMode}
            />
          </div>
        </div>
      )}

      <form onSubmit={handleSearch} className="flex shrink-0 items-center gap-2">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={isReplaceMode ? "Search for replacement video" : "Search videos"}
          className="h-10 flex-1"
        />
        <Button type="submit" disabled={!searchQuery.trim() || isLoading} className="h-10">
          <Search className="mr-1.5 h-4 w-4" />
          Search
        </Button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground">
          <Search className="h-4 w-4 animate-pulse" />
          Searching Twelve Labs…
        </div>
      )}

      {!isLoading && playableResults.length === 0 && (
        <div className="rounded-md border border-dashed border-border/60 bg-card/40 px-3 py-6 text-center text-sm text-muted-foreground">
          Start typing to search indexed clips. Results use the same flow as the main search page.
        </div>
      )}

      {!isLoading && playableResults.length > 0 && (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className={isDurationLoading ? "space-y-3 opacity-90" : "space-y-3"}>
            {playableResults.slice(0, 50).map(renderCard)}
          </div>
        </div>
      )}

      {selectedClipForEdit && (
        <CloudinaryClipEditor
          open
          onClose={() => setSelectedClipForEdit(null)}
          thumbnail={getClipThumbnail(selectedClipForEdit.clip)}
          publicId={
            normalizeCloudinaryPublicId(
              selectedClipForEdit.clip.videoDetail?.system_metadata?.filename ||
                selectedClipForEdit.clip.videoDetail?.system_metadata?.public_id ||
                selectedClipForEdit.clip.videoDetail?.cloudinaryVideoId ||
                selectedClipForEdit.clip.videoId ||
                ""
            ) || undefined
          }
          mp4Url={getClipSources(selectedClipForEdit.clip).mp4Url || undefined}
          hlsUrl={getClipSources(selectedClipForEdit.clip).hlsUrl || undefined}
          start={selectedClipForEdit.clip.start}
          end={selectedClipForEdit.clip.end}
          videoDuration={
            selectedClipForEdit.clip.videoDetail?.system_metadata?.duration ||
            selectedClipForEdit.clip.videoDetail?.duration ||
            Math.max(0, (selectedClipForEdit.clip.end ?? 0) - (selectedClipForEdit.clip.start ?? 0))
          }
          portalSelector="#player-shell"
          onAddToTimeline={async (payload) => {
            if (!selectedClipForEdit) return;
            await addDownloadedClip({
              ...payload,
              cloudinaryPublicId: payload.cloudinaryPublicId || undefined,
              mainCloudinaryPublicId: payload.mainCloudinaryPublicId || undefined,
              thumbnail: payload.thumbnail || getClipThumbnail(selectedClipForEdit.clip) || undefined,
            });
            setSelectedClipForEdit(null);
          }}
        />
      )}
    </div>
  );
};

export const VideoOverlayPanel: React.FC = () => (
  <DownloadProgressProvider>
    <VideoOverlayPanelInner />
  </DownloadProgressProvider>
);
