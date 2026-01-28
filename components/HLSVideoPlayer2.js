"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

/**
 * HLS Video Player component for playing Twelve Labs HLS streams
 * Uses hls.js for browsers that don't support native HLS
 */
const HLSVideoPlayer = ({ 
  hlsUrl, 
  thumbnailUrl, 
  startTime = 0, 
  endTime = null,
  isPlaying = false,
  muted = false,
  onPlay,
  onPause,
  onEnded
}) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const shouldPlayRef = useRef(false);
  const [hasStarted, setHasStarted] = useState(false); // Track if video has ever started
  const [isPaused, setIsPaused] = useState(true);
  const [currentProgress, setCurrentProgress] = useState(0);
  const cleanupRef = useRef(null);
  const isMountedRef = useRef(true);

  // Format time helper
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const clipDuration = (endTime !== null && endTime > 0 && startTime !== undefined && endTime > startTime) 
    ? endTime - startTime 
    : 0;

  // Poll for current time to update progress bar (more reliable than timeupdate event)
  useEffect(() => {
    if (!hasStarted || clipDuration <= 0) return;
    
    const video = videoRef.current;
    if (!video) return;

    const interval = setInterval(() => {
      if (video.paused) return;
      
      const elapsed = video.currentTime - startTime;
      const progress = Math.max(0, Math.min(1, elapsed / clipDuration));
      setCurrentProgress(progress);
    }, 100);

    return () => clearInterval(interval);
  }, [hasStarted, clipDuration, startTime]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clean up HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      // Clean up event listeners
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl || !isMountedRef.current) return;

    // Clean up existing HLS instance and event listeners
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Initialize HLS
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hlsRef.current = hls;
      hls.attachMedia(video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(hlsUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed, seeking to start time:', startTime);
        if (startTime > 0) {
          setTimeout(() => {
            if (video.readyState >= 2) {
              video.currentTime = startTime;
            }
          }, 100);
        }
        try {
          hls.startLoad(startTime > 0 ? startTime : -1);
        } catch (e) {
          // ignore
        }
      });
      hls.on(Hls.Events.LEVEL_UPDATED, (_e, data) => {
        // If we get a level update after a seek, try play again if requested.
        if (shouldPlayRef.current && video.paused) {
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('HLS network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('HLS media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              console.error('HLS fatal error, destroying instance');
              hls.destroy();
              break;
          }
        } else {
          console.warn('HLS non-fatal error:', data);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      console.log('Using native HLS support');
      video.src = hlsUrl;
    } else {
      console.error('HLS is not supported in this browser');
      return;
    }

    // Handle metadata loaded
    const handleLoadedMetadata = () => {
      console.log('Video metadata loaded, currentTime:', video.currentTime, 'startTime:', startTime);
      if (startTime > 0 && Math.abs(video.currentTime - startTime) > 0.5) {
        video.currentTime = startTime;
      }
      if (shouldPlayRef.current) {
        video.play().catch(() => {});
      }
    };

    // Handle time updates to stop at end time and track progress
    const handleTimeUpdate = () => {
      const hasValidClip = endTime !== null && endTime > 0 && startTime !== undefined && endTime > startTime;
      
      if (hasValidClip && video.currentTime >= endTime) {
        video.pause();
        setCurrentProgress(1); // 100% when ended
        if (onEnded) onEnded();
      } else if (hasValidClip) {
        // Calculate progress within the clip
        const clipDur = endTime - startTime;
        const elapsed = video.currentTime - startTime;
        const progress = Math.max(0, Math.min(1, elapsed / clipDur));
        setCurrentProgress(progress);
      }
    };

    // Handle canplay event - video is ready to play
    const handleCanPlay = () => {
      console.log('Video can play, seeking to start time:', startTime);
      if (startTime > 0 && Math.abs(video.currentTime - startTime) > 0.5) {
        video.currentTime = startTime;
      }
      if (shouldPlayRef.current) {
        video.play().catch(() => {});
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('seeking', () => {
      if (shouldPlayRef.current && video.paused) {
        video.play().catch(() => {});
      }
    });

    // Store cleanup function
    cleanupRef.current = () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('canplay', handleCanPlay);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };

    return cleanupRef.current;
  }, [hlsUrl, startTime, endTime, onEnded]);

  // Handle play/pause
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      shouldPlayRef.current = true;
      setHasStarted(true);
      setIsPaused(false);
      // If media not ready yet, let loadedmetadata/canplay resume playback
      if (video.readyState < 2) {
        return;
      }
      if (startTime > 0 && Math.abs(video.currentTime - startTime) > 0.5) {
        video.currentTime = startTime;
      }
      setTimeout(() => {
        const v = videoRef.current;
        if (!v) return;
        v.play().catch(err => {
          console.warn('Play failed:', err);
          setIsPaused(true);
        });
      }, 30);
    } else {
      shouldPlayRef.current = false;
      video.pause();
      setIsPaused(true);
    }
  }, [isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (muted) {
      video.volume = 0;
    }
  }, [muted]);

  const handleClick = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    if (!video.paused) {
      // If playing, pause it
      video.pause();
      setIsPaused(true);
      if (onPause) onPause();
    } else {
      // If paused, play it
      setHasStarted(true);
      setIsPaused(false);
      shouldPlayRef.current = true;
      if (onPlay) onPlay();
      const kickPlay = () => {
        const videoElement = videoRef.current;
        if (!videoElement) return;
        if (startTime > 0 && Math.abs(videoElement.currentTime - startTime) > 0.5) {
          videoElement.currentTime = startTime;
        }
        if (videoElement.readyState < 2) {
          // Wait for readiness handlers to fire
          return;
        }
        videoElement.play().catch(err => {
          console.warn('Play failed:', err);
          setIsPaused(true);
          // If play fails, try again after seeking to start time
          if (startTime > 0) {
            const retryVideo = videoRef.current;
            if (!retryVideo) return;

            retryVideo.currentTime = startTime;
            setTimeout(() => {
              retryVideo.play().catch(err2 => {
                console.error('Retry play failed:', err2);
                setIsPaused(true);
              });
            }, 30);
          }
        });
      };
      // Slight delay to avoid colliding with pending loads
      setTimeout(kickPlay, 50);
    }
  };

  const handlePlay = () => {
    setHasStarted(true);
    setIsPaused(false);
    if (onPlay) onPlay();
  };

  const handlePause = () => {
    setIsPaused(true);
    if (onPause) onPause();
  };

  // Only hide the video element behind a thumbnail when we actually have one.
  // Without this, a missing thumbnail would keep the video hidden and unplayable.
  const showThumbnail = !hasStarted && !!thumbnailUrl;

  return (
    <div className="w-full h-full relative">
      <video
        ref={videoRef}
        className="w-full h-full cursor-pointer"
        playsInline
        muted={muted}
        poster={thumbnailUrl || undefined}
        onClick={handleClick}
        onPlay={handlePlay}
        onPause={handlePause}
        style={{ display: showThumbnail ? 'none' : 'block' }}
      />
      {showThumbnail && thumbnailUrl && (
        <div 
          className="absolute inset-0 cursor-pointer"
          onClick={handleClick}
        >
          <img
            src={thumbnailUrl}
            className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
            alt="thumbnail"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors pointer-events-none">
            <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform border border-white/20">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      )}
      {/* Play/Pause overlay when video is visible but paused */}
      {!showThumbnail && isPaused && (
        <div 
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={handleClick}
        >
          <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-110 transition-transform border border-white/20">
            <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}
      {!showThumbnail && clipDuration > 0 && (
        <>
          {/* Time display */}
          <div className="absolute bottom-3 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-md pointer-events-none z-10">
            <p className="text-white text-xs font-medium tabular-nums">
              {formatTime(currentProgress * clipDuration)} / {formatTime(clipDuration)}
            </p>
          </div>
          {/* Progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 pointer-events-none">
            <div 
              className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-100 ease-linear"
              style={{ width: `${currentProgress * 100}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default HLSVideoPlayer;

