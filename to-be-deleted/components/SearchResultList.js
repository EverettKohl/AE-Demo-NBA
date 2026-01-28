import React, { useEffect, useState, useRef, useCallback } from "react";
import clsx from "clsx";
import { useInView } from "react-intersection-observer";
import ReactPlayer from "react-player";
import LoadingSpinner from "./LoadingSpinner";
import ErrorFallback from "./ErrorFallback";
import ClipEditor from "@/components/ClipEditor";
import HLSVideoPlayer from "./HLSVideoPlayer";
import { getOptimalClipUrl, normalizeCloudinaryPublicId } from "@/utils/cloudinary";
import { useDownloadProgress } from "./DownloadProgress";

/**
 *
 * SearchResults -> SearchResultList
 */
const CONFIDENCE_THRESHOLDS = {
  high: 0.75,
  medium: 0.5,
};

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

  // Honor existing string labels if present
  if (typeof clip.confidence === "string") {
    const normalized = clip.confidence.trim().toLowerCase();
    if (["high", "medium", "low"].includes(normalized)) {
      return normalized;
    }
  }

  // Use numeric confidence/score values when available
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

const SearchResultList = ({
  searchResultData,
  updatedSearchData,
  setUpdatedSearchData,
  onClipSelect = null, // Optional callback for selecting clips (for ReplaceModal)
  selectedClipId = null, // ID of currently selected clip
  activeClipId = null, // Clip currently highlighted by narration
  mutePlayback = false, // Mute all playback audio (e.g., during narration)
  isClipDisabled = null, // Optional: disable selection for specific clips
  getClipDisabledReason = null, // Optional: tooltip for disabled clips
}) => {
  const [nextPageLoading, setNextPageLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playingIndex, setPlayingIndex] = useState(null);
  const [clickedThumbnailIndex, setClickedThumbnailIndex] = useState(null);
  const switchingRef = useRef(false);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [downloadingClips, setDownloadingClips] = useState({});
  const [clipProgress, setClipProgress] = useState({});
  const [cloudinaryCloudName, setCloudinaryCloudName] = useState(null);
  const [adjustModalState, setAdjustModalState] = useState(null);
  const [adjustError, setAdjustError] = useState(null);

  const playerRefs = useRef([]);
  const { startDownload, updateProgress, completeDownload, failDownload } = useDownloadProgress();

  /** React Query hook that sets up an intersection observer to load more data when in view */
  const { ref: observerRef, inView } = useInView({
    threshold: 0.8,
    triggerOnce: false,
  });

  /** Fetches the next set of search results using the next page token */
  const fetchNextSearchResults = async () => {
    setNextPageLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/searchByToken?pageToken=${nextPageToken}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch next data");
      }

      const { pageInfo, searchData } = await response.json();
      setNextPageToken(
        pageInfo.next_page_token || pageInfo.nextPageToken || null
      );
      return { pageInfo, searchData };
    } catch (error) {
      console.error("Error getting next search results", error);
      setError(error.message);
    } finally {
      setNextPageLoading(false);
    }
  };

  /** Fetches Cloudinary cloud name (cached) */
  const getCloudinaryCloudName = useCallback(async () => {
    if (cloudinaryCloudName) {
      return cloudinaryCloudName;
    }
    
    try {
      const configResponse = await fetch('/api/cloudinary-config');
      if (configResponse.ok) {
        const config = await configResponse.json();
        setCloudinaryCloudName(config.cloudName);
        return config.cloudName;
      }
    } catch (apiError) {
      // Fallback to env var if API fails (for development)
      const envCloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      if (envCloudName) {
        setCloudinaryCloudName(envCloudName);
        return envCloudName;
      }
    }
    return null;
  }, [cloudinaryCloudName, setCloudinaryCloudName]);

  /** Fetches detailed video information for each item in the provided data array */
  const fetchVideoDetails = useCallback(async (data) => {
    try {
      if (!Array.isArray(data) || data.length === 0) {
        return [];
      }
      // Get Cloudinary cloud name once for all clips
      const cloudName = await getCloudinaryCloudName();
      
      const updatedData = await Promise.all(
        data.map(async (clip) => {
          const videoId = clip.video_id || clip.videoId;
          const indexId = clip.indexId || clip.index_id || clip.videoDetail?.index_id || null;
          const indexParam = indexId ? `&indexId=${encodeURIComponent(indexId)}` : "";
          const response = await fetch(
            `/api/getVideo?videoId=${videoId}${indexParam}`
          );
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          const videoDetail = await response.json();
          
          // Generate Cloudinary clip URL if not already present
          let clipUrl = clip.clipUrl;
          let cloudinaryVideoId = null;
          if (!clipUrl && clip.start !== undefined && clip.end !== undefined) {
            const filename = videoDetail.system_metadata?.filename;
            if (filename && cloudName) {
              // Extract video ID from filename (remove .mp4 extension)
              cloudinaryVideoId = filename.replace(/\.mp4$/i, '');
              const start = clip.start;
              const end = clip.end;
              
              // Validate timestamps and duration
              if (typeof start === 'number' && typeof end === 'number' && start < end) {
                const duration = end - start;
                if (duration <= 180) { // Max 3 minutes
                  try {
                    const { buildSafeRange } = await import("@/utils/cloudinary");
                    const { startRounded, endRounded } = buildSafeRange(start, end);
                    // NOTE: Do NOT include fl_attachment for streaming playback
                    // fl_attachment is only for downloads
                    // Include .mp4 extension for better player compatibility
                    clipUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${startRounded},eo_${endRounded},f_mp4/${cloudinaryVideoId}.mp4`;
                  } catch (error) {
                    console.warn('Failed to generate Cloudinary URL:', error);
                  }
                }
              }
            }
          }
          
          const confidenceLabel = getConfidenceLabel(clip);

          return {
            ...clip,
            videoDetail: videoDetail,
            clipUrl: clipUrl || clip.clipUrl,
            cloudinaryVideoId: cloudinaryVideoId || clip.cloudinaryVideoId,
            indexId: indexId || clip.indexId || clip.index_id || videoDetail?.index_id || null,
            confidenceLabel,
          };
        })
      );

      return updatedData;
    } catch (error) {
      console.error("Failed to fetch video details:", error);
      setError(error.message);
      return [];
    }
  }, [getCloudinaryCloudName, setError]);

  const getVideoDuration = (clip) =>
    clip.videoDetail?.system_metadata?.duration ??
    clip.videoDetail?.duration ??
    clip.duration ??
    null;

  /** Ensure we have full videoDetail (filename, hls url, etc.) before editing */
  const ensureVideoDetail = useCallback(
    async (clip) => {
      if (clip.videoDetail) return clip.videoDetail;
      const videoId = clip.video_id || clip.videoId;
      if (!videoId) return null;
      const response = await fetch(`/api/getVideo?videoId=${encodeURIComponent(videoId)}`);
      if (!response.ok) return null;
      const detail = await response.json();
      // cache back into updated search data for future clicks
      setUpdatedSearchData((prev) => {
        if (!prev?.searchData) return prev;
        const nextSearchData = prev.searchData.map((c) =>
          (c.video_id || c.videoId) === videoId ? { ...c, videoDetail: detail } : c
        );
        return { ...prev, searchData: nextSearchData };
      });
      return detail;
    },
    [setUpdatedSearchData]
  );

  const validateAdjustment = (start, end, videoDuration) => {
    if (start < 0) return "Clip cannot start before 0s.";
    if (videoDuration && end > videoDuration) {
      return "End time cannot exceed the video length.";
    }
    if (end <= start) return "End time must be greater than start time.";
    if (end - start > MAX_CLIP_DURATION) {
      return `Clip length is limited to ${MAX_CLIP_DURATION / 60} minutes.`;
    }
    return null;
  };

  const openAdjustModal = async (clip, index) => {
    // Make sure we have videoDetail (filename/hls) so Cloudinary URL resolution works
    const videoDetail = await ensureVideoDetail(clip);
    const hydratedClip = videoDetail ? { ...clip, videoDetail } : clip;

    const videoDuration = getVideoDuration(hydratedClip);
    const start = Math.max(0, Math.round((hydratedClip.start ?? 0) * 100) / 100);
    const desiredEnd = Math.round((hydratedClip.end ?? start + 5) * 100) / 100;
    const end = videoDuration && desiredEnd > videoDuration ? videoDuration : desiredEnd;

    // Use pre-cached clips for instant loading
    let previewUrl = null;
    let previewWindow = null;
    let usedPreCached = false;
    try {
      const fallbackFileName = hydratedClip.videoDetail?.system_metadata?.filename;
      const sanitizedFileName =
        typeof fallbackFileName === "string"
          ? fallbackFileName.replace(/\.mp4$/i, "")
          : undefined;
      const sourceId = hydratedClip.cloudinaryId || hydratedClip.cloudinaryVideoId || sanitizedFileName;

      if (sourceId) {
        const optimalClip = getOptimalClipUrl(sourceId, start, end);
        previewUrl = optimalClip.url;
        previewWindow = {
          previewStart: optimalClip.previewStart,
          previewEnd: optimalClip.previewEnd,
          previewDuration: optimalClip.previewDuration,
        };
        usedPreCached = true;
        console.log("Using pre-cached clip:", optimalClip.isPreCached, "seekOffset:", optimalClip.seekOffset);
      } else {
        previewUrl = null;
      }
    } catch (error) {
      console.warn("Failed to generate preview URL:", error);
      previewUrl = null;
    }

    // Absolute fallback – if we still don't have a clipped preview URL, create one on the fly
    if (!previewUrl) {
      try {
        const customUrl = await getCustomCloudinaryUrl(hydratedClip, start, end);
        if (customUrl) {
          previewUrl = customUrl;
          const { buildSafeRange } = await import("@/utils/cloudinary");
          const { startRounded, endRounded } = buildSafeRange(start, end);
          previewWindow = {
            previewStart: startRounded,
            previewEnd: endRounded,
            previewDuration: endRounded - startRounded,
          };
        }
      } catch (error) {
        console.warn("Fallback Cloudinary clip failed:", error);
      }
    }

    // Final fallback: use HLS stream for full movie duration
    if (!previewUrl && hydratedClip.videoDetail?.hls?.video_url) {
      previewUrl = hydratedClip.videoDetail.hls.video_url;
      const duration = videoDuration || hydratedClip.videoDetail?.system_metadata?.duration || 180;
      previewWindow = {
        previewStart: 0,
        previewEnd: duration,
        previewDuration: duration,
      };
      console.log("Using HLS fallback for editor preview");
    }

    // If we still have no window, default to a 3-minute window around start/end
    if (!previewWindow) {
      const { buildSafeRange } = await import("@/utils/cloudinary");
      const { startRounded, endRounded } = buildSafeRange(start, end);
      previewWindow = {
        previewStart: startRounded,
        previewEnd: endRounded,
        previewDuration: endRounded - startRounded,
      };
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
    if (!adjustModalState) {
      return;
    }
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
    const sanitizedFileName =
      typeof fallbackFileName === "string"
        ? fallbackFileName.replace(/\.mp4$/i, "")
        : undefined;
    const sourceId = normalizeCloudinaryPublicId(
      clip.cloudinaryId || clip.cloudinaryVideoId || sanitizedFileName
    );

    if (!cloudName || !sourceId) {
      return null;
    }

    const roundedStart = Math.round(start * 100) / 100;
    const roundedEnd = Math.round(end * 100) / 100;

    // Include .mp4 extension for better player compatibility
    const { buildSafeRange } = await import("@/utils/cloudinary");
    const { startRounded, endRounded } = buildSafeRange(start, end);
    return `https://res.cloudinary.com/${cloudName}/video/upload/so_${startRounded},eo_${endRounded},f_mp4,fl_attachment/${sourceId}.mp4`;
  };

  /** Updates the search data with fetched video details and manages pagination tokens */
  /** Handles progress updates during video playback and stops playback at the specified end time */
  const handleProgress = (state, index, end) => {
    if (state.playedSeconds >= end && index === playingIndex) {
      setPlayingIndex(null);
    }
  };

  /** Starts playing the specified video from the given start time */
  const handlePlay = (index, start) => {
    if (playingIndex !== null && playingIndex !== index) {
      setPlayingIndex(null);
    }
    setPlayingIndex(index);
    if (playerRefs.current[index]) {
      playerRefs.current[index].seekTo(start);
      playerRefs.current[index].getInternalPlayer().play();
    }
  };

  /** Loads the next page of search results and updates the displayed data */
  const handleNextPage = async () => {
    const result = await fetchNextSearchResults();
    if (result && result.searchData) {
      const updatedData = await fetchVideoDetails(result.searchData);
      setUpdatedSearchData((prevData) => ({
        searchData: [...prevData.searchData, ...updatedData],
        pageInfo: {
          ...prevData.pageInfo,
          ...result.pageInfo,
        },
      }));
    }
  };

  /** Downloads a video clip - uses Cloudinary URLs when available, falls back to FFmpeg */
  const handleDownloadClip = async (clip, index, overrideRange) => {
    const clipKey = `${clip.video_id || clip.videoId}-${index}`;
    const startTime =
      typeof overrideRange?.start === "number" ? overrideRange.start : clip.start;
    const endTime =
      typeof overrideRange?.end === "number" ? overrideRange.end : clip.end;

    if (
      typeof startTime !== "number" ||
      typeof endTime !== "number" ||
      startTime < 0 ||
      endTime <= startTime
    ) {
      alert("Please provide a valid clip range.");
      return;
    }

    if (endTime - startTime > MAX_CLIP_DURATION) {
      alert(`Clip length cannot exceed ${MAX_CLIP_DURATION / 60} minutes.`);
      return;
    }

    // Generate filename
    const filename = `${
      clip.videoDetail?.system_metadata?.video_title ||
      clip.videoDetail?.system_metadata?.filename ||
      "clip"
    }_${Math.floor(startTime)}s-${Math.floor(endTime)}s.mp4`;

    // Start download tracking
    const downloadId = `${clipKey}-${Date.now()}`;
    startDownload(downloadId, filename);
    setDownloadingClips((prev) => ({ ...prev, [clipKey]: true }));
    setClipProgress((prev) => ({ ...prev, [clipKey]: 0 }));

    try {
      let clipUrlCandidate = clip.clipUrl;
      let useCloudinaryFlow = Boolean(clipUrlCandidate);

      if (overrideRange || !clipUrlCandidate) {
        const customUrl = await getCustomCloudinaryUrl(clip, startTime, endTime);
        if (customUrl) {
          clipUrlCandidate = customUrl;
          useCloudinaryFlow = true;
        } else if (overrideRange && !clip.videoDetail?.hls?.video_url) {
          throw new Error(
            "Unable to generate a Cloudinary URL for this clip. Try the standard download."
          );
        }
      }

      if (useCloudinaryFlow && clipUrlCandidate) {
        // Remove fl_attachment from URL (Cloudinary processes it asynchronously)
        // Fetch the video as a blob to hide the URL from browser
        const downloadUrl = clipUrlCandidate
          .replace(/,fl_attachment/g, "")
          .replace(/fl_attachment,/g, "");
        
        // Fetch the video as a blob
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
        }
        
        // Track download progress
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        
        // Start with small progress to show activity
        updateProgress(downloadId, 5);
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          chunks.push(value);
          received += value.length;
          
          // Update progress if we know the total size
          if (total > 0) {
            const progress = Math.max(5, Math.min(95, Math.round((received / total) * 100)));
            setClipProgress((prev) => ({ ...prev, [clipKey]: progress }));
            updateProgress(downloadId, progress);
          } else {
            // If we don't know total, show progress based on chunks received
            // Estimate: assume average clip is ~10MB, show progress up to 95%
            const estimatedProgress = Math.min(95, 5 + (received / 10000000) * 90);
            updateProgress(downloadId, Math.round(estimatedProgress));
          }
        }
        
        // Set to 100% when done
        updateProgress(downloadId, 100);
        
        // Create blob from chunks
        const blob = new Blob(chunks, { type: 'video/mp4' });
        const blobUrl = window.URL.createObjectURL(blob);
        
        // Trigger download
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up blob URL after a short delay
        setTimeout(() => {
          window.URL.revokeObjectURL(blobUrl);
        }, 100);
        
        completeDownload(downloadId);
        return;
      }

      // Fallback: use server-side clipper API when clipUrl is unavailable
      const videoId = clip.video_id || clip.videoId;
      const videoUrl = clip.videoDetail?.hls?.video_url;
      if (!videoId || !videoUrl) {
        throw new Error("Missing video information");
      }

      setClipProgress((prev) => ({ ...prev, [clipKey]: 0 }));
      updateProgress(downloadId, 0);

      const apiUrl = `/api/download-clip?videoId=${encodeURIComponent(videoId)}&start=${encodeURIComponent(
        startTime
      )}&end=${encodeURIComponent(endTime)}&videoUrl=${encodeURIComponent(videoUrl)}`;

      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error("Failed to download clip");
      }

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
    } catch (error) {
      console.error("Error downloading clip:", error);
      failDownload(downloadId, error);
      alert(`Failed to download clip: ${error.message}. Please ensure you're using a modern browser (Chrome, Firefox, or Edge) with HTTPS.`);
    } finally {
      setDownloadingClips((prev) => ({ ...prev, [clipKey]: false }));
      setClipProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[clipKey];
        return newProgress;
      });
    }
  };


  /** Cleanup: Stop all videos when switching */
  useEffect(() => {
    // When playingIndex changes, ensure only one video is playing
    if (playingIndex !== null) {
      // This effect ensures proper cleanup when switching
      return () => {
        // Cleanup happens in individual components
      };
    }
  }, [playingIndex]);

  /** Resets search data and fetches updated results when searchResultData changes */
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

      const rawResults =
        searchResultData.searchData || searchResultData.textSearchResults || [];
      const nextToken =
        searchResultData.pageInfo?.next_page_token ||
        searchResultData.pageInfo?.nextPageToken ||
        null;

      if (!rawResults.length) {
        if (!cancelled) {
          setUpdatedSearchData({ ...searchResultData, searchData: [] });
          setNextPageToken(nextToken);
          setNextPageLoading(false);
          setError(null);
        }
        return;
      }

      if (!cancelled) {
        setNextPageLoading(true);
        setError(null);
      }

      try {
        const updatedData = await fetchVideoDetails(rawResults);
        if (cancelled) {
          return;
        }
        setUpdatedSearchData({
          ...searchResultData,
          searchData: updatedData,
        });
        setNextPageToken(nextToken);
      } catch (processingError) {
        if (!cancelled) {
          setError(processingError.message);
        }
      } finally {
        if (!cancelled) {
          setNextPageLoading(false);
        }
      }
    };

    processSearchResults();

    return () => {
      cancelled = true;
    };
  }, [searchResultData, fetchVideoDetails, setUpdatedSearchData, setNextPageToken, setNextPageLoading, setError]);

  /** Triggers loading the next page when the observer element comes into view and a next page token exists */
  useEffect(() => {
    if (inView && nextPageToken) {
      handleNextPage();
    }
  }, [inView, nextPageToken]);

  if (nextPageLoading && !updatedSearchData?.searchData?.length) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50">
        <div className="bg-gray-950 rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4 border border-gray-800">
          <LoadingSpinner size="lg" color="primary" />
          <p className="text-slate-300 font-medium">Loading search results...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorFallback message={error} />;
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap -mx-3">
        {updatedSearchData?.searchData?.map((clip, index) => {
          const confidenceLabel = clip.confidenceLabel;
          const isNarrationActive = Boolean(activeClipId && clip?.id && activeClipId === clip.id);
          return (
            <div
              key={clip?.video_id + "-" + index}
              className="w-full sm:w-1/2 lg:w-1/3 px-3 mb-6"
            >
              <div
                className={clsx(
                  "group relative bg-gray-950 rounded-xl shadow-md hover:shadow-xl border border-gray-800/60 overflow-hidden transition-all duration-300 hover:-translate-y-1",
                  isNarrationActive && "border-amber-500/70 shadow-amber-500/20 ring-2 ring-amber-400/50"
                )}
              >
                {(clip.videoDetail?.hls?.video_url || clip.clipUrl) && (
                  <>
                  <div className="w-full aspect-video relative overflow-hidden bg-gray-900">
                    {/* Prioritize HLS Video Player for Twelve Labs HLS streams */}
                    {clip.videoDetail?.hls?.video_url ? (
                      <HLSVideoPlayer
                        hlsUrl={clip.videoDetail.hls.video_url}
                        thumbnailUrl={clip.thumbnail_url || clip.thumbnailUrl}
                        startTime={Math.floor(clip.start || 0)}
                        endTime={Math.floor(clip.end || 0)}
                        isPlaying={playingIndex === index}
                        muted={mutePlayback}
                        onPlay={() => {
                          // Stop any other playing videos first
                          if (playingIndex !== null && playingIndex !== index) {
                            setPlayingIndex(null);
                            // Small delay to ensure cleanup
                            setTimeout(() => {
                              setClickedThumbnailIndex(index);
                              setPlayingIndex(index);
                            }, 50);
                          } else {
                            setClickedThumbnailIndex(index);
                            setPlayingIndex(index);
                          }
                        }}
                        onPause={() => {
                          if (playingIndex === index) {
                            setPlayingIndex(null);
                          }
                        }}
                        onEnded={() => {
                          setPlayingIndex(null);
                        }}
                      />
                    ) : clip.clipUrl ? (
                      /* Use ReactPlayer for Cloudinary MP4 clips (when no HLS URL available) */
                      <>
                        <div
                          className="w-full h-full relative"
                          onClick={() => {
                            if (playingIndex === index) {
                              // If this video is playing, pause it
                              if (playerRefs.current[index]) {
                                playerRefs.current[index].getInternalPlayer()?.pause();
                              }
                              setPlayingIndex(null);
                            }
                          }}
                        >
                          <ReactPlayer
                            ref={(el) => (playerRefs.current[index] = el)}
                            url={clip.clipUrl}
                            controls={false}
                            width="100%"
                            height="100%"
                            playing={playingIndex === index}
                            muted={mutePlayback}
                            volume={mutePlayback ? 0 : 1}
                            onPlay={() => {
                              // Stop any other playing videos first
                              if (playingIndex !== null && playingIndex !== index) {
                                setPlayingIndex(null);
                                setTimeout(() => {
                                  setClickedThumbnailIndex(index);
                                  setPlayingIndex(index);
                                }, 50);
                              } else {
                                setClickedThumbnailIndex(index);
                                setPlayingIndex(index);
                              }
                            }}
                            onPause={() => {
                              if (playingIndex === index) {
                                setPlayingIndex(null);
                              }
                            }}
                            onClickPreview={() => {
                              if (playingIndex !== index) {
                                setClickedThumbnailIndex(index);
                                setPlayingIndex(index);
                              }
                            }}
                            light={playingIndex !== index ? (
                              <img
                                src={clip.thumbnail_url || clip.thumbnailUrl}
                                className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
                                alt="thumbnail"
                              />
                            ) : false}
                            config={{
                              file: {
                                attributes: {
                                  preload: "auto",
                                },
                              },
                            }}
                            progressInterval={100}
                          />
                        </div>
                        {playingIndex === index && clip.end && clip.start && (
                          <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-md pointer-events-none">
                            <p className="text-white text-xs font-medium">
                              {formatTimestamp(Math.floor((clip.end || 0) - (clip.start || 0)))}
                            </p>
                          </div>
                        )}
                      </>
                    ) : null}
                    {confidenceLabel && (
                      <div className="absolute top-3 left-3">
                        <div className={getConfidenceBadgeClasses(confidenceLabel)}>
                          <p className="text-xs font-bold capitalize">
                            {confidenceLabel}
                          </p>
                        </div>
                      </div>
                    )}
                  {isNarrationActive && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-amber-400 text-black text-xs font-semibold px-3 py-1 rounded-full shadow-lg">
                      <span role="img" aria-label="Narrating">
                        🎙️
                      </span>
                      <span>Narrating</span>
                    </div>
                  )}
                  </div>
                  <div className="p-4">
                    <p
                      className={clsx(
                        "text-sm font-medium text-slate-100 truncate mb-2",
                      )}
                      title={clip.videoDetail?.system_metadata?.video_title || clip.videoDetail?.system_metadata?.filename || "Video Clip"}
                    >
                      {clip.videoDetail?.system_metadata?.video_title || clip.videoDetail?.system_metadata?.filename || "Video Clip"}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Clip {Math.floor(clip.start)}s - {Math.floor(clip.end)}s</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {onClipSelect && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (typeof isClipDisabled === "function" && isClipDisabled(clip, index)) {
                                return;
                              }
                              onClipSelect(clip, index);
                            }}
                            disabled={typeof isClipDisabled === "function" ? isClipDisabled(clip, index) : false}
                            title={
                              typeof getClipDisabledReason === "function" && typeof isClipDisabled === "function" && isClipDisabled(clip, index)
                                ? getClipDisabledReason(clip, index) || "Selection not allowed"
                                : "Select this clip"
                            }
                            className={clsx(
                              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                              (typeof isClipDisabled === "function" && isClipDisabled(clip, index))
                                ? "bg-slate-800/60 text-slate-500 cursor-not-allowed"
                                : selectedClipId === `${clip.video_id || clip.videoId}-${index}`
                                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                                : "bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50"
                            )}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>
                              {typeof isClipDisabled === "function" && isClipDisabled(clip, index) ? "Blocked" : "Select"}
                            </span>
                          </button>
                        )}
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
                              {clip.clipUrl ? (
                                // Cloudinary download is instant, just show brief loading
                                <>
                                  <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>Downloading...</span>
                                </>
                              ) : (
                                // FFmpeg fallback shows progress
                                <>
                                  <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>
                                    {clipProgress[`${clip.video_id || clip.videoId}-${index}`] !== undefined
                                      ? `Processing ${Math.round(clipProgress[`${clip.video_id || clip.videoId}-${index}`])}%`
                                      : 'Downloading...'}
                                  </span>
                                </>
                              )}
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
                  </>
                )}
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
            <button
              onClick={closeAdjustModal}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-100 transition-colors"
              aria-label="Close"
            >
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
                (adjustModalState.clip?.videoDetail?.width &&
                adjustModalState.clip?.videoDetail?.height
                  ? adjustModalState.clip.videoDetail.width /
                    adjustModalState.clip.videoDetail.height
                  : 16 / 9)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchResultList;
