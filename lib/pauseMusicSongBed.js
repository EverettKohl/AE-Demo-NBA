import { frameToSeconds } from "./frameAccurateTiming.js";

/**
 * Build a pause-music-aware song bed.
 * - Video time is authoritative.
 * - Song time advances only during audible song slices (beat windows).
 * - Silence covers clip overruns; silence does not advance song time.
 *
 * Returns songAudioFilters and songAudioLabels that can be concatenated / mixed downstream.
 */
export const buildPauseMusicSongBed = ({
  segments = [],
  fps = 30,
  timelineSeconds = 0,
  timelineOffsets = new Map(),
}) => {
  const songAudioFilters = [];
  const songAudioLabels = [];
  let songCursor = 0; // song time consumed
  let silenceTotal = 0;
  const debugBeats = [];

  segments.forEach((segment, segIdx) => {
    const beatWindow =
      segment.beatWindowSeconds ??
      frameToSeconds(segment.beatFrameCount || segment.frameCount || 0, fps);
    const clipDur =
      typeof segment.duration === "number"
        ? segment.duration
        : segment.durationSeconds || beatWindow;

    const timelineStart = timelineOffsets.get(segment.index) ?? 0;
    const songStart = typeof segment.songTime === "number" ? segment.songTime : songCursor;

    const songSliceDur = beatWindow; // always play song for the beat window
    const silenceDur = Math.max(0, clipDur - beatWindow); // overrun becomes silence

    // Song slice for the beat window
    if (songSliceDur > 0) {
      const delayMs = Math.max(0, Math.round(timelineStart * 1000));
      songAudioFilters.push(
        `[0:a]atrim=${songStart.toFixed(6)}:${(songStart + songSliceDur).toFixed(
          6
        )},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[sa${segIdx}]`
      );
      songAudioLabels.push(`[sa${segIdx}]`);
      songCursor += songSliceDur;
    }

    // Silence slice covering overrun (clip > beat window)
    if (silenceDur > 0) {
      const silenceDelayMs = Math.max(0, Math.round((timelineStart + beatWindow) * 1000));
      songAudioFilters.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000:d=${silenceDur.toFixed(
          6
        )},adelay=${silenceDelayMs}|${silenceDelayMs}[sl${segIdx}]`
      );
      songAudioLabels.push(`[sl${segIdx}]`);
      silenceTotal += silenceDur;
    }

    debugBeats.push({
      index: segment.index ?? segIdx,
      beatWindow,
      clipDuration: clipDur,
      silenceInserted: silenceDur,
      timelineStart,
      songStart,
    });
  });

  const debug = {
    videoDuration: timelineSeconds,
    songConsumed: songCursor,
    silenceTotal,
    beatCount: segments.length,
    beats: debugBeats,
  };

  return { songAudioFilters, songAudioLabels, debug };
};

export default {
  buildPauseMusicSongBed,
};

