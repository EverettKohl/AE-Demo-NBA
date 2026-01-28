import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactPlayer from "react-player/file";
import clsx from "clsx";

const MAX_CLIP_DURATION = 180; // 3 minutes in seconds
const DEFAULT_PREVIEW_WINDOW_DURATION = 180; // 3 minutes preview window

/**
 * Format seconds to MM:SS format
 */
const formatTime = (seconds) => {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return "0:00";
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const secs = wholeSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

/**
 * Clamp a value between min and max
 */
const clampValue = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

/**
 * Calculate preview window centered on the current clip
 * @param {number} clipStart - Start time of the original clip
 * @param {number} clipEnd - End time of the original clip
 * @param {number} videoDuration - Total duration of the video
 * @param {number} windowDuration - Duration of the preview window (default 180s)
 * @returns {Object} { previewStart, previewEnd, previewDuration }
 */
export const calculatePreviewWindow = (clipStart, clipEnd, videoDuration, windowDuration = DEFAULT_PREVIEW_WINDOW_DURATION) => {
  const clipCenter = (clipStart + clipEnd) / 2;
  const halfWindow = windowDuration / 2;
  
  // Try to center the clip
  let previewStart = clipCenter - halfWindow;
  let previewEnd = clipCenter + halfWindow;
  
  // If video is shorter than window duration, use full video
  if (videoDuration < windowDuration) {
    return {
      previewStart: 0,
      previewEnd: videoDuration,
      previewDuration: videoDuration,
    };
  }
  
  // Handle edge cases - adjust to still get full window when possible
  if (previewStart < 0) {
    previewStart = 0;
    previewEnd = Math.min(videoDuration, windowDuration);
  } else if (previewEnd > videoDuration) {
    previewEnd = videoDuration;
    previewStart = Math.max(0, videoDuration - windowDuration);
  }
  
  const previewDuration = previewEnd - previewStart;
  
  return {
    previewStart: Math.round(previewStart * 100) / 100,
    previewEnd: Math.round(previewEnd * 100) / 100,
    previewDuration: Math.round(previewDuration * 100) / 100,
  };
};

/**
 * ClipEditor Component
 * Simple, standard video editor - no complex logic
 */
const ClipEditor = ({
  clip,
  videoDetail,
  previewUrl,
  initialStart,
  initialEnd,
  videoDuration,
  onDownload = null,
  onCancel,
  getCustomCloudinaryUrl,
  isPart1 = false,
  fixedDuration = null,
  fixedDurationTolerance = null,
  onSave = null,
  previewWindowDuration = DEFAULT_PREVIEW_WINDOW_DURATION,
  previewWindowOverride = null,
  aspectRatio = 16 / 9,
}) => {
  // Simple state
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(null); // 'start', 'end', or null
  const [isTimelineDragging, setIsTimelineDragging] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [error, setError] = useState(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isInitialSeekReady, setIsInitialSeekReady] = useState(false);
  const [isSeekInProgress, setIsSeekInProgress] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null); // Current video URL - start null until warmed
  const [isSeekable, setIsSeekable] = useState(false); // Track if video is actually seekable
  const [videoType, setVideoType] = useState('unknown'); // 'cloudinary', 'hls', or 'unknown'
  const [warmingStatus, setWarmingStatus] = useState('idle'); // 'idle', 'warming', 'ready', 'fallback'
  
  // Simple refs
  const playerRef = useRef(null);
  const timelineRef = useRef(null);
  const actualVideoDurationRef = useRef(null); // Store actual video duration from player
  const isSeekingRef = useRef(false); // Track when we're seeking to prevent progress interference
  const lastSeekedTimeRef = useRef(null); // Track the last position we sought to
  const loadingTimeoutRef = useRef(null); // Ref for loading timeout
  const isVideoReadyRef = useRef(false); // Ref to track video ready state for timeout checks
  const pendingSeekRef = useRef(null); // Store pending seek request if player isn't ready yet
  const warmingAbortRef = useRef(null); // Ref for aborting warming requests
  const initialSeekAppliedRef = useRef(false); // Track whether we've successfully seeked to clip start
  
  // Detect video type from URL
  const detectVideoType = useCallback((url) => {
    if (!url) return 'unknown';
    if (url.includes('cloudinary.com') && url.includes('video/upload')) {
      return 'cloudinary';
    }
    if (url.includes('.m3u8') || url.includes('hls')) {
      return 'hls';
    }
    if (url.includes('.mp4')) {
      return 'mp4';
    }
    return 'unknown';
  }, []);
  
  // Pre-warm a Cloudinary URL by making a HEAD request
  // This triggers Cloudinary's CDN to generate/cache the video
  const warmVideoUrl = useCallback(async (url, signal) => {
    const maxRetries = 3;
    const timeout = 8000; // 8 seconds per attempt
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Warming video URL (attempt ${attempt}/${maxRetries}):`, url.substring(0, 100) + '...');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        // Combine with external signal
        if (signal?.aborted) {
          throw new Error('Warming cancelled');
        }
        signal?.addEventListener('abort', () => controller.abort());
        
        // Make a HEAD request to trigger CDN processing
        // If the video isn't cached, this will trigger Cloudinary to generate it
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          mode: 'cors',
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          // Check content-length to verify video is ready
          const contentLength = response.headers.get('content-length');
          console.log(`✓ Video warmed successfully (attempt ${attempt}), size:`, contentLength);
          return { success: true, contentLength };
        } else if (response.status === 404) {
          console.warn(`Video not found (404) on attempt ${attempt}`);
          // 404 means the video doesn't exist - don't retry
          return { success: false, error: 'Video not found' };
        } else {
          console.warn(`Warming failed with status ${response.status} on attempt ${attempt}`);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log(`Warming request timed out or cancelled on attempt ${attempt}`);
        } else {
          console.warn(`Warming error on attempt ${attempt}:`, err.message);
        }
      }
      
      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return { success: false, error: 'Max retries exceeded' };
  }, []);
  
  // Use previewWindowOverride if provided (for pre-cached clips), otherwise calculate
  const previewWindow = previewWindowOverride || calculatePreviewWindow(initialStart, initialEnd, videoDuration, previewWindowDuration);
  const previewDuration = previewWindow.previewDuration;
  const clipAbsoluteStart = Math.max(0, initialStart || previewWindow.previewStart);
  const relativeClipStart = clampValue(
    clipAbsoluteStart - previewWindow.previewStart,
    0,
    previewDuration || MAX_CLIP_DURATION
  );
  
  // Debug log for preview window
  console.log('ClipEditor previewWindow:', previewWindow, 'initialStart:', initialStart, 'initialEnd:', initialEnd);
  
  // Reset state when preview URL changes and warm up the video
  useEffect(() => {
    const detectedType = detectVideoType(previewUrl);
    const hlsUrl = videoDetail?.hls?.video_url || null;
    const useHlsFirst = Boolean(hlsUrl);
    const initialPlaybackUrl = useHlsFirst ? hlsUrl : previewUrl;
    const initialPlaybackType = useHlsFirst ? 'hls' : detectedType;
    console.log('ClipEditor initialized with URL:', initialPlaybackUrl, 'Type:', initialPlaybackType);
    
    // Reset all state
    setIsVideoReady(false);
    isVideoReadyRef.current = false;
    setIsPlaying(false);
    setCurrentTime(relativeClipStart);
    setStartTime(clipAbsoluteStart);
    setEndTime(initialEnd);
    setError(null);
    setVideoUrl(null); // Start with null - will be set after source selection
    setIsSeekable(false);
    setVideoType(initialPlaybackType);
    setWarmingStatus('idle');
    actualVideoDurationRef.current = null;
    isSeekingRef.current = false;
    lastSeekedTimeRef.current = relativeClipStart;
    pendingSeekRef.current = clipAbsoluteStart;
    initialSeekAppliedRef.current = false;
    setIsInitialSeekReady(false);
    setIsSeekInProgress(true);
    initialSeekAppliedRef.current = false;
    
    // Abort any in-progress warming
    if (warmingAbortRef.current) {
      warmingAbortRef.current.abort();
    }
    
    // Clear any existing timeout
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    
    if (!initialPlaybackUrl) return;
    
    // Create abort controller for this warming session
    const abortController = new AbortController();
    warmingAbortRef.current = useHlsFirst ? null : abortController;
    
    const warmAndLoad = async () => {
      const isCloudinaryUrl = initialPlaybackType === 'cloudinary';
      const isPreCachedClip = !!previewWindowOverride;
      
      if (useHlsFirst) {
        // Prefer HLS playback for reliability
        setWarmingStatus('ready');
        setVideoUrl(initialPlaybackUrl);
        actualVideoDurationRef.current = videoDuration || null;
        pendingSeekRef.current = clipAbsoluteStart;
        setIsSeekInProgress(true);
        setTimeout(() => {
          if (pendingSeekRef.current !== null) {
            performSeek(pendingSeekRef.current);
          }
        }, 200);
        return;
      }
      
      // Pre-cached clips are already warmed—load immediately but still set a timeout
      if (isCloudinaryUrl && isPreCachedClip) {
        setWarmingStatus('ready');
        setVideoUrl(previewUrl);
        
        // Still set a loading timeout for pre-cached clips in case they fail
        loadingTimeoutRef.current = setTimeout(() => {
          if (!isVideoReadyRef.current && !abortController.signal.aborted) {
            console.warn("Pre-cached clip loading timeout - falling back to HLS");
            // Try HLS fallback
            const hlsUrl = videoDetail?.hls?.video_url;
            if (hlsUrl && hlsUrl !== previewUrl) {
              setVideoUrl(hlsUrl);
              setVideoType('hls');
              setWarmingStatus('fallback');
              setError("Cloudinary preview timed out, using HLS stream.");
              actualVideoDurationRef.current = videoDuration || null;
              pendingSeekRef.current = clipAbsoluteStart;
              initialSeekAppliedRef.current = false;
              setIsInitialSeekReady(false);
              setIsSeekInProgress(true);
            } else {
              setError("Video loading slowly. You can still try to seek and play.");
              setIsVideoReady(true);
              isVideoReadyRef.current = true;
              setIsSeekInProgress(false);
            }
          }
        }, 10000); // 10 seconds for pre-cached clips (should be fast since pre-warmed)
        return;
      }

      if (isCloudinaryUrl) {
        // For Cloudinary URLs, warm up before loading
        setWarmingStatus('warming');
        
        const result = await warmVideoUrl(previewUrl, abortController.signal);
        
        // Check if we were cancelled
        if (abortController.signal.aborted) {
          console.log('Warming was cancelled');
          return;
        }
        
        if (result.success) {
          console.log('✓ Cloudinary URL warmed and ready');
          setWarmingStatus('ready');
          setVideoUrl(previewUrl);
        } else {
          // Warming failed - for pre-cached clips, try loading anyway (they're pre-warmed)
          if (isPreCachedClip) {
            console.log('Pre-cached clip warming check failed, loading anyway (clip should be cached)');
            setWarmingStatus('ready');
            setVideoUrl(previewUrl);
          } else {
            // For non-pre-cached clips, try loading anyway
            console.warn('Cloudinary warming failed, trying to load anyway...');
            setWarmingStatus('ready');
            setVideoUrl(previewUrl);
          }
        }
      } else {
        // For non-Cloudinary URLs, load directly
        setWarmingStatus('ready');
        setVideoUrl(previewUrl);
      }
      
      // Set a loading timeout for after the video URL is set (skip for pre-cached)
      if (!isPreCachedClip) {
        loadingTimeoutRef.current = setTimeout(() => {
          if (!isVideoReadyRef.current && !abortController.signal.aborted) {
            console.warn("Video loading timeout after warming");
            setError("Video loading slowly. You can still try to seek and play.");
            setIsVideoReady(true);
            isVideoReadyRef.current = true;
            setIsSeekInProgress(false);
          }
        }, 15000); // 15 seconds after warming completes
      }
    };
    
    warmAndLoad();
    
    return () => {
      abortController.abort();
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [previewUrl, initialStart, initialEnd, videoDetail, detectVideoType, warmVideoUrl, clipAbsoluteStart]);

  // For Part 2 clips with fixed duration
  useEffect(() => {
    if (fixedDuration !== null && fixedDuration > 0) {
      const newEnd = startTime + fixedDuration;
      if (newEnd <= previewWindow.previewEnd && Math.abs(endTime - newEnd) > 0.01) {
        setEndTime(newEnd);
      } else if (newEnd > previewWindow.previewEnd) {
        const adjustedStart = previewWindow.previewEnd - fixedDuration;
        if (adjustedStart >= previewWindow.previewStart && Math.abs(startTime - adjustedStart) > 0.01) {
          setStartTime(adjustedStart);
          setEndTime(previewWindow.previewEnd);
        }
      }
    }
  }, [startTime, fixedDuration, previewWindow.previewEnd, endTime]);
  
  // Update timeline width on mount and resize
  useEffect(() => {
    const updateWidth = () => {
      if (timelineRef.current) {
        setTimelineWidth(timelineRef.current.offsetWidth);
      }
    };
    
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);
  
  // Convert time to pixel position
  const timeToPosition = useCallback((time) => {
    if (!previewDuration || !timelineWidth) return 0;
    const relativeTime = time - previewWindow.previewStart;
    return (relativeTime / previewDuration) * timelineWidth;
  }, [previewDuration, timelineWidth, previewWindow.previewStart]);
  
  // Convert pixel position to time
  // Returns absolute time within the preview window (previewStart to previewEnd)
  const positionToTime = useCallback((position) => {
    if (!previewDuration || !timelineWidth) return previewWindow.previewStart;
    
    // Clamp to timeline width (0 to timelineWidth)
    const clampedPosition = clampValue(position, 0, timelineWidth);
    
    // Convert to relative time (0 to previewDuration)
    const relativeTime = (clampedPosition / timelineWidth) * previewDuration;
    
    // Convert to absolute time
    const absoluteTime = previewWindow.previewStart + relativeTime;
    
    // Clamp to preview window bounds
    return clampValue(
      absoluteTime,
      previewWindow.previewStart,
      previewWindow.previewEnd
    );
  }, [previewDuration, timelineWidth, previewWindow]);
  
  // Validate clip range
  const validateRange = useCallback((start, end) => {
    if (start < previewWindow.previewStart) {
      return "Start time cannot be before preview window";
    }
    if (end > previewWindow.previewEnd) {
      return "End time cannot be after preview window";
    }
    if (end <= start) {
      return "End time must be greater than start time";
    }
    if (fixedDuration !== null && fixedDuration > 0) {
      const actual = end - start;
      const tol =
        typeof fixedDurationTolerance === "number" && isFinite(fixedDurationTolerance) && fixedDurationTolerance >= 0
          ? fixedDurationTolerance
          : 0.01;
      if (Math.abs(actual - fixedDuration) > tol) {
        return `Duration must stay locked to ${fixedDuration.toFixed(2)}s (±${tol.toFixed(3)}s)`;
      }
    }
    if (end - start > MAX_CLIP_DURATION) {
      return `Clip length cannot exceed ${MAX_CLIP_DURATION / 60} minutes`;
    }
    return null;
  }, [previewWindow, fixedDuration, fixedDurationTolerance]);
  
  // Update start time
  const updateStartTime = useCallback((newStart) => {
    if (fixedDuration !== null && fixedDuration > 0) {
      const maxStart = previewWindow.previewEnd - fixedDuration;
      const clamped = clampValue(newStart, previewWindow.previewStart, maxStart);
      setStartTime(clamped);
      setEndTime(clamped + fixedDuration);
      setError(validateRange(clamped, clamped + fixedDuration));
    } else {
      const clamped = clampValue(newStart, previewWindow.previewStart, endTime - 0.1);
      setStartTime(clamped);
      setError(validateRange(clamped, endTime));
    }
  }, [endTime, previewWindow, validateRange, fixedDuration]);
  
  // Update end time
  const updateEndTime = useCallback((newEnd) => {
    if (fixedDuration !== null && fixedDuration > 0) {
      const newStart = newEnd - fixedDuration;
      if (newStart >= previewWindow.previewStart) {
        setStartTime(newStart);
        setEndTime(newEnd);
        setError(validateRange(newStart, newEnd));
      }
    } else {
      const clamped = clampValue(newEnd, startTime + 0.1, previewWindow.previewEnd);
      setEndTime(clamped);
      setError(validateRange(startTime, clamped));
    }
  }, [startTime, previewWindow, validateRange, fixedDuration]);
  
  // Helper function to get the underlying video element
  const getVideoElement = useCallback(() => {
    if (!playerRef.current) return null;
    
    try {
      // ReactPlayer wraps the video element, try to access it
      const internalPlayer = playerRef.current.getInternalPlayer();
      if (internalPlayer) {
        // For file player, it's the video element directly
        if (internalPlayer.tagName === 'VIDEO') {
          return internalPlayer;
        }
        // For HLS.js player
        if (internalPlayer.media) {
          return internalPlayer.media;
        }
        // For HLS player, it might be in a different structure
        if (internalPlayer.video) {
          return internalPlayer.video;
        }
        // Try to find video element in the player's DOM
        const container = playerRef.current.wrapper;
        if (container) {
          const video = container.querySelector('video');
          if (video) return video;
        }
      }
    } catch (err) {
      console.warn('Failed to get video element:', err);
    }
    
    return null;
  }, []);
  
  // Check if video is seekable and set the state
  const checkSeekable = useCallback(() => {
    const videoElement = getVideoElement();
    if (!videoElement) {
      console.log('checkSeekable: No video element found');
      return false;
    }
    
    // Check seekable TimeRanges
    const seekable = videoElement.seekable;
    if (seekable && seekable.length > 0) {
      // Only log once when first becoming seekable
      if (!isSeekable) {
        const seekableStart = seekable.start(0);
        const seekableEnd = seekable.end(0);
        console.log('✓ Video now seekable, range:', seekableStart, '-', seekableEnd, 'Duration:', videoElement.duration);
      }
      setIsSeekable(true);
      return true;
    }
    
    // For some videos, seekable might be empty but duration is available
    if (videoElement.duration && isFinite(videoElement.duration) && videoElement.duration > 0) {
      console.log('Video has duration, assuming seekable:', videoElement.duration);
      setIsSeekable(true);
      return true;
    }
    
    console.log('Video not yet seekable, duration:', videoElement.duration, 'readyState:', videoElement.readyState);
    return false;
  }, [getVideoElement]);
  
  // Helper function to perform seek with retry logic and direct video element access
  // Expects targetAbsoluteTime in original video coordinates
  const performSeek = useCallback((targetAbsoluteTime) => {
    console.log('=== performSeek START ===');
    console.log('targetAbsoluteTime:', targetAbsoluteTime);
    console.log('previewDuration:', previewDuration);
    console.log('actualDuration:', actualVideoDurationRef.current);
    console.log('videoUrl:', videoUrl);
    console.log('videoType:', videoType);
    console.log('isSeekable:', isSeekable);
    
    const maxTime = videoType === 'hls'
      ? (actualVideoDurationRef.current || videoDuration || previewWindow.previewEnd)
      : (actualVideoDurationRef.current || previewDuration);
    
    // Convert absolute time into player-local time
    const playerTime = videoType === 'hls'
      ? targetAbsoluteTime
      : targetAbsoluteTime - previewWindow.previewStart;
    
    const clampedPlayerTime = Math.max(0, Math.min(maxTime, playerTime));
    console.log('clampedPlayerTime:', clampedPlayerTime, 'maxTime:', maxTime);
    
    // Mark that we're seeking and store the seeked position
    isSeekingRef.current = true;
    lastSeekedTimeRef.current = targetAbsoluteTime - previewWindow.previewStart;
    setCurrentTime(targetAbsoluteTime - previewWindow.previewStart);
    
    setIsSeekInProgress(true);
    // Try to seek - ReactPlayer might not be ready yet, so we'll retry multiple times
    let retryCount = 0;
    const maxRetries = 10;
    
    const attemptSeek = () => {
      console.log(`Seek attempt ${retryCount + 1}/${maxRetries}`);
      
      if (!playerRef.current) {
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`Player ref not available, will retry in 250ms...`);
          setTimeout(attemptSeek, 250);
        } else {
          pendingSeekRef.current = targetAbsoluteTime;
          console.log('Max retries reached, storing pending seek:', targetAbsoluteTime);
        }
        return;
      }
      
      // Try to get the underlying video element for direct seeking
      const videoElement = getVideoElement();
      console.log('Video element found:', !!videoElement);
      
      if (videoElement) {
        console.log('Video element state:', {
          readyState: videoElement.readyState,
          duration: videoElement.duration,
          currentTime: videoElement.currentTime,
          seekable: videoElement.seekable?.length > 0 ? `${videoElement.seekable.start(0)}-${videoElement.seekable.end(0)}` : 'none',
          buffered: videoElement.buffered?.length > 0 ? `${videoElement.buffered.start(0)}-${videoElement.buffered.end(0)}` : 'none',
          networkState: videoElement.networkState,
          paused: videoElement.paused,
        });
      }
      
      try {
        // Try to get duration from multiple sources
        let duration = null;
        
        // Try ReactPlayer first
        try {
          duration = playerRef.current.getDuration();
          if (!duration || !isFinite(duration) || duration <= 0) {
            duration = null;
          }
        } catch (durErr) {
          console.warn('getDuration() failed:', durErr);
        }
        
        // Fall back to video element
        if (!duration && videoElement && videoElement.duration && isFinite(videoElement.duration) && videoElement.duration > 0) {
          duration = videoElement.duration;
          console.log('Using video element duration:', duration);
        }
        
        // Fall back to actualVideoDurationRef
        if (!duration && actualVideoDurationRef.current) {
          duration = actualVideoDurationRef.current;
          console.log('Using actualVideoDurationRef:', duration);
        }
        
        // Last resort: use previewDuration
        if (!duration) {
          duration = previewDuration;
          console.log('Using previewDuration as fallback:', duration);
        }
        
        console.log('Final duration for seeking:', duration);
        
        // Check if video is seekable yet
        if (videoElement) {
          const seekable = videoElement.seekable;
          if (seekable && seekable.length > 0) {
            const seekableEnd = seekable.end(0);
            if (clampedPlayerTime > seekableEnd) {
              console.warn(`Seek position ${clampedPlayerTime} is beyond seekable range (0-${seekableEnd})`);
              // Still try to seek, but it might not work
            }
          }
        }
        
        // Calculate seek time
        const seekTime = Math.min(clampedPlayerTime, duration);
        console.log('Attempting to seek to:', seekTime, 'seconds');
        
        let seekSucceeded = false;
        
        // Method 1: Direct video element currentTime (most reliable)
        if (!seekSucceeded && videoElement && videoElement.readyState >= 1) {
          try {
            const beforeTime = videoElement.currentTime;
            videoElement.currentTime = seekTime;
            // Check if seek was accepted
            const afterTime = videoElement.currentTime;
            if (Math.abs(afterTime - seekTime) < 1 || afterTime !== beforeTime) {
              console.log('✓ Seek via video element succeeded:', beforeTime, '->', afterTime, '(target:', seekTime, ')');
              seekSucceeded = true;
              pendingSeekRef.current = null;
              setIsSeekable(true);
            } else {
              console.log('Video element seek did not change time, beforeTime:', beforeTime, 'afterTime:', afterTime);
            }
          } catch (err) {
            console.warn('Direct video element seek failed:', err);
          }
        }
        
        // Method 2: ReactPlayer seekTo with seconds
        if (!seekSucceeded) {
          try {
            playerRef.current.seekTo(seekTime, 'seconds');
            console.log('✓ Seek via ReactPlayer (seconds):', seekTime);
            seekSucceeded = true;
            pendingSeekRef.current = null;
          } catch (err) {
            console.warn('ReactPlayer seekTo(seconds) failed:', err);
          }
        }
        
        // Method 3: ReactPlayer seekTo with fraction
        if (!seekSucceeded && duration > 0) {
          try {
            const fraction = Math.max(0, Math.min(1, seekTime / duration));
            playerRef.current.seekTo(fraction);
            console.log('✓ Seek via ReactPlayer (fraction):', fraction);
            seekSucceeded = true;
            pendingSeekRef.current = null;
          } catch (err) {
            console.warn('ReactPlayer seekTo(fraction) failed:', err);
          }
        }
        
        // If all methods failed, retry
        if (seekSucceeded) {
          if (!initialSeekAppliedRef.current) {
            initialSeekAppliedRef.current = true;
            setIsInitialSeekReady(true);
          }
          setIsSeekInProgress(false);
          return;
        }
        if (!seekSucceeded) {
          console.warn(`All seek methods failed on attempt ${retryCount + 1}`);
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(attemptSeek, 250);
          } else {
            console.error('Max seek retries reached, storing as pending');
            pendingSeekRef.current = targetAbsoluteTime;
            setError('Seeking not available for this video. Try playing first.');
            setIsSeekInProgress(false);
          }
        }
      } catch (err) {
        console.warn('Seek attempt failed:', err);
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(attemptSeek, 250);
        } else {
          console.error('Max seek retries reached');
          pendingSeekRef.current = targetAbsoluteTime;
          setIsSeekInProgress(false);
        }
      }
    };
    
    attemptSeek();
    
    // Clear seeking flag after seek completes
    setTimeout(() => {
      isSeekingRef.current = false;
    }, 500);
  }, [previewDuration, getVideoElement, videoUrl, videoType, isSeekable, previewWindow.previewStart, videoDuration]);
  
  // Keep nudging the HLS player to the clip start until the seek sticks
  useEffect(() => {
    if (!videoUrl || videoType !== 'hls') return;
    let attempts = 0;
    const maxAttempts = 20;
    const intervalId = setInterval(() => {
      if (initialSeekAppliedRef.current || attempts >= maxAttempts) {
        clearInterval(intervalId);
        return;
      }
      attempts += 1;
      pendingSeekRef.current = clipAbsoluteStart;
      performSeek(clipAbsoluteStart);
    }, 300);
    return () => clearInterval(intervalId);
  }, [videoUrl, videoType, clipAbsoluteStart, performSeek]);
  
  // Simple timeline click - just seek
  const handleTimelineClick = useCallback((e) => {
    if (!timelineRef.current || isDragging || !videoUrl) {
      return;
    }
    
    // Always allow seeking if we have a video URL - don't wait for full load
    // The video will start loading from the seeked position
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedTime = positionToTime(x);
    
    // clickedTime is absolute time (previewStart to previewEnd)
    performSeek(clickedTime);
  }, [isDragging, positionToTime, performSeek]);
  
  // Handle marker drag start
  const handleDragStart = useCallback((marker) => {
    setIsDragging(marker);
    setIsPlaying(false);
  }, []);
  
  // Handle marker drag
  const handleDrag = useCallback((e) => {
    if (!isDragging || !timelineRef.current || !timelineWidth) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clampValue(e.clientX - rect.left, 0, rect.width);
    const newTime = positionToTime(x);
    
    if (isDragging === "start") {
      updateStartTime(newTime);
      // For fixed duration mode, also seek video to the new start position
      if (fixedDuration !== null) {
        performSeek(newTime);
      }
    } else if (isDragging === "end") {
      updateEndTime(newTime);
    }
  }, [isDragging, timelineWidth, positionToTime, updateStartTime, updateEndTime, fixedDuration, performSeek]);
  
  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setIsDragging(null);
  }, []);
  
  // Set up global mouse and touch events for dragging markers
  useEffect(() => {
    if (isDragging) {
      const handleMouseMove = (e) => {
        e.preventDefault();
        handleDrag(e);
      };
      const handleMouseUp = () => {
        handleDragEnd();
      };
      const handleTouchMove = (e) => {
        e.preventDefault();
        if (e.touches.length > 0) {
          handleDrag(e.touches[0]);
        }
      };
      const handleTouchEnd = () => {
        handleDragEnd();
      };
      
      document.addEventListener("mousemove", handleMouseMove, { passive: false });
      document.addEventListener("mouseup", handleMouseUp, { passive: false });
      document.addEventListener("touchmove", handleTouchMove, { passive: false });
      document.addEventListener("touchend", handleTouchEnd, { passive: false });
      
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
      };
    }
  }, [isDragging, handleDrag, handleDragEnd]);
  
  // Handle timeline drag for scrubbing
  const handleTimelineDrag = useCallback((e) => {
    if (!isTimelineDragging || !timelineRef.current || !videoUrl) {
      return;
    }
    
    // Always allow seeking if we have a video URL - don't wait for full load
    // The video will start loading from the seeked position
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clampValue(e.clientX - rect.left, 0, rect.width);
    const clickedTime = positionToTime(x);
    
    // clickedTime is absolute time (previewStart to previewEnd)
    performSeek(clickedTime);
  }, [isTimelineDragging, positionToTime, performSeek]);
  
  // Set up global mouse and touch events for timeline scrubbing
  useEffect(() => {
    if (isTimelineDragging) {
      const handleMouseMove = (e) => {
        e.preventDefault();
        handleTimelineDrag(e);
      };
      const handleMouseUp = () => {
        setIsTimelineDragging(false);
      };
      const handleTouchMove = (e) => {
        e.preventDefault();
        if (e.touches.length > 0) {
          handleTimelineDrag(e.touches[0]);
        }
      };
      const handleTouchEnd = () => {
        setIsTimelineDragging(false);
      };
      
      document.addEventListener("mousemove", handleMouseMove, { passive: false });
      document.addEventListener("mouseup", handleMouseUp, { passive: false });
      document.addEventListener("touchmove", handleTouchMove, { passive: false });
      document.addEventListener("touchend", handleTouchEnd, { passive: false });
      
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
      };
    }
  }, [isTimelineDragging, handleTimelineDrag]);
  
  // Simple progress handler - just update currentTime
  // Allow video to play through entire preview window, only pause at actual end
  const handleProgress = useCallback((state) => {
    // Don't update during seeks to prevent jitter
    if (isSeekingRef.current) {
      return;
    }
    
    // If we have a last seeked position and we're paused, use that instead
    if (!isPlaying && lastSeekedTimeRef.current !== null) {
      setCurrentTime(lastSeekedTimeRef.current);
      return;
    }
    
    // Only update when playing
    if (isPlaying) {
      const absoluteTime = videoType === 'hls'
        ? state.playedSeconds
        : previewWindow.previewStart + state.playedSeconds;
      setCurrentTime(absoluteTime - previewWindow.previewStart);
      // Clear last seeked time when playing normally
      lastSeekedTimeRef.current = null;
    }
    
    // Auto-pause when reaching the end of the video (not just preview window end)
    // Use actual video duration if available
    const videoDurationValue = actualVideoDurationRef.current || videoDuration || previewDuration;
    const playedAbsolute = videoType === 'hls'
      ? state.playedSeconds
      : previewWindow.previewStart + state.playedSeconds;
    if (playedAbsolute >= videoDurationValue - 0.1 && isPlaying) {
      setIsPlaying(false);
    }
  }, [previewDuration, isPlaying, videoType, previewWindow.previewStart, videoDuration]);
  
  // Handle play/pause
  const handlePlayPause = useCallback(() => {
    if (!videoUrl) return;
    if (!isPlaying && pendingSeekRef.current !== null) {
      performSeek(pendingSeekRef.current);
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, videoUrl, performSeek]);
  
  // Handle download or save
  const handleDownload = useCallback(async () => {
    const validationError = validateRange(startTime, endTime);
    if (validationError) {
      setError(validationError);
      return;
    }
    
    if (onSave) {
      const duration = endTime - startTime;
      onSave(startTime, endTime, duration);
      return;
    }
    
    if (onDownload) {
      await onDownload(startTime, endTime);
    }
  }, [startTime, endTime, validateRange, onDownload, onSave]);
  
  // Monitor video element for seeking readiness
  useEffect(() => {
    let checkInterval = null;
    let videoElement = null;
    
    const setupVideoListeners = () => {
      videoElement = getVideoElement();
      if (!videoElement) {
        // Retry in 500ms
        setTimeout(setupVideoListeners, 500);
        return;
      }
      
      const handleCanPlay = () => {
        console.log('Video canplay event - checking seekability');
        checkSeekable();
      };
      
      const handleLoadedMetadata = () => {
        console.log('Video loadedmetadata event - duration:', videoElement.duration);
        if (videoElement.duration && isFinite(videoElement.duration)) {
          actualVideoDurationRef.current = videoElement.duration;
          checkSeekable();
        }
      };
      
      const handleLoadedData = () => {
        console.log('Video loadeddata event');
        checkSeekable();
      };
      
      const handleProgress = () => {
        // Check seekability when buffering progress updates
        if (!isSeekable) {
          checkSeekable();
        }
      };
      
      videoElement.addEventListener('canplay', handleCanPlay);
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.addEventListener('loadeddata', handleLoadedData);
      videoElement.addEventListener('progress', handleProgress);
      
      // Also check periodically for first few seconds
      let checks = 0;
      checkInterval = setInterval(() => {
        checks++;
        if (checkSeekable() || checks > 20) {
          clearInterval(checkInterval);
        }
      }, 250);
      
      return () => {
        videoElement.removeEventListener('canplay', handleCanPlay);
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoElement.removeEventListener('loadeddata', handleLoadedData);
        videoElement.removeEventListener('progress', handleProgress);
      };
    };
    
    // Start checking after a short delay to let ReactPlayer mount
    const timeout = setTimeout(setupVideoListeners, 200);
    
    return () => {
      clearTimeout(timeout);
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };
  }, [videoUrl, getVideoElement, checkSeekable, isSeekable]);
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      
      const step = e.shiftKey ? 5 : 1;
      
      if (e.key === "ArrowLeft" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        updateStartTime(startTime - step);
      } else if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        updateStartTime(startTime + step);
      } else if (e.key === "ArrowLeft" && e.altKey) {
        e.preventDefault();
        updateEndTime(endTime - step);
      } else if (e.key === "ArrowRight" && e.altKey) {
        e.preventDefault();
        updateEndTime(endTime + step);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [startTime, endTime, updateStartTime, updateEndTime]);
  
  // Calculate positions for rendering
  const startPos = timeToPosition(startTime);
  const endPos = timeToPosition(endTime);
  const currentPos = timeToPosition(previewWindow.previewStart + currentTime);
  const clipDuration = endTime - startTime;
  const isValid = !error && clipDuration > 0 && clipDuration <= MAX_CLIP_DURATION;
  
  const showLoadingOverlay = (isSeekInProgress || !isInitialSeekReady) && !error;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <div className="flex flex-col h-full bg-gray-950">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <div className="flex justify-between items-center">
            <button
              onClick={onCancel}
              className="flex gap-2 items-center transition-colors text-slate-300 hover:text-white group"
              aria-label="Back to search results"
            >
              <svg className="w-5 h-5 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Back to Search</span>
            </button>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-white">Clip Editor</h1>
              <p className="mt-0.5 text-xs text-slate-400">
                {fixedDuration !== null 
                  ? `Duration locked to ${formatTime(fixedDuration)} — Drag the clip to reposition` 
                  : "Select your clip boundaries"}
              </p>
            </div>
            <div className="w-24" />
          </div>
        </div>
        
        {/* Main Content Area */}
        <div className="flex flex-col flex-1 min-h-0">
          {/* Video Player */}
        <div className="flex flex-1 justify-center items-center min-h-0 bg-black" style={{ aspectRatio }}>
            <div
              className="relative mx-auto w-full max-w-6xl bg-black"
              style={{ aspectRatio }}
            >
              {videoUrl ? (
                <>
                  <ReactPlayer
                    ref={playerRef}
                    url={videoUrl}
                    playing={isPlaying}
                    width="100%"
                    height="100%"
                    style={{ position: "absolute", top: 0, left: 0 }}
                    onProgress={handleProgress}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onStart={() => {
                      if (!initialSeekAppliedRef.current) {
                        setIsSeekInProgress(true);
                        return;
                      }
                      setIsVideoReady(true);
                      isVideoReadyRef.current = true;
                      setError(null);
                      setIsSeekInProgress(false);
                      console.log('Video started loading - enabling immediate seeking');
                    }}
                    onReady={() => {
                      // Clear loading timeout
                      if (loadingTimeoutRef.current) {
                        clearTimeout(loadingTimeoutRef.current);
                        loadingTimeoutRef.current = null;
                      }
                      
                      // Store actual video duration from player
                      if (playerRef.current) {
                        try {
                          const duration = playerRef.current.getDuration();
                          if (duration && duration > 0 && !isNaN(duration) && isFinite(duration)) {
                            console.log('Video fully loaded - Actual duration:', duration, 'Expected:', previewDuration);
                            
                            // Check for major duration mismatch - if video is less than 20% of expected,
                            // Cloudinary hasn't finished processing. Fall back to HLS immediately.
                            const durationRatio = duration / previewDuration;
                            if (durationRatio < 0.2 && videoType === 'cloudinary') {
                              console.error('CRITICAL: Cloudinary video too short in onReady! Expected:', previewDuration, 'Got:', duration, '- falling back to HLS');
                              
                              // Try HLS fallback
                              const hlsUrl = videoDetail?.hls?.video_url;
                              if (hlsUrl && hlsUrl !== previewUrl) {
                                setVideoUrl(hlsUrl);
                                setVideoType('hls');
                                setWarmingStatus('fallback');
                                setError("Cloudinary video not ready. Using HLS stream instead.");
                                actualVideoDurationRef.current = videoDuration || null;
                                pendingSeekRef.current = clipAbsoluteStart;
                                initialSeekAppliedRef.current = false;
                                setIsInitialSeekReady(false);
                                setIsSeekInProgress(true);
                                console.log('HLS fallback (onReady duration mismatch): queued seek to clip start:', clipAbsoluteStart);
                              } else {
                                setError("Video not processed by Cloudinary. Please try again later.");
                                setIsSeekInProgress(false);
                              }
                              return; // Don't continue with broken video
                            }
                            
                            actualVideoDurationRef.current = duration;
                            
                            // If duration differs significantly from expected, log a warning
                            if (Math.abs(duration - previewDuration) > 1) {
                              console.warn('Video duration mismatch in onReady! Expected:', previewDuration, 'Got:', duration);
                            }
                          } else {
                            console.warn('Invalid duration in onReady:', duration);
                            // Only use previewDuration as fallback if NOT in HLS fallback mode
                            // (HLS videos have different duration than the preview window)
                            if (previewDuration > 0 && warmingStatus !== 'fallback') {
                              actualVideoDurationRef.current = previewDuration;
                              console.log('Using previewDuration as fallback:', previewDuration);
                            } else if (warmingStatus === 'fallback') {
                              console.log('Skipping previewDuration fallback - using HLS stream with unknown duration');
                            }
                          }
                        } catch (err) {
                          console.warn('Failed to get video duration:', err);
                          // Only use previewDuration as fallback if NOT in HLS fallback mode
                          if (previewDuration > 0 && warmingStatus !== 'fallback') {
                            actualVideoDurationRef.current = previewDuration;
                            console.log('Using previewDuration as fallback after error:', previewDuration);
                          }
                        }
                      }
                      
                      if (initialSeekAppliedRef.current) {
                        setIsVideoReady(true);
                        isVideoReadyRef.current = true;
                        setIsSeekInProgress(false);
                        if (!error) {
                          setError(null);
                        }
                      }
                      
                      if (pendingSeekRef.current !== null && !initialSeekAppliedRef.current) {
                        const pendingTime = pendingSeekRef.current;
                        console.log('Executing pending seek in onReady:', pendingTime);
                        setTimeout(() => performSeek(pendingTime), 50);
                      }
                    }}
                    onDuration={(duration) => {
                      // Store actual video duration when available
                      // This often fires before onReady, so we can enable seeking earlier
                      if (duration && duration > 0 && !isNaN(duration) && isFinite(duration)) {
                        console.log('Video duration from player:', duration, 'Expected preview duration:', previewDuration, 'Difference:', Math.abs(duration - previewDuration));
                        
                        // Check for major duration mismatch - if video is less than 20% of expected,
                        // Cloudinary hasn't finished processing. Fall back to HLS immediately.
                        const durationRatio = duration / previewDuration;
                        if (durationRatio < 0.2 && videoType === 'cloudinary') {
                          console.error('CRITICAL: Cloudinary video too short! Expected:', previewDuration, 'Got:', duration, '- falling back to HLS');
                          
                          // Clear loading timeout
                          if (loadingTimeoutRef.current) {
                            clearTimeout(loadingTimeoutRef.current);
                            loadingTimeoutRef.current = null;
                          }
                          
                          // Try HLS fallback
                          const hlsUrl = videoDetail?.hls?.video_url;
                          if (hlsUrl && hlsUrl !== previewUrl) {
                            setVideoUrl(hlsUrl);
                            setVideoType('hls');
                            setWarmingStatus('fallback');
                            setError("Cloudinary video not ready. Using HLS stream instead.");
                            actualVideoDurationRef.current = videoDuration || null;
                            pendingSeekRef.current = clipAbsoluteStart;
                            initialSeekAppliedRef.current = false;
                            setIsInitialSeekReady(false);
                            setIsSeekInProgress(true);
                            console.log('HLS fallback (duration mismatch): queued seek to clip start:', clipAbsoluteStart);
                          } else {
                            setError("Video not processed by Cloudinary. Please try again later.");
                            setIsSeekInProgress(false);
                          }
                          return; // Don't continue with broken video
                        }
                        
                        actualVideoDurationRef.current = duration;
                        if (initialSeekAppliedRef.current && !isVideoReadyRef.current) {
                          setIsVideoReady(true);
                          isVideoReadyRef.current = true;
                          setIsSeekInProgress(false);
                          console.log('Video duration available - enabling seeking:', duration);
                        }
                        
                        // If duration differs significantly from expected, log a warning
                        if (Math.abs(duration - previewDuration) > 1) {
                          console.warn('Video duration mismatch! Expected:', previewDuration, 'Got:', duration, 'This may affect seeking accuracy.');
                        }
                        
                        // Execute any pending seek now that we have duration
                        if (pendingSeekRef.current !== null && !initialSeekAppliedRef.current) {
                          const pendingTime = pendingSeekRef.current;
                          console.log('Executing pending seek with actual duration:', pendingTime);
                          setTimeout(() => performSeek(pendingTime), 50);
                        }
                      } else {
                        console.warn('Invalid duration received:', duration);
                      }
                    }}
                    onBuffer={() => {
                      // Video is buffering - we can still allow seeking
                      // This helps maintain interactivity during buffering
                    }}
                    onBufferEnd={() => {
                      // Buffering finished - ensure we're still ready
                      setIsVideoReady(true);
                      isVideoReadyRef.current = true;
                    }}
                    onSeek={(seconds) => {
                      // Always update currentTime and lastSeekedTime when seeking completes
                      const absoluteTime = videoType === 'hls'
                        ? seconds
                        : previewWindow.previewStart + seconds;
                      setCurrentTime(absoluteTime - previewWindow.previewStart);
                      lastSeekedTimeRef.current = absoluteTime - previewWindow.previewStart;
                      
                      // Clear seeking flag after seek completes
                      if (isSeekingRef.current) {
                        setTimeout(() => {
                          isSeekingRef.current = false;
                        }, 100);
                      }
                    }}
                    onError={(err) => {
                      console.error("Video player error:", err, "URL:", videoUrl);
                      
                      // Clear loading timeout
                      if (loadingTimeoutRef.current) {
                        clearTimeout(loadingTimeoutRef.current);
                        loadingTimeoutRef.current = null;
                      }
                      
                      const hlsUrl = videoDetail?.hls?.video_url;
                      
                      // If we were on Cloudinary, try HLS fallback once
                      if (videoType === 'cloudinary' && hlsUrl && videoUrl !== hlsUrl) {
                        console.log("Cloudinary URL failed, falling back to HLS URL");
                        setVideoUrl(hlsUrl);
                        setVideoType('hls');
                        setWarmingStatus('fallback');
                        setError("Unable to load Cloudinary preview, switching to streaming fallback.");
                        actualVideoDurationRef.current = videoDuration || null;
                        pendingSeekRef.current = clipAbsoluteStart;
                        return;
                      }
                      
                      // No further fallback (or HLS itself failed)
                      setError("Video failed to load. Please try again or pick a different clip.");
                      setIsVideoReady(false);
                      setIsSeekInProgress(false);
                    }}
                    progressInterval={50}
                    config={{
                      file: {
                        attributes: {
                          preload: "metadata", // Load metadata first for faster seeking
                          controlsList: "nodownload",
                          crossOrigin: "anonymous",
                        },
                        forceVideo: true,
                        forceHLS: videoType === 'hls',
                        hlsOptions: {
                          enableWorker: true,
                          lowLatencyMode: true,
                          backBufferLength: 90,
                          startPosition: clipAbsoluteStart,
                        },
                      },
                    }}
                    playsinline
                    controls={false}
                    // Enable piped streaming for faster seeking
                    pip={false}
                    stopOnUnmount={false}
                    // Don't wait for full load before allowing interaction
                    light={false}
                  />
                  {/* Loading overlay while initial seek is in progress */}
                  {showLoadingOverlay && (
                    <div className="flex absolute inset-0 z-20 justify-center items-center bg-black/70">
                      <div className="text-center">
                        <div className="mx-auto mb-3 w-10 h-10 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
                        <p className="text-sm font-medium text-white">Preparing clip preview...</p>
                        <p className="mt-1 text-xs text-slate-300">Aligning video to {formatTime(clipAbsoluteStart)}</p>
                      </div>
                    </div>
                  )}
                  {/* Warming overlay - shown while preparing Cloudinary video */}
                  {warmingStatus === 'warming' && !videoUrl && (
                    <div className="flex absolute inset-0 z-10 justify-center items-center bg-black/60">
                      <div className="text-center">
                        <div className="mx-auto mb-3 w-8 h-8 rounded-full border-3 border-amber-500 animate-spin border-t-transparent"></div>
                        <p className="text-sm font-medium text-amber-400">Preparing video...</p>
                        <p className="mt-1 text-xs text-slate-400">
                          First-time videos take a moment to process
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          This ensures fast seeking once loaded
                        </p>
                      </div>
                    </div>
                  )}
                  {/* Loading overlay - shown while video player is loading */}
                  {!isVideoReady && !error && videoUrl && warmingStatus !== 'warming' && (
                    <div className="flex absolute inset-0 z-10 justify-center items-center pointer-events-none bg-black/40">
                      <div className="text-center">
                        <div className="mx-auto mb-2 w-6 h-6 rounded-full border-2 border-indigo-600 animate-spin border-t-transparent"></div>
                        <p className="text-xs text-slate-400">Loading video...</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {videoType === 'cloudinary' ? 'Cloudinary MP4' : videoType === 'hls' ? 'HLS Stream' : 'Video'}
                        </p>
                        {warmingStatus === 'fallback' && (
                          <p className="mt-1 text-xs text-amber-400">Using fallback stream</p>
                        )}
                      </div>
                    </div>
                  )}
                  {isVideoReady && !isSeekable && !error && videoUrl && (
                    <div className="flex absolute bottom-4 right-4 z-10 justify-center items-center pointer-events-none">
                      <div className="px-2 py-1 text-xs text-amber-400 bg-black/70 rounded">
                        Waiting for video to be seekable...
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex justify-center items-center w-full h-full text-slate-400">
                  <div className="text-center">
                    <div className={`mx-auto mb-4 w-8 h-8 rounded-full border-4 animate-spin border-t-transparent ${warmingStatus === 'warming' ? 'border-amber-500' : 'border-indigo-600'}`}></div>
                    <p className={warmingStatus === 'warming' ? 'text-amber-400' : ''}>
                      {warmingStatus === 'warming' ? 'Preparing video...' : 'Loading preview...'}
                    </p>
                    {warmingStatus === 'warming' && (
                      <p className="mt-2 text-xs text-slate-500">
                        First-time videos need to be processed
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Timeline and Controls Section */}
          <div className="px-6 py-6 bg-gray-900 border-t border-gray-800">
            <div className="mx-auto max-w-7xl">
              {/* Timeline */}
              <div className="mb-6">
                <div className="flex justify-between items-center px-2 mb-2">
                  <div className="font-mono text-xs text-slate-400">
                    {formatTime(previewWindow.previewStart)}
                  </div>
                  <div className="font-mono text-xs text-slate-400">
                    {formatTime(previewWindow.previewEnd)}
                  </div>
                </div>
                
                <div className="relative">
                  <div
                    ref={timelineRef}
                    className={clsx(
                      "overflow-visible relative h-20 bg-gray-800 rounded-xl border border-gray-700 transition-opacity touch-none",
                      videoUrl ? "cursor-pointer" : "opacity-60 cursor-wait"
                    )}
                    onClick={(e) => {
                      if (isTimelineDragging) return;
                      const clickedOnMarker = e.target.closest('[role="slider"]') || 
                                             e.target.closest('.absolute.-top-12') ||
                                             e.target.closest('.absolute.-top-3');
                      if (!clickedOnMarker) {
                        e.stopPropagation();
                        handleTimelineClick(e);
                      }
                    }}
                    title={!videoUrl ? "Please wait for video URL" : "Click or drag to seek - video will load from seeked position"}
                    onMouseDown={(e) => {
                      const clickedOnMarker = e.target.closest('[role="slider"]');
                      if (!clickedOnMarker && videoUrl) {
                        e.preventDefault();
                        setIsTimelineDragging(true);
                        handleTimelineClick(e);
                      }
                    }}
                    onTouchStart={(e) => {
                      const clickedOnMarker = e.target.closest('[role="slider"]');
                      if (!clickedOnMarker && e.touches.length > 0 && videoUrl) {
                        e.preventDefault();
                        setIsTimelineDragging(true);
                        const touch = e.touches[0];
                        const syntheticEvent = {
                          clientX: touch.clientX,
                          clientY: touch.clientY,
                        };
                        handleTimelineClick(syntheticEvent);
                      }
                    }}
                  >
                    {/* Timeline track background */}
                    <div 
                      className="absolute inset-0 rounded-xl pointer-events-none timeline-track" 
                    />
                    
                    {/* Playback indicator */}
                    <div
                      className="absolute top-0 bottom-0 z-10 w-1 bg-white pointer-events-none"
                      style={{ left: `${currentPos}px` }}
                    >
                      <div className="absolute -top-2 left-1/2 w-4 h-4 bg-white rounded-full border-2 border-gray-900 shadow-lg -translate-x-1/2" />
                    </div>
                    
                    {fixedDuration !== null ? (
                      /* Fixed duration mode: entire clip region is grabbable */
                      <div
                        className={clsx(
                          "absolute top-0 bottom-0 z-20 touch-none cursor-grab",
                          "bg-indigo-500/40",
                          "hover:bg-indigo-400/50",
                          isDragging === "start" && "cursor-grabbing bg-indigo-400/60"
                        )}
                        style={{
                          left: `${startPos}px`,
                          width: `${Math.max(endPos - startPos, 20)}px`,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleDragStart("start");
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleDragStart("start");
                        }}
                        role="slider"
                        aria-label="Reposition clip"
                        aria-valuemin={previewWindow.previewStart}
                        aria-valuemax={previewWindow.previewEnd - fixedDuration}
                        aria-valuenow={startTime}
                        tabIndex={0}
                      >
                        {/* Left edge - START indicator */}
                        <div className="absolute top-0 bottom-0 -left-0.5 w-2 bg-emerald-500 rounded-l-sm shadow-lg shadow-emerald-500/50">
                          <div className="absolute top-1/2 -right-1 w-0 h-0 -translate-y-1/2 border-t-4 border-b-4 border-l-4 border-transparent border-l-emerald-500" />
                        </div>
                        {/* Right edge - END indicator */}
                        <div className="absolute top-0 bottom-0 -right-0.5 w-2 bg-rose-500 rounded-r-sm shadow-lg shadow-rose-500/50">
                          <div className="absolute top-1/2 -left-1 w-0 h-0 -translate-y-1/2 border-t-4 border-b-4 border-r-4 border-transparent border-r-rose-500" />
                        </div>
                        
                        {/* Time labels */}
                        <div className="absolute -top-7 left-0 px-1.5 py-0.5 text-xs font-bold text-white bg-emerald-600 rounded shadow">
                          {formatTime(startTime)}
                        </div>
                        <div className="absolute -top-7 right-0 px-1.5 py-0.5 text-xs font-bold text-white bg-rose-600 rounded shadow">
                          {formatTime(endTime)}
                        </div>
                      </div>
                    ) : (
                      /* Variable duration mode: separate start/end handles */
                      <>
                        {/* Selected region highlight */}
                        <div
                          className="absolute top-0 bottom-0 rounded border-indigo-400 bg-indigo-500/40 border-y-2"
                          style={{
                            left: `${startPos}px`,
                            width: `${endPos - startPos}px`,
                          }}
                        />
                        
                        {/* Start marker */}
                        <div
                          className={clsx(
                            "absolute top-0 z-30 touch-none cursor-ew-resize",
                            isDragging === "start" && "scale-110"
                          )}
                          style={{ left: `${startPos}px`, transform: 'translateX(-50%)' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleDragStart("start");
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            handleDragStart("start");
                          }}
                          role="slider"
                          aria-label="Start time"
                          aria-valuemin={previewWindow.previewStart}
                          aria-valuemax={endTime - 0.1}
                          aria-valuenow={startTime}
                          tabIndex={0}
                        >
                          <div className="relative">
                            <div className="absolute top-0 left-1/2 w-1 h-full bg-emerald-500 rounded-t -translate-x-1/2" />
                            <div className={clsx(
                              "absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-emerald-500 rounded-full border-4 border-gray-900 shadow-lg",
                              "hover:bg-emerald-400 hover:scale-110 transition-all",
                              isDragging === "start" && "bg-emerald-300 scale-110 ring-2 ring-emerald-300/50"
                            )}>
                              <div className="flex absolute inset-0 justify-center items-center">
                                <div className="w-2 h-2 bg-white rounded-full" />
                              </div>
                            </div>
                            <div className="absolute -top-12 left-1/2 whitespace-nowrap -translate-x-1/2">
                              <div className="px-2 py-1 text-xs font-semibold text-white bg-emerald-500 rounded shadow-lg">
                                {formatTime(startTime)}
                              </div>
                              <div className="absolute top-full left-1/2 w-0 h-0 border-t-4 border-r-4 border-l-4 border-transparent -translate-x-1/2 border-t-emerald-500" />
                            </div>
                          </div>
                        </div>
                        
                        {/* End marker */}
                        <div
                          className={clsx(
                            "absolute top-0 z-30 touch-none cursor-ew-resize",
                            isDragging === "end" && "scale-110"
                          )}
                          style={{ left: `${endPos}px`, transform: 'translateX(-50%)' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleDragStart("end");
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            handleDragStart("end");
                          }}
                          role="slider"
                          aria-label="End time"
                          aria-valuemin={startTime + 0.1}
                          aria-valuemax={previewWindow.previewEnd}
                          aria-valuenow={endTime}
                          tabIndex={0}
                        >
                          <div className="relative">
                            <div className="absolute top-0 left-1/2 w-1 h-full bg-red-500 rounded-t -translate-x-1/2" />
                            <div className={clsx(
                              "absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-red-500 rounded-full border-4 border-gray-900 shadow-lg",
                              "hover:bg-red-400 hover:scale-110 transition-all",
                              isDragging === "end" && "bg-red-300 scale-110 ring-2 ring-red-300/50"
                            )}>
                              <div className="flex absolute inset-0 justify-center items-center">
                                <div className="w-2 h-2 bg-white rounded-full" />
                              </div>
                            </div>
                            <div className="absolute -top-12 left-1/2 whitespace-nowrap -translate-x-1/2">
                              <div className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded shadow-lg">
                                {formatTime(endTime)}
                              </div>
                              <div className="absolute top-full left-1/2 w-0 h-0 border-t-4 border-r-4 border-l-4 border-transparent -translate-x-1/2 border-t-red-500" />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Controls Bar */}
              <div className="flex gap-6 justify-between items-center">
                <div className="flex gap-4 items-center">
                  <button
                    onClick={handlePlayPause}
                    disabled={!videoUrl || !isInitialSeekReady}
                    className="flex justify-center items-center w-12 h-12 text-white bg-indigo-600 rounded-full shadow-lg transition-colors hover:bg-indigo-500 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    ) : (
                      <svg className="ml-0.5 w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  
                  {/* Jump to clip start button */}
                  <button
                    onClick={() => {
                      console.log('Jumping to clip start absolute:', startTime);
                      performSeek(startTime);
                    }}
                    disabled={!videoUrl}
                    className="flex justify-center items-center px-3 py-2 text-xs text-white bg-emerald-600 rounded-lg shadow transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Jump to clip start"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                    Start
                  </button>
                  
                  <div className="flex flex-col">
                    <div className="text-sm text-slate-300">
                      <span className="font-semibold text-white">{formatTime(previewWindow.previewStart + currentTime)}</span>
                      <span className="text-slate-400"> / {formatTime(previewWindow.previewEnd)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      Current position 
                      {isSeekable && <span className="text-emerald-400 ml-1">• Seekable</span>}
                      {!isSeekable && isVideoReady && <span className="text-amber-400 ml-1">• Loading seek...</span>}
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-1 justify-center">
                  <div className="px-4 py-2 rounded-lg border border-gray-700 bg-gray-800/50">
                    <div className="text-center">
                      <div className="mb-1 text-xs text-slate-400">
                        {fixedDuration !== null ? "Clip Duration (Locked)" : "Selected Clip"}
                      </div>
                      <div className="text-lg font-semibold text-white">
                        {formatTime(clipDuration)}
                        <span className="ml-2 text-sm text-slate-400">({clipDuration.toFixed(1)}s)</span>
                        {fixedDuration !== null && (
                          <span className="ml-2 text-xs text-emerald-400">🔒</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-3 items-center">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="px-5 py-2.5 text-sm font-medium rounded-lg border border-gray-700 transition-colors text-slate-200 hover:border-gray-600 hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!isValid}
                    className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-lg transition-colors hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-indigo-500/50 disabled:hover:shadow-none"
                  >
                    {onSave ? "Save Changes" : "Download Clip"}
                  </button>
                </div>
              </div>
              
              {error && (
                <div className="px-4 py-2 mt-4 text-sm text-red-400 rounded-lg border bg-red-500/10 border-red-500/20">
                  {error}
                </div>
              )}
              
              {/* Debug info - always shown for now to help debug */}
              {typeof window !== 'undefined' && (
                <div className="px-3 py-2 mt-4 text-xs font-mono rounded-lg border bg-gray-800/50 border-gray-700 text-slate-400">
                  <details>
                    <summary className="cursor-pointer hover:text-slate-200">Debug Info</summary>
                    <div className="mt-2 space-y-1">
                      <div>Video Type: <span className="text-slate-200">{videoType}</span></div>
                      <div>Seekable: <span className={isSeekable ? "text-emerald-400" : "text-amber-400"}>{isSeekable ? 'Yes' : 'No'}</span></div>
                      <div>Video Ready: <span className={isVideoReady ? "text-emerald-400" : "text-amber-400"}>{isVideoReady ? 'Yes' : 'No'}</span></div>
                      <div>Actual Duration: <span className="text-slate-200">{Number.isFinite(actualVideoDurationRef.current) ? actualVideoDurationRef.current.toFixed(2) : 'N/A'}s</span></div>
                      <div>Preview Duration: <span className="text-slate-200">{Number.isFinite(previewDuration) ? previewDuration.toFixed(2) : 'N/A'}s</span></div>
                      <div>Preview Window: <span className="text-slate-200">{Number.isFinite(previewWindow.previewStart) ? previewWindow.previewStart.toFixed(2) : 'N/A'}s - {Number.isFinite(previewWindow.previewEnd) ? previewWindow.previewEnd.toFixed(2) : 'N/A'}s</span></div>
                      <div>Current Time (relative): <span className="text-slate-200">{Number.isFinite(currentTime) ? currentTime.toFixed(2) : 'N/A'}s</span></div>
                      <div className="break-all">URL: <span className="text-slate-300">{videoUrl?.substring(0, 100)}...</span></div>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClipEditor;
