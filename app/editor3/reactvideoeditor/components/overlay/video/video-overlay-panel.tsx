import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HlsClipPlayer from "@/app/search/components/HlsClipPlayer";
import { DownloadProgressProvider } from "@/app/search/components/DownloadProgressProvider";
import { CloudinaryClipEditor } from "@/app/search/components/CloudinaryClipEditor";
import { getClipDownloadUrl, getClipUrl, normalizeCloudinaryPublicId } from "@/utils/cloudinary";
import { formatSeconds } from "@/app/search/utils/time";
import { useEditorContext } from "../../../contexts/editor-context";
import { useTimelinePositioning } from "../../../hooks/use-timeline-positioning";
import { useAddDownloadedClip } from "../../../hooks/use-add-downloaded-clip";
import { useAspectRatio } from "../../../hooks/use-aspect-ratio";
import { ClipOverlay, Overlay, OverlayType } from "../../../types";
import { getSrcDuration } from "../../../hooks/use-src-duration";
import { calculateIntelligentAssetSize } from "../../../utils/asset-sizing";
import { useVideoReplacement } from "../../../hooks/use-video-replacement";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { AlertCircle, Clock, Download, Film, Play, Search, Sparkles } from "lucide-react";
import { VideoDetails } from "./video-details";

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

const getHydrationKey = (clip: SearchClip) => clip.videoId || clip.cloudinaryVideoId || clip.id;

const getPreviewSources = (clip: SearchClip) => {
  // Prefer Twelve Labs-supplied preview, but fall back to action sources if missing.
  const { hlsUrl, mp4Url } = getClipSources(clip);
  return { hlsUrl, mp4Url };
};

export const VideoOverlayPanel: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchClip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDurationLoading, setIsDurationLoading] = useState(false);
  const [loadingItemKey, setLoadingItemKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedClipForEdit, setSelectedClipForEdit] = useState<{ clip: SearchClip; detail?: any } | null>(null);
  const detailFetchRef = useRef<Set<string>>(new Set());
  const cloudName = useMemo(() => process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || null, []);

  const { isReplaceMode, startReplaceMode, cancelReplaceMode, replaceVideo } = useVideoReplacement();
  const {
    overlays,
    selectedOverlayId,
    changeOverlay,
    currentFrame,
    setOverlays,
    setSelectedOverlayId,
  } = useEditorContext();

  const { addAtPlayhead } = useTimelinePositioning();
  const { getAspectRatioDimensions } = useAspectRatio();
  const addDownloadedClip = useAddDownloadedClip();
  const [localOverlay, setLocalOverlay] = useState<Overlay | null>(null);

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
      const vid = item.video_id || item.videoId || null;
      const detail = item.videoDetail || item.video_detail || item.video || null;
      const start = Number(item.start ?? 0);
      const end = Number(item.end ?? start + 5);
      return {
        id: item.id || `${vid || "clip"}-${start}-${end}-${idx}`,
        start,
        end,
        thumbnail: item.thumbnail_url || item.thumbnailUrl || item.thumbnail || detail?.thumbnail_url || null,
        clipUrl:
          item.clipUrl ||
          item.clip_url ||
          item.video_url ||
          item.videoUrl ||
          item.playback_urls?.mp4 ||
          item.playback_urls?.video ||
          detail?.video_url ||
          detail?.url ||
          detail?.source_url ||
          null,
        hlsUrl:
          item.hlsUrl ||
          item.hls_url ||
          item.playlist_url ||
          item.playback_urls?.hls ||
          detail?.hls?.video_url ||
          detail?.hls?.playlist_url ||
          null,
        playback_urls: item.playback_urls,
        videoId: vid,
        cloudinaryVideoId: item.cloudinaryVideoId || item.cloudinary_video_id || null,
        videoDetail: detail || undefined,
        title:
          item.title ||
          item.video_title ||
          detail?.system_metadata?.video_title ||
          detail?.system_metadata?.filename ||
          vid ||
          "Video Clip",
      };
    });
  }, []);

  const deriveSources = useCallback(
    (clip: SearchClip, detail?: any): SearchClip => {
      const videoDetail = detail || clip.videoDetail;
      const hlsCandidate =
        clip.hlsUrl ||
        clip.playback_urls?.hls ||
        videoDetail?.hls?.video_url ||
        videoDetail?.hls?.playlist_url ||
        null;

      let clipUrlCandidate =
        clip.clipUrl ||
        clip.playback_urls?.mp4 ||
        clip.playback_urls?.video ||
        videoDetail?.video_url ||
        videoDetail?.url ||
        videoDetail?.source_url ||
        null;

      if (!clipUrlCandidate && cloudName && typeof clip.start === "number" && typeof clip.end === "number") {
        const publicId = normalizeCloudinaryPublicId(
          videoDetail?.system_metadata?.filename ||
            videoDetail?.system_metadata?.public_id ||
            clip.cloudinaryVideoId ||
            clip.videoId ||
            ""
        );
        if (publicId) {
          try {
            clipUrlCandidate = getClipUrl(publicId, clip.start, clip.end, { download: false });
          } catch {
            // ignore
          }
        }
      }

      const thumbCandidate =
        clip.thumbnail ||
        videoDetail?.thumbnail_url ||
        videoDetail?.hls?.thumbnail_url ||
        null;

      return {
        ...clip,
        hlsUrl: hlsCandidate || null,
        clipUrl: clipUrlCandidate || null,
        thumbnail: thumbCandidate || null,
        videoDetail: videoDetail || clip.videoDetail,
      };
    },
    [cloudName]
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setError(null);
    setResults([]);
    detailFetchRef.current.clear();
    setPlayingId(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, limit: 18 }),
      });
      if (!res.ok) {
        throw new Error("Search failed");
      }
      const data = await res.json();
      const normalized = normalizeResults(data).map((c) => deriveSources(c));
      setResults(normalized);
    } catch (err: any) {
      setError(err?.message || "Search failed");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const missing = results.filter((clip) => {
      const key = getHydrationKey(clip);
      if (!key || detailFetchRef.current.has(key)) return false;
      const { hlsUrl, mp4Url } = getPreviewSources(clip);
      return !clip.videoDetail || (!hlsUrl && !mp4Url);
    });
    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      const enriched = await Promise.all(
        results.map(async (clip) => {
          const key = getHydrationKey(clip);
          const { hlsUrl, mp4Url } = getPreviewSources(clip);
          if (!key || detailFetchRef.current.has(key) || (clip.videoDetail && (hlsUrl || mp4Url))) return clip;
          detailFetchRef.current.add(key);
          try {
            const detailRes = await fetch(`/api/getVideo?videoId=${encodeURIComponent(key)}`);
            if (!detailRes.ok) return clip;
            const detail = await detailRes.json();
            return deriveSources({ ...clip, videoDetail: detail }, detail);
          } catch {
            return clip;
          }
        })
      );
      if (!cancelled) setResults(enriched);
    })();

    return () => {
      cancelled = true;
    };
  }, [results]);

  // Eagerly hydrate clips that still have no playable source after initial normalization
  useEffect(() => {
    const lackingSource = results.filter(
      (c) => !c.hlsUrl && !c.clipUrl && (c.videoId || c.cloudinaryVideoId) && !detailFetchRef.current.has(c.videoId || "")
    );
    if (!lackingSource.length) return;

    let cancelled = false;
    (async () => {
      const enriched = await Promise.all(
        results.map(async (clip) => {
          if (clip.hlsUrl || clip.clipUrl) return clip;
          const vid = clip.videoId;
          if (!vid || detailFetchRef.current.has(vid)) return clip;
          detailFetchRef.current.add(vid);
          try {
            const res = await fetch(`/api/getVideo?videoId=${encodeURIComponent(vid)}`);
            if (!res.ok) return clip;
            const detail = await res.json();
            return deriveSources({ ...clip, videoDetail: detail }, detail);
          } catch {
            return clip;
          }
        })
      );
      if (!cancelled) setResults(enriched);
    })();

    return () => {
      cancelled = true;
    };
  }, [results, deriveSources]);

  const handleAddClip = async (clip: SearchClip) => {
    const itemKey = clip.id;
    setIsDurationLoading(true);
    setLoadingItemKey(itemKey);

    try {
      const { hlsUrl, mp4Url } = getClipSources(clip);
      const videoUrl = mp4Url || hlsUrl;
      if (!videoUrl) {
        setError("No playable source available for this clip.");
        return;
      }

      let durationInFrames = 200;
      let mediaSrcDuration: number | undefined;

      try {
        const result = await getSrcDuration(videoUrl);
        durationInFrames = result.durationInFrames;
        mediaSrcDuration = result.durationInSeconds;
      } catch (err) {
        console.warn("Failed to get video duration, using fallback:", err);
      }

      const thumb = getClipThumbnail(clip) || "";
      const canvasDimensions = getAspectRatioDimensions();
      const assetDimensions = {
        width: clip.videoDetail?.width || clip.videoDetail?.system_metadata?.width || canvasDimensions.width,
        height: clip.videoDetail?.height || clip.videoDetail?.system_metadata?.height || canvasDimensions.height,
      };
      const { width, height } = calculateIntelligentAssetSize(assetDimensions, canvasDimensions);

      const { from, row, updatedOverlays } = addAtPlayhead(currentFrame, overlays, "top");

      const newOverlay = {
        left: 0,
        top: 0,
        width,
        height,
        durationInFrames,
        from,
        rotation: 0,
        row,
        isDragging: false,
        type: OverlayType.VIDEO,
        content: thumb,
        src: videoUrl,
        videoStartTime: clip.start ?? 0,
        mediaSrcDuration,
        styles: {
          opacity: 1,
          zIndex: 100,
          transform: "none",
          objectFit: "contain",
          animation: {
            enter: "none",
            exit: "none",
          },
        },
      };

      const newId = updatedOverlays.length > 0 ? Math.max(...updatedOverlays.map((o) => o.id)) + 1 : 0;
      const overlayWithId = { ...newOverlay, id: newId } as Overlay;
      const finalOverlays = [...updatedOverlays, overlayWithId];

      setOverlays(finalOverlays);
      setSelectedOverlayId(newId);
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
      results
        .map((clip) => deriveSources(clip)) // ensure we re-apply any late detail hydration
        .filter((clip) => {
          const { hlsUrl, mp4Url } = getPreviewSources(clip);
          return Boolean(hlsUrl || mp4Url);
        }),
    [results, deriveSources]
  );

  const renderCard = (clip: SearchClip, idx: number) => {
    const key = clip.id || `${clip.videoId || "clip"}-${idx}`;
    const { hlsUrl: previewHls, mp4Url: previewMp4 } = getPreviewSources(clip);
    const { hlsUrl: actionHls, mp4Url: actionMp4 } = getClipSources(clip);
    const title =
      clip.title ||
      clip.videoDetail?.system_metadata?.video_title ||
      clip.videoDetail?.system_metadata?.filename ||
      clip.videoId ||
      "Video Clip";
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

        <div className="grid grid-cols-2 gap-2">
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
        </div>
      </div>
    );
  };

  return (
    <DownloadProgressProvider>
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
      </div>

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
          onAddToTimeline={(payload) => {
            if (!selectedClipForEdit) return;
            addDownloadedClip({
              ...payload,
              thumbnail: payload.thumbnail || getClipThumbnail(selectedClipForEdit.clip) || undefined,
              mainCloudinaryPublicId:
                payload.mainCloudinaryPublicId ||
                normalizeCloudinaryPublicId(
                  selectedClipForEdit.clip.videoDetail?.system_metadata?.filename ||
                    selectedClipForEdit.clip.videoDetail?.system_metadata?.public_id ||
                    selectedClipForEdit.clip.videoDetail?.cloudinaryVideoId ||
                    selectedClipForEdit.clip.videoId ||
                    ""
                ) ||
                undefined,
            });
            setSelectedClipForEdit(null);
          }}
        />
      )}
    </DownloadProgressProvider>
  );
};
