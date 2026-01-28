import React, { useEffect, useState, useRef, useCallback } from "react";
import clsx from "clsx";
import { useInView } from "react-intersection-observer";
import LoadingSpinner from "./LoadingSpinner2";
import ErrorFallback from "./ErrorFallback2";
import ClipEditor from "@/components/ClipEditor";
import { getOptimalClipUrl, normalizeCloudinaryPublicId } from "@/utils/cloudinary2";
import { useDownloadProgress } from "./DownloadProgress2";
import ClipPreviewPlayer from "./ClipPreviewPlayer";

const CONFIDENCE_THRESHOLDS = { high: 0.75, medium: 0.5 };
const MAX_CLIP_DURATION = 180; // seconds

const formatTimestamp = (value = 0) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "0:00";
  const wholeSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const getConfidenceLabel = (clip) => {
  if (!clip) return null;
  if (typeof clip.confidence === "string") {
    const normalized = clip.confidence.trim().toLowerCase();
    if (["high", "medium", "low"].includes(normalized)) return normalized;
  }
  const numericConfidence =
    typeof clip.confidence === "number"
      ? clip.confidence
      : typeof clip.score === "number"
      ? clip.score
      : typeof clip.confidence_score === "number"
      ? clip.confidence_score
      : typeof clip.confidenceScore === "number"
      ? clip.confidenceScore
      : null;
  if (typeof numericConfidence === "number") {
    if (numericConfidence >= CONFIDENCE_THRESHOLDS.high) return "high";
    if (numericConfidence >= CONFIDENCE_THRESHOLDS.medium) return "medium";
    return "low";
  }
  return null;
};

const getConfidenceBadgeClasses = (confidenceLabel) =>
  clsx(
    "px-2",
    "py-1",
    "rounded-md",
    "backdrop-blur-sm",
    confidenceLabel === "high"
      ? "bg-emerald-600/80 text-white"
      : confidenceLabel === "medium"
      ? "bg-yellow-500/80 text-white"
      : "bg-slate-600/80 text-white"
  );

const SearchResultList2 = ({
  searchResultData,
  updatedSearchData,
  setUpdatedSearchData,
  onClipSelect = null,
  selectedClipId = null,
  activeClipId = null,
  mutePlayback = false,
  isClipDisabled = null,
  getClipDisabledReason = null,
}) => {
  const [nextPageLoading, setNextPageLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playingIndex, setPlayingIndex] = useState(null);
  const switchingRef = useRef(false);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [downloadingClips, setDownloadingClips] = useState({});
  const [clipProgress, setClipProgress] = useState({});
  const [cloudinaryCloudName, setCloudinaryCloudName] = useState(null);
  const [adjustModalState, setAdjustModalState] = useState(null);
  const [adjustError, setAdjustError] = useState(null);
  const [activatedPlayers, setActivatedPlayers] = useState({});
  const { startDownload, updateProgress, completeDownload, failDownload } = useDownloadProgress();

  const { ref: observerRef, inView } = useInView({ threshold: 0.8, triggerOnce: false });

  const fetchNextSearchResults = async () => {
    setNextPageLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/searchByToken2?pageToken=${nextPageToken}`);
      if (!response.ok) throw new Error("Failed to fetch next data");
      const { pageInfo, searchData } = await response.json();
      setNextPageToken(pageInfo.next_page_token || pageInfo.nextPageToken || null);
      return { pageInfo, searchData };
    } catch (err) {
      console.error("Error getting next search results", err);
      setError(err.message);
    } finally {
      setNextPageLoading(false);
    }
  };

  const getCloudinaryCloudName = useCallback(async () => {
    if (cloudinaryCloudName) return cloudinaryCloudName;
    try {
      const configResponse = await fetch("/api/cloudinary-config2");
      if (configResponse.ok) {
        const config = await configResponse.json();
        setCloudinaryCloudName(config.cloudName);
        return config.cloudName;
      }
    } catch (apiError) {
      const envCloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      if (envCloudName) {
        setCloudinaryCloudName(envCloudName);
        return envCloudName;
      }
    }
    return null;
  }, [cloudinaryCloudName]);

  const fetchVideoDetails = useCallback(
    async (data) => {
      try {
        if (!Array.isArray(data) || data.length === 0) return [];
        const cloudName = await getCloudinaryCloudName();

        const updatedData = await Promise.all(
          data.map(async (clip) => {
            const videoId = clip.video_id || clip.videoId;
            const indexId = clip.indexId || clip.index_id || clip.videoDetail?.index_id || null;
            const indexParam = indexId ? `&indexId=${encodeURIComponent(indexId)}` : "";
            const response = await fetch(`/api/getVideo2?videoId=${videoId}${indexParam}`);
            if (!response.ok) throw new Error("Network response was not ok");
            const videoDetail = await response.json();

            let clipUrl = clip.clipUrl;
            let cloudinaryVideoId = null;
            if (!clipUrl && clip.start !== undefined && clip.end !== undefined) {
              const filename = videoDetail.system_metadata?.filename;
              if (filename && cloudName) {
                cloudinaryVideoId = filename.replace(/\.mp4$/i, "");
                const start = clip.start;
                const end = clip.end;
                if (typeof start === "number" && typeof end === "number" && start < end) {
                  const duration = end - start;
                  if (duration <= 180) {
                    try {
                      const { buildSafeRange } = await import("@/utils/cloudinary2");
                      const { startRounded, endRounded } = buildSafeRange(start, end);
                      clipUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${startRounded},eo_${endRounded},f_mp4/${cloudinaryVideoId}.mp4`;
                    } catch (err) {
                      console.warn("Failed to generate Cloudinary URL:", err);
                    }
                  }
                }
              }
            }

            const confidenceLabel = getConfidenceLabel(clip);
            return {
              ...clip,
              videoDetail,
              clipUrl: clipUrl || clip.clipUrl,
              cloudinaryVideoId: cloudinaryVideoId || clip.cloudinaryVideoId,
              indexId: indexId || clip.indexId || clip.index_id || videoDetail?.index_id || null,
              confidenceLabel,
            };
          })
        );

        return updatedData;
      } catch (err) {
        console.error("Failed to fetch video details:", err);
        setError(err.message);
        return [];
      }
    },
    [getCloudinaryCloudName]
  );

  const getVideoDuration = (clip) =>
    clip.videoDetail?.system_metadata?.duration ??
    clip.videoDetail?.duration ??
    clip.duration ??
    null;

  const validateAdjustment = (start, end, videoDuration) => {
    if (start < 0) return "Clip cannot start before 0s.";
    if (videoDuration && end > videoDuration) return "End time cannot exceed the video length.";
    if (end <= start) return "End time must be greater than start time.";
    if (end - start > MAX_CLIP_DURATION) return `Clip length is limited to ${MAX_CLIP_DURATION / 60} minutes.`;
    return null;
  };

  const ensureVideoDetail = useCallback(
    async (clip) => {
      if (clip.videoDetail) return clip.videoDetail;
      const videoId = clip.video_id || clip.videoId;
      if (!videoId) return null;
      const response = await fetch(`/api/getVideo2?videoId=${encodeURIComponent(videoId)}`);
      if (!response.ok) return null;
      const detail = await response.json();
      setUpdatedSearchData((prev) => {
        if (!prev?.searchData) return prev;
        const nextSearchData = prev.searchData.map((c) => ((c.video_id || c.videoId) === videoId ? { ...c, videoDetail: detail } : c));
        return { ...prev, searchData: nextSearchData };
      });
      return detail;
    },
    [setUpdatedSearchData]
  );

  const openAdjustModal = async (clip, index) => {
    const videoDetail = await ensureVideoDetail(clip);
    const cloudName = await getCloudinaryCloudName();
    const hydratedClip = videoDetail ? { ...clip, videoDetail } : clip;

    const videoDuration = getVideoDuration(hydratedClip);
    const start = Math.max(0, Math.round((hydratedClip.start ?? 0) * 100) / 100);
    const desiredEnd = Math.round((hydratedClip.end ?? start + 5) * 100) / 100;
    const end = videoDuration && desiredEnd > videoDuration ? videoDuration : desiredEnd;

    const hlsUrl = hydratedClip.videoDetail?.hls?.video_url || null;

    // Prefer a pre-cached Cloudinary clip; then a custom Cloudinary clip; then fall back to HLS
    let previewUrl = null;
    let previewWindow = null;

    try {
      const fallbackFileName = hydratedClip.videoDetail?.system_metadata?.filename;
      const sanitizedFileName = typeof fallbackFileName === "string" ? fallbackFileName.replace(/\.mp4$/i, "") : undefined;
      const sourceId = hydratedClip.cloudinaryId || hydratedClip.cloudinaryVideoId || sanitizedFileName;
      if (sourceId && cloudName) {
        const optimalClip = getOptimalClipUrl(sourceId, start, end, { cloudName });
        previewUrl = optimalClip.url;
        previewWindow = {
          previewStart: optimalClip.previewStart,
          previewEnd: optimalClip.previewEnd,
          previewDuration: optimalClip.previewDuration,
        };
        console.log("Using pre-cached clip:", optimalClip.isPreCached, "seekOffset:", optimalClip.seekOffset);
      } else if (!cloudName) {
        console.error("[SearchResultList2] Missing cloudName for pre-cached clip generation", {
          sourceId,
          videoId: hydratedClip.video_id || hydratedClip.videoId,
          filename: hydratedClip.videoDetail?.system_metadata?.filename,
        });
      }
    } catch (err) {
      console.warn("Failed to generate preview URL:", err);
      previewUrl = null;
    }

    if (!previewUrl) {
      try {
        const customUrl = await getCustomCloudinaryUrl(hydratedClip, start, end);
        if (customUrl) {
          previewUrl = customUrl;
          const { buildSafeRange } = await import("@/utils/cloudinary2");
          const { startRounded, endRounded } = buildSafeRange(start, end);
          previewWindow = {
            previewStart: startRounded,
            previewEnd: endRounded,
            previewDuration: endRounded - startRounded,
          };
        }
      } catch (err) {
        console.warn("Fallback Cloudinary clip failed:", err);
      }
    }

    if (!previewUrl && hlsUrl) {
      const { buildSafeRange } = await import("@/utils/cloudinary2");
      const { startRounded, endRounded } = buildSafeRange(start, end);
      previewUrl = hlsUrl;
      previewWindow = {
        previewStart: startRounded,
        previewEnd: endRounded,
        previewDuration: endRounded - startRounded,
      };
      console.log("Using HLS fallback for editor preview with bounded window");
    }

    if (!previewWindow && previewUrl) {
      const { buildSafeRange } = await import("@/utils/cloudinary2");
      const { startRounded, endRounded } = buildSafeRange(start, end);
      previewWindow = { previewStart: startRounded, previewEnd: endRounded, previewDuration: endRounded - startRounded };
    }

    // Debug log to see chosen preview source
    try {
      console.log("[SearchResultList2] preview selection", {
        previewUrl,
        previewWindow,
        hls: hydratedClip.videoDetail?.hls?.video_url,
        filename: hydratedClip.videoDetail?.system_metadata?.filename,
        videoId: hydratedClip.video_id || hydratedClip.videoId,
        cloudName,
      });
    } catch (_) {}

    if (!previewUrl && !hydratedClip.videoDetail?.hls?.video_url) {
      console.error("[SearchResultList2] No preview URL or HLS available for clip", {
        videoId: hydratedClip.video_id || hydratedClip.videoId,
        filename: hydratedClip.videoDetail?.system_metadata?.filename,
      });
    }

    setAdjustModalState({
      clip: hydratedClip,
      index,
      start,
      end,
      videoDuration: videoDuration || 180,
      previewUrl,
      previewWindow,
    });
    setAdjustError(validateAdjustment(start, end, videoDuration));
  };

  const closeAdjustModal = () => {
    setAdjustModalState(null);
    setAdjustError(null);
  };

  const handleAdjustedDownload = async (start, end) => {
    if (!adjustModalState) return;
    const { clip, index, videoDuration } = adjustModalState;
    const validationResult = validateAdjustment(start, end, videoDuration);
    if (validationResult) {
      setAdjustError(validationResult);
      return;
    }
    closeAdjustModal();
    await handleDownloadClip(clip, index, { start, end });
  };

  const getCustomCloudinaryUrl = async (clip, start, end) => {
    const cloudName = await getCloudinaryCloudName();
    const fallbackFileName = clip.videoDetail?.system_metadata?.filename;
    const sanitizedFileName = typeof fallbackFileName === "string" ? fallbackFileName.replace(/\.mp4$/i, "") : undefined;
    const sourceId = normalizeCloudinaryPublicId(clip.cloudinaryId || clip.cloudinaryVideoId || sanitizedFileName);
    if (!cloudName || !sourceId) return null;
    const { buildSafeRange } = await import("@/utils/cloudinary2");
    const { startRounded, endRounded } = buildSafeRange(start, end);
    // Stream-friendly URL (no fl_attachment) for preview playback
    return `https://res.cloudinary.com/${cloudName}/video/upload/so_${startRounded},eo_${endRounded},f_mp4/${sourceId}.mp4`;
  };

  const handleNextPage = async () => {
    const result = await fetchNextSearchResults();
    if (result && result.searchData) {
      const updatedData = await fetchVideoDetails(result.searchData);
      setUpdatedSearchData((prevData) => ({
        searchData: [...prevData.searchData, ...updatedData],
        pageInfo: { ...prevData.pageInfo, ...result.pageInfo },
      }));
    }
  };

  const handleDownloadClip = async (clip, index, overrideRange) => {
    const clipKey = `${clip.video_id || clip.videoId}-${index}`;
    const startTime = typeof overrideRange?.start === "number" ? overrideRange.start : clip.start;
    const endTime = typeof overrideRange?.end === "number" ? overrideRange.end : clip.end;
    if (typeof startTime !== "number" || typeof endTime !== "number" || startTime < 0 || endTime <= startTime) {
      alert("Invalid time range for download.");
      return;
    }
    if (endTime - startTime > MAX_CLIP_DURATION) {
      alert(`Clip duration cannot exceed ${MAX_CLIP_DURATION / 60} minutes.`);
      return;
    }
    const filename = `${clip.videoDetail?.system_metadata?.filename || clip.video_id || clip.videoId || "clip"}_${startTime}s-${endTime}s.mp4`;
    const downloadId = `${clipKey}-${Date.now()}`;

    setDownloadingClips((prev) => ({ ...prev, [clipKey]: true }));
    setClipProgress((prev) => ({ ...prev, [clipKey]: 0 }));
    startDownload(downloadId, filename);

    try {
      const customUrl = await getCustomCloudinaryUrl(clip, startTime, endTime);
      if (customUrl) {
        const response = await fetch(customUrl);
        if (!response.ok) throw new Error("Failed to download clip from Cloudinary");
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
        completeDownload(downloadId);
        return;
      }

      // Client-side FFmpeg fallback using HLS stream if available
      if (clip.videoDetail?.hls?.video_url) {
        try {
          const { processVideoClip } = await import("@/utils/videoProcessor2");
          const blob = await processVideoClip(clip.videoDetail.hls.video_url, startTime, endTime, (progress) => {
            setClipProgress((prev) => ({ ...prev, [clipKey]: progress }));
            updateProgress(downloadId, progress);
          });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          completeDownload(downloadId);
          return;
        } catch (ffmpegError) {
          console.warn("FFmpeg fallback failed, will try server clip:", ffmpegError);
        }
      }

      const videoId = clip.video_id || clip.videoId;
      const videoUrl = clip.videoDetail?.hls?.video_url;
      if (!videoId || !videoUrl) {
        throw new Error("Missing video information");
      }

      setClipProgress((prev) => ({ ...prev, [clipKey]: 0 }));
      updateProgress(downloadId, 0);

      const apiUrl = `/api/download-clip2?videoId=${encodeURIComponent(videoId)}&start=${encodeURIComponent(
        startTime
      )}&end=${encodeURIComponent(endTime)}&videoUrl=${encodeURIComponent(videoUrl)}`;
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error("Failed to download clip");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      completeDownload(downloadId);
    } catch (err) {
      console.error("Error downloading clip:", err);
      failDownload(downloadId, err);
      alert(`Failed to download clip: ${err.message}.`);
    } finally {
      setDownloadingClips((prev) => ({ ...prev, [clipKey]: false }));
      setClipProgress((prev) => {
        const next = { ...prev };
        delete next[clipKey];
        return next;
      });
    }
  };

  useEffect(() => {
    if (inView && nextPageToken && !nextPageLoading && !switchingRef.current) {
      handleNextPage();
    }
  }, [inView, nextPageToken, nextPageLoading]);

  useEffect(() => {
    let cancelled = false;
    const processSearchResults = async () => {
      if (!searchResultData) {
        if (!cancelled) {
          setUpdatedSearchData({ searchData: [], pageInfo: {} });
          setNextPageToken(null);
          setNextPageLoading(false);
          setError(null);
        }
        return;
      }
      const rawResults = searchResultData.searchData || searchResultData.textSearchResults || [];
      const nextToken = searchResultData.pageInfo?.next_page_token || searchResultData.pageInfo?.nextPageToken || null;
      const updatedData = await fetchVideoDetails(rawResults);
      if (cancelled) return;
      setUpdatedSearchData({ searchData: updatedData, pageInfo: searchResultData.pageInfo || {} });
      setNextPageToken(nextToken);
      setNextPageLoading(false);
      setError(null);
    };
    processSearchResults();
    return () => {
      cancelled = true;
    };
  }, [searchResultData, setUpdatedSearchData, fetchVideoDetails]);

  // Reset any playing clip when new results arrive
  useEffect(() => {
    setPlayingIndex(null);
  }, [searchResultData]);

  const activateAndPlay = (index) => {
    setActivatedPlayers((prev) => ({ ...prev, [index]: true }));
    setPlayingIndex(index);
  };

  if (error) return <ErrorFallback error={error} />;

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {updatedSearchData.searchData?.map((clip, index) => {
          const clipId = clip.video_id || clip.videoId || index;
          const confidenceLabel = clip.confidenceLabel || getConfidenceLabel(clip);
          const disabled = typeof isClipDisabled === "function" ? isClipDisabled(clip) : false;
          const disabledReason = typeof getClipDisabledReason === "function" ? getClipDisabledReason(clip) : null;
          const thumbnailUrl = clip.thumbnail_url
            ? `/api/image-proxy?url=${encodeURIComponent(clip.thumbnail_url)}`
            : null;
          const hlsUrl = clip.videoDetail?.hls?.video_url || null;
          const mp4Url = clip.clipUrl || null;
          const hasPlayableSource = Boolean(hlsUrl || mp4Url);
          const startTime = typeof clip.start === "number" ? Math.max(0, clip.start) : 0;
          const endTime = typeof clip.end === "number" ? clip.end : null;
          const isActive = activatedPlayers[index] || playingIndex === index;

          return (
              <div
                key={`${clipId}-${index}`}
                className={clsx(
                  "group relative bg-gray-950 rounded-xl shadow-md hover:shadow-xl border border-gray-800/60 overflow-hidden transition-all duration-300 hover:-translate-y-1",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
              <div className="relative aspect-video bg-black">
                {hasPlayableSource ? (
                  <ClipPreviewPlayer
                    hlsUrl={hlsUrl}
                    mp4Url={mp4Url}
                    thumbnailUrl={thumbnailUrl}
                    startTime={startTime}
                    endTime={endTime}
                    playing={playingIndex === index}
                    isActive={isActive}
                    muted={mutePlayback}
                    onActivate={() => activateAndPlay(index)}
                    onPlay={() => activateAndPlay(index)}
                    onPause={() => setPlayingIndex((current) => (current === index ? null : current))}
                    onEnded={() => setPlayingIndex((current) => (current === index ? null : current))}
                  />
                ) : thumbnailUrl ? (
                  <img src={thumbnailUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center w-full h-full text-slate-600">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14m0-4v4m0-4L9 6m6 4L9 14m0-8l-4.553-2.276A1 1 0 003 4.618v6.764a1 1 0 001.447.894L9 10m0 0v4m0-4l6 8m-6-8l-6 8" />
                    </svg>
                  </div>
                )}
                {selectedClipId === clipId && (
                  <div className="absolute inset-0 ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-950 pointer-events-none" />
                )}
                {disabled && disabledReason && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-center px-4">
                    <p className="text-sm text-red-300">{disabledReason}</p>
                  </div>
                )}
              </div>

              <div className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded-md bg-indigo-900/50 text-indigo-200 text-xs font-semibold">
                      {formatTimestamp(clip.start)} - {formatTimestamp(clip.end)}
                    </span>
                    {confidenceLabel && <span className={getConfidenceBadgeClasses(confidenceLabel)}>{confidenceLabel}</span>}
                  </div>
                  <div className="text-xs text-slate-400">
                    Video: {clip.video_id || clip.videoId || "unknown"}
                  </div>
                </div>

                {clip?.metadata && (
                  <p className="mt-2 text-sm text-slate-400 line-clamp-3">{clip.metadata}</p>
                )}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 21l1.5-1.5L12 21l-.75-4M9 3v4M5 7h8M13 3v4m-4 3h8M9 10v4" />
                    </svg>
                    {Math.max(0, Math.round((clip.end - clip.start) * 100) / 100)}s
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadClip(clip, index);
                      }}
                      disabled={downloadingClips[`${clip.video_id || clip.videoId}-${index}`]}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-900/30 hover:bg-indigo-900/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {downloadingClips[`${clip.video_id || clip.videoId}-${index}`] ? (
                        <>
                          <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>
                            {clipProgress[`${clip.video_id || clip.videoId}-${index}`] !== undefined
                              ? `Processing ${Math.round(clipProgress[`${clip.video_id || clip.videoId}-${index}`])}%`
                              : "Downloading..."}
                          </span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          <span>Download Clip</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openAdjustModal(clip, index);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800/40 hover:bg-slate-700/60 rounded-lg transition-colors"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M8 6v12m8-6v6m4-12H4" />
                      </svg>
                      <span>Edit & Download</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div ref={observerRef} className="w-full text-center py-8">
        {nextPageToken && (
          <div className="flex justify-center items-center w-full gap-3">
            <LoadingSpinner size="sm" color="default" />
            <span className="text-sm text-slate-400">Loading more results...</span>
          </div>
        )}
      </div>
      {adjustModalState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl p-6">
            <button onClick={closeAdjustModal} className="absolute right-4 top-4 text-slate-400 hover:text-slate-100 transition-colors" aria-label="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className="text-lg font-semibold text-white mb-4">Edit & Download</h3>
            <ClipEditor
              clip={adjustModalState.clip}
              videoDetail={adjustModalState.clip.videoDetail}
              previewUrl={adjustModalState.previewUrl}
              initialStart={adjustModalState.start}
              initialEnd={adjustModalState.end}
              videoDuration={adjustModalState.videoDuration}
              previewWindowOverride={adjustModalState.previewWindow}
              onDownload={handleAdjustedDownload}
              onCancel={closeAdjustModal}
              getCustomCloudinaryUrl={getCustomCloudinaryUrl}
              aspectRatio={
                adjustModalState.clip?.aspectRatio ||
                adjustModalState.clip?.videoDetail?.aspect_ratio ||
                (adjustModalState.clip?.videoDetail?.width && adjustModalState.clip?.videoDetail?.height
                  ? adjustModalState.clip.videoDetail.width / adjustModalState.clip.videoDetail.height
                  : 16 / 9)
              }
            />
            {adjustError && <div className="mt-3 text-sm text-red-400">{adjustError}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchResultList2;
