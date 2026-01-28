import React from "react";

import { Play, Pause, SkipBack, SkipForward } from "lucide-react";

import { Button } from "../../../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../ui/dropdown-menu";


interface PlaybackControlsProps {
  isPlaying: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeekToStart?: () => void;
  onSeekToEnd?: () => void;
  currentTime: number;
  totalDuration: number;
  formatTime: (timeInSeconds: number) => string;
  playbackRate?: number;
  setPlaybackRate?: (rate: number) => void;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  onPlay,
  onPause,
  onSeekToStart,
  onSeekToEnd,
  currentTime,
  totalDuration,
  formatTime,
  playbackRate = 1,
  setPlaybackRate,
}) => {
  const handlePlayPause = () => {
    if (isPlaying) {
      onPause?.();
    } else {
      onPlay?.();
    }
  };

  return (
    <>
      {/* Playback Speed Control */}
      {setPlaybackRate && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-foreground hidden sm:flex border h-7 p-3 text-xs hover:bg-transparent"
            >
              {playbackRate}x
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-[100px] bg-(--surface-elevated) border border-(--border)"
            align="center"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
            }}
          >
            {[0.25, 0.5, 1, 1.5, 2].map((speed) => (
              <DropdownMenuItem
                key={speed}
                onClick={() => setPlaybackRate(speed)}
                className={`text-xs py-1.5 ${
                  playbackRate === speed
                    ? "text-blue-600 dark:text-blue-400 font-extralight"
                    : "font-extralight"
                }`}
              >
                {speed}x
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Skip to Start Button */}
      {onSeekToStart && (
        <Button
          onClick={onSeekToStart}
          size="sm"
          variant="ghost"
          className="h-7 bg-surface border-border text-foreground hidden sm:flex"
          onTouchStart={(e) => e.preventDefault()}
          style={{ WebkitTapHighlightColor: 'transparent' }}
          aria-label="Jump to Start"
        >
          <SkipBack className="h-3 w-3 text-foreground" />
        </Button>
      )}

      {/* Play/Pause Button */}
      {(onPlay || onPause) && (
        <Button
          onClick={handlePlayPause}
          size="sm"
          variant="ghost"
          className="h-7 bg-surface border-border text-foreground"
          onTouchStart={(e) => e.preventDefault()}
          style={{ WebkitTapHighlightColor: 'transparent' }}
          aria-label={isPlaying ? "Pause Video" : "Play Video"}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 text-foreground" />
          ) : (
            <Play className="h-4 w-4 text-foreground" />
          )}
        </Button>
      )}

      {/* Skip to End Button */}
      {onSeekToEnd && (
        <Button
          onClick={onSeekToEnd}
          size="sm"
          variant="ghost"
          className="h-7 bg-surface border-border text-foreground hidden sm:flex"
          onTouchStart={(e) => e.preventDefault()}
          style={{ WebkitTapHighlightColor: 'transparent' }}
          aria-label="Jump to End"
        >
          <SkipForward className="h-3 w-3 text-foreground" />
        </Button>
      )}

      <div className="flex items-center space-x-1">
        <span className="text-xs font-extralight text-text-primary tabular-nums">
          {formatTime(currentTime)}
        </span>
        <span className="text-xs font-extralight text-text-tertiary">
          /
        </span>
        <span className="text-xs font-extralight text-text-secondary tabular-nums">
          {formatTime(totalDuration)}
        </span>
      </div>
    </>
  );
}; 