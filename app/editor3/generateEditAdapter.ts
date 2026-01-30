import { OverlayType, type Overlay, type AspectRatio } from "@editor/reactvideoeditor/types";
import { frameToTime, timeToFrame } from "./reactvideoeditor/utils/time";
import { TIMELINE_GRACE_SECONDS } from "./constants";
import { getDimensionsForAspectRatio } from "./reactvideoeditor/utils/aspect-ratio-transform";
import { publicSongTracks } from "./reactvideoeditor/adaptors/default-audio-adaptors";

type GenerateEditSegment = {
  index?: number;
  startSeconds?: number;
  endSeconds?: number;
  durationSeconds?: number;
  frameCount?: number;
  asset?: {
    indexId?: string | null;
    videoId?: string | null;
    cloudinaryId?: string | null;
    start?: number;
    end?: number;
    duration?: number;
    availableDuration?: number;
    sourcePoolIndex?: number | null;
    localPath?: string | null;
  } | null;
};

type GenerateEditPlan = {
  songSlug?: string;
  songFormat?: {
    source?: string;
    meta?: {
      targetFps?: number;
      durationSeconds?: number;
      aspectRatio?: AspectRatio;
      sourceWidth?: number;
      sourceHeight?: number;
    } | null;
  } | null;
  fps?: number;
  totalFrames?: number;
  segments?: GenerateEditSegment[];
};

export type GenerateEditImportPayload = {
  overlays: Overlay[];
  aspectRatio: AspectRatio;
  backgroundColor?: string | null;
  fps: number;
  durationInFrames: number;
  meta: {
    jobId?: string | null;
    songSlug?: string | null;
    projectId?: string | null;
    renderUrl?: string | null;
    songUrl?: string | null;
    warnings?: string[];
  };
};

const toNumber = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const ONE_FRAME = (fps: number) => (fps > 0 ? 1 / fps : 0);

const clampVolume = (value: any, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

const resolveLocalSongUrl = (songSlug?: string | null): string | null => {
  if (!songSlug) return null;
  const match = publicSongTracks.find((track) => {
    const base = track.id.replace(/\.[^/.]+$/, "");
    return base.toLowerCase() === songSlug.toLowerCase();
  });
  return match?.file ?? null;
};

const toAbsoluteUrl = (src?: string | null, jobToken?: string | null) => {
  if (!src) return null;
  const base =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || null)) ||
    (typeof window !== "undefined" ? window.location.origin : null);
  const isRemote = /^https?:\/\//i.test(src);
  const abs = (() => {
    if (isRemote) return src;
    if (base) return `${base}${src.startsWith("/") ? src : `/${src}`}`;
    return src.startsWith("/") ? src : `/${src}`;
  })();
  // Only tag remote URLs with the job token; local static assets (e.g. /songs/*.mp3,
  // /instant-clips/*.mp4) should stay cacheable and avoid unexpected 404s from
  // deploy previews.
  if (!jobToken || !isRemote) return abs;
  const separator = abs.includes("?") ? "&" : "?";
  return `${abs}${separator}job=${encodeURIComponent(jobToken)}&ts=${Date.now()}`;
};

/**
 * Convert a Generate Edit plan into a ReactVideoEditor project payload that uses
 * locally materialized MP4s (no Cloudinary streaming). The plan is expected to
 * have `asset.localPath` populated per segment.
 */
export const buildGenerateEditRveProject = ({
  plan,
  jobId = null,
  songUrl = null,
}: {
  plan: GenerateEditPlan;
  jobId?: string | null;
  songUrl?: string | null;
}): GenerateEditImportPayload => {
  const fps = toNumber(plan?.fps, toNumber(plan?.songFormat?.meta?.targetFps, 30)) || 30;
  const graceSeconds = TIMELINE_GRACE_SECONDS;
  const aspectRatio: AspectRatio =
    ((plan?.songFormat as any)?.meta?.aspectRatio as AspectRatio | undefined) || ("16:9" as AspectRatio);
  const metaWidth = toNumber((plan?.songFormat as any)?.meta?.sourceWidth, 0);
  const metaHeight = toNumber((plan?.songFormat as any)?.meta?.sourceHeight, 0);
  const { width: canvasWidth, height: canvasHeight } =
    metaWidth > 0 && metaHeight > 0
      ? { width: metaWidth, height: metaHeight }
      : getDimensionsForAspectRatio(aspectRatio);
  const overlays: Overlay[] = [];

  const segments: GenerateEditSegment[] = Array.isArray(plan?.segments) ? plan.segments : [];

  // Normalize segments to ensure continuous, gap-free timeline in seconds, then convert to frames.
  let cursorSeconds = graceSeconds;
  let pauseOverhangOffset = 0; // cumulative offset from pauseMusic overhangs
  const normalized = segments.map((segment, idx) => {
    const asset = segment?.asset || null;
    const pauseMusic = Boolean((segment as any)?.beatMetadata?.clipSlot?.pauseMusic);
    const intent = (segment as any)?.beatMetadata?.intent || null;
    const clipVolume = clampVolume((segment as any)?.beatMetadata?.clipSlot?.clipVolume, 1);
    const isRapidRange = Boolean((segment as any)?.isInRapidRange);
    const beatWindowSeconds = toNumber((segment as any)?.beatWindowSeconds, null);
    const hasStart = Number.isFinite(segment?.startSeconds);
    const baseStart = hasStart ? toNumber(segment?.startSeconds, 0) + graceSeconds : cursorSeconds;

    // Derive duration: explicit durationSeconds, else frameCount/fps, else asset duration
    const durationSeconds = Math.max(
      0,
      toNumber(
        segment?.durationSeconds,
        segment?.frameCount ? segment.frameCount / fps : toNumber(asset?.duration, toNumber(asset?.availableDuration, 0))
      )
    );

    const startSeconds = baseStart + pauseOverhangOffset;
    const endSeconds = toNumber(segment?.endSeconds, startSeconds + durationSeconds);
    const finalDurationSeconds = Math.max(0, durationSeconds || endSeconds - startSeconds);
    const finalEndSeconds = startSeconds + finalDurationSeconds;

    // If this is a pauseMusic slot, compute overhang beyond the beat window and shift future segments by it.
    const beatWindow = Math.max(beatWindowSeconds ?? finalDurationSeconds, 0);
    const overhang = pauseMusic ? Math.max(0, finalDurationSeconds - beatWindow) : 0;
    pauseOverhangOffset += overhang;

    cursorSeconds = finalEndSeconds;

    return {
      idx,
      asset,
      startSeconds,
      endSeconds: finalEndSeconds,
      durationSeconds: finalDurationSeconds,
      pauseMusic,
      intent,
      beatTime: Math.max(startSeconds - graceSeconds, 0),
      beatWindowSeconds: beatWindow,
      clipVolume,
      isRapidRange,
    };
  });

  const hasRapidRanges = normalized.some((seg) => seg.isRapidRange);
  const hasPauseClips = normalized.some((seg) => seg.pauseMusic && seg.clipVolume > 0);
  const hasAudibleNonPause = normalized.some((seg) => !seg.pauseMusic && seg.clipVolume > 0);
  const hasMutedClips = normalized.some((seg) => seg.clipVolume <= 0);
  const needsMutedRow = hasMutedClips || hasRapidRanges;

  let nextRow = 0;
  const pauseRow = hasPauseClips ? nextRow++ : null;
  const audibleRow = hasAudibleNonPause || (!hasPauseClips && normalized.some((seg) => seg.clipVolume > 0)) ? nextRow++ : null;
  const mutedRow = needsMutedRow ? nextRow++ : null;

  normalized.forEach(
    ({
      idx,
      asset,
      startSeconds,
      endSeconds,
      durationSeconds,
      pauseMusic,
      intent,
      beatTime,
      clipVolume,
      isRapidRange,
    }) => {
    const localSrc = asset?.localPath || null;
    const publicSrc = (asset as any)?.publicPath || null;
    const chosenSrc = publicSrc || localSrc || "";
    const durationInFrames = Math.max(1, timeToFrame(durationSeconds, fps));
    const frameDurationSec = ONE_FRAME(fps);
    const lastFrameStartSec = Math.max(durationSeconds - frameDurationSec, 0);

    const makeOverlay = (
      row: number,
      offsetSeconds: number,
      idSeed: number,
      frozenLastFrame = false,
      extras?: {
        pauseMusic?: boolean;
        intent?: string | null;
        beatTime?: number | null;
        clipVolume?: number;
        trackMuted?: boolean;
      }
    ) => {
      const placedStartSeconds = startSeconds + offsetSeconds;
      const placedEndSeconds = endSeconds + offsetSeconds;
      const startFrame = timeToFrame(placedStartSeconds, fps);

      const videoStartTime = frozenLastFrame ? lastFrameStartSec : 0;
      const mediaSrcDuration = frozenLastFrame ? frameDurationSec : durationSeconds;

      return {
        id: idSeed,
        type: OverlayType.VIDEO,
        row,
        from: startFrame,
        durationInFrames,
        left: 0,
        top: 0,
        width: canvasWidth,
        height: canvasHeight,
        rotation: 0,
        isDragging: false,
        content: asset?.cloudinaryId || asset?.videoId || `clip-${idSeed}`,
        src: chosenSrc,
        videoStartTime,
        mediaSrcDuration,
        styles: {
          objectFit: "cover",
          objectPosition: "center center",
          volume: typeof extras?.clipVolume === "number" ? extras.clipVolume : 1,
          animation: { enter: "none", exit: "none" },
        },
        trimStart: asset?.start ?? startSeconds,
        trimEnd: asset?.end ?? endSeconds,
        meta: {
          cloudinaryId: asset?.cloudinaryId ?? null,
          videoId: asset?.videoId ?? null,
          indexId: asset?.indexId ?? null,
          sourcePoolIndex: asset?.sourcePoolIndex ?? null,
          start: asset?.start ?? startSeconds,
          end: asset?.end ?? endSeconds,
          durationSeconds,
          startFrame,
          durationInFrames,
          startSeconds: placedStartSeconds,
          endSeconds: placedEndSeconds,
          offsetSeconds,
          frozenLastFrame,
          freezeSourceStartSeconds: frozenLastFrame ? videoStartTime : undefined,
          pauseMusic: Boolean(extras?.pauseMusic),
          intent: extras?.intent ?? null,
          beatTime: typeof extras?.beatTime === "number" ? extras?.beatTime : null,
          clipVolume: typeof extras?.clipVolume === "number" ? extras.clipVolume : undefined,
        },
      } as Overlay;
    };

    const isSilentClip = clipVolume <= 0;
    const isRapid = Boolean(isRapidRange);
    const targetRow =
      (isRapid || isSilentClip) && mutedRow !== null
        ? mutedRow
        : pauseMusic && pauseRow !== null
        ? pauseRow
        : audibleRow !== null
        ? audibleRow
        : mutedRow ?? pauseRow ?? 0;
    const effectiveVolume = isRapid ? 0 : clipVolume;

    const overlay = makeOverlay(targetRow, 0, overlays.length + 1, false, {
      pauseMusic,
      intent,
      beatTime,
      clipVolume: effectiveVolume,
      trackMuted: isSilentClip || isRapid,
    });

    // Carry initial track mute state so the timeline renders the muted row muted.
    (overlay as any).trackMuted = isSilentClip || isRapid;
    (overlay as any).meta = {
      ...(overlay as any).meta,
      isRapidRange: isRapid,
      originalClipVolume: clipVolume,
    };
    overlays.push(overlay);
  });

  const lastVideoEnd = overlays.reduce(
    (max, overlay) => Math.max(max, (overlay.from || 0) + (overlay.durationInFrames || 0)),
    0
  );
  const highestVideoRow = overlays.reduce(
    (max, overlay) => (Number.isFinite((overlay as any)?.row) ? Math.max(max, (overlay as any).row) : max),
    -1
  );
  const soundRow = highestVideoRow + 1;

  const localSongFromSlug = resolveLocalSongUrl(plan?.songSlug);
  const song =
    songUrl ||
    plan?.songFormat?.source ||
    localSongFromSlug ||
    (plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null) ||
    "/songs/LoveMeAudio.mp3";
  const songLabel =
    (plan?.songFormat as any)?.displayName ||
    plan?.songSlug ||
    (localSongFromSlug ? "Public Song" : "Song");
  const pauseSegments = normalized.filter((seg) => seg.pauseMusic);

  if (song) {
    const cacheBustedSrc = toAbsoluteUrl(song, jobId || undefined);
    const songDurationSeconds = toNumber(plan?.songFormat?.meta?.durationSeconds, 0) || frameToTime(lastVideoEnd, fps);
    const audioSlices: Overlay[] = [];
    let audioId = overlays.length + 1000;
    let songPointer = 0; // seconds into source song
    let timelineCursor = graceSeconds; // seconds on timeline where next audio slice will start

    const pushAudioSlice = (startSeconds: number, durationSeconds: number, sourceOffsetSeconds: number) => {
      if (durationSeconds <= 0) return;
      const sliceDurationFrames = Math.max(1, timeToFrame(durationSeconds, fps));
      audioSlices.push({
        id: audioId++,
        type: OverlayType.SOUND,
        row: soundRow,
        from: timeToFrame(startSeconds, fps),
        durationInFrames: sliceDurationFrames,
        left: 0,
        top: 0,
        width: canvasWidth,
        height: 100,
        rotation: 0,
        isDragging: false,
        content: songLabel,
        src: cacheBustedSrc || song || "",
        startFromSound: timeToFrame(sourceOffsetSeconds, fps),
        videoDurationInFrames: sliceDurationFrames,
        mediaSrcDuration: songDurationSeconds,
        styles: {
          opacity: 1,
          volume: 1,
        },
      } as Overlay);
    };

    const sortedPauses = pauseSegments
      .map((seg) => ({
        beatTime: Math.max(seg.beatTime ?? 0, 0), // timeline time including prior silence
        duration: Math.max(seg.durationSeconds || 0, 0),
        beatWindow: Math.max(seg.beatWindowSeconds || seg.durationSeconds || 0, 0),
      }))
      .sort((a, b) => a.beatTime - b.beatTime);

    let silenceAccum = 0; // total silence inserted so far (overhangs)

    sortedPauses.forEach(({ beatTime, duration, beatWindow }) => {
      const overhang = Math.max(0, duration - beatWindow);

      // Convert timeline beatTime to song time by removing accumulated silence.
      const songBeatTime = Math.max(0, beatTime - silenceAccum);
      const playUntilSong = songBeatTime + beatWindow;
      const playableDuration = Math.max(0, playUntilSong - songPointer);

      if (playableDuration > 0) {
        pushAudioSlice(timelineCursor, playableDuration, songPointer);
        timelineCursor += playableDuration;
        songPointer += playableDuration;
      }

      // Insert silence only for overhang; advance timeline but not song pointer.
      timelineCursor += overhang;
      silenceAccum += overhang;
    });

    const remaining = Math.max(0, songDurationSeconds - songPointer);
    if (remaining > 0) {
      pushAudioSlice(timelineCursor, remaining, songPointer);
      timelineCursor += remaining;
      songPointer += remaining;
    }

    overlays.push(...audioSlices);
  }

  const lastAudioEnd = overlays
    .filter((o) => o.type === OverlayType.SOUND)
    .reduce((max, overlay) => Math.max(max, (overlay.from || 0) + (overlay.durationInFrames || 0)), 0);
  const durationInFrames = Math.max(
    plan?.totalFrames ? toNumber(plan.totalFrames, 0) : 0,
    lastVideoEnd,
    lastAudioEnd
  );
  const durationInSeconds = frameToTime(durationInFrames, fps);

  return {
    overlays,
    aspectRatio,
    backgroundColor: "#000000",
    fps,
    durationInFrames,
    meta: {
      jobId,
      songSlug: plan?.songSlug || null,
      projectId: jobId ? `ge-${jobId}` : plan?.songSlug || jobId || null,
      renderUrl: null,
      songUrl: song ? toAbsoluteUrl(song, jobId || undefined) : null,
      warnings: [],
    },
  };
};
