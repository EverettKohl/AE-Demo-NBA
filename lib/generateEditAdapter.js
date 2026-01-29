const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toFrames = (seconds, fps) => Math.max(0, Math.round(seconds * fps));
const frameToTime = (frame, fps) => {
  const timeInSeconds = frame / fps;
  return Math.round(timeInSeconds * 1000) / 1000;
};
const timeToFrame = (seconds, fps) => {
  const precise = Math.round(seconds * 1000) / 1000;
  return Math.max(0, Math.round(precise * fps));
};

const clampVolume = (value, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

const getCanvasDimensionsForAspectRatio = (aspectRatio) => {
  switch (aspectRatio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "4:5":
      return { width: 1080, height: 1350 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "1.85:1":
      return { width: 1998, height: 1080 };
    case "2.39:1":
      return { width: 2560, height: 1070 };
    case "16:9":
    default:
      return { width: 1920, height: 1080 };
  }
};

const toAbsoluteUrl = (src, jobToken) => {
  if (!src) return null;
  const base =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || null)) ||
    (typeof window !== "undefined" ? window.location.origin : null);
  const abs = (() => {
    if (/^https?:\/\//i.test(src)) return src;
    if (base) return `${base}${src.startsWith("/") ? src : `/${src}`}`;
    return src.startsWith("/") ? src : `/${src}`;
  })();
  if (!jobToken) return abs;
  const separator = abs.includes("?") ? "&" : "?";
  return `${abs}${separator}job=${encodeURIComponent(jobToken)}&ts=${Date.now()}`;
};

export const buildGenerateEditRveProject = ({ plan, jobId = null, songUrl = null }) => {
  const GRACE_SECONDS = 1;
  const fps = toNumber(plan?.fps, toNumber(plan?.songFormat?.meta?.targetFps, 30)) || 30;
  const aspectRatio = (plan?.songFormat?.meta?.aspectRatio) || "16:9";
  const metaWidth = toNumber(plan?.songFormat?.meta?.sourceWidth, null);
  const metaHeight = toNumber(plan?.songFormat?.meta?.sourceHeight, null);
  const { width: canvasWidth, height: canvasHeight } =
    metaWidth && metaHeight ? { width: metaWidth, height: metaHeight } : getCanvasDimensionsForAspectRatio(aspectRatio);
  const overlays = [];
  const warnings = [];
  const hasLocalPaths = Array.isArray(plan?.segments)
    ? plan.segments.some((s) => s?.asset?.localPath)
    : false;
  const useLocalClips = Boolean(plan?.meta?.useLocalClips || plan?.useLocalClips || hasLocalPaths);

  const segments = Array.isArray(plan?.segments) ? plan.segments : [];

  // Normalize to gap-free seconds on a single primary track, seeded with grace.
  let cursorSeconds = GRACE_SECONDS;
  let pauseOverhangOffset = 0;
  const normalized = segments.map((segment, idx) => {
    const asset = segment?.asset || null;
    const pauseMusic = Boolean(segment?.beatMetadata?.clipSlot?.pauseMusic);
    const intent = segment?.beatMetadata?.intent || null;
    const clipVolume = clampVolume(segment?.beatMetadata?.clipSlot?.clipVolume, 1);
    const isRapidRange = Boolean(segment?.isInRapidRange);
    const beatWindowSeconds = toNumber(segment?.beatWindowSeconds, null);
    const hasStart = Number.isFinite(segment?.startSeconds);
    const baseStart = hasStart ? GRACE_SECONDS + toNumber(segment?.startSeconds, 0) : cursorSeconds;

    const durationSeconds = Math.max(
      0,
      toNumber(
        segment?.durationSeconds,
        segment?.frameCount ? segment.frameCount / fps : toNumber(asset?.duration, toNumber(asset?.availableDuration, 0))
      )
    );

    const startSeconds = baseStart + pauseOverhangOffset;
    const endSecondsRaw = toNumber(segment?.endSeconds, startSeconds + durationSeconds);
    const finalDurationSeconds = Math.max(0, durationSeconds || endSecondsRaw - startSeconds);
    const finalEndSeconds = startSeconds + finalDurationSeconds;

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
      beatTime: Math.max(startSeconds - GRACE_SECONDS, 0),
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

  const addOverlay = (base, row, offsetSeconds, idSeed, extras = {}) => {
    const placedStartSeconds = base.startSeconds + offsetSeconds;
    const placedEndSeconds = base.endSeconds + offsetSeconds;
    const startFrame = timeToFrame(placedStartSeconds, fps);
    const durationInFrames = Math.max(1, timeToFrame(base.durationSeconds, fps));
    const localSrc = base.asset?.localPath || null;
    const remoteSrc =
      base.asset?.clipUrl ||
      base.asset?.videoUrl ||
      base.asset?.url ||
      base.asset?.path ||
      null;
    const resolvedSrc = localSrc || remoteSrc || "";
    if (useLocalClips && !localSrc) {
      warnings.push("Local clip missing for a segment; falling back to remote URL where available.");
    }

    overlays.push({
      id: idSeed,
      type: "video",
      row,
      from: startFrame,
      durationInFrames,
      left: 0,
      top: 0,
      width: canvasWidth,
      height: canvasHeight,
      rotation: 0,
      isDragging: false,
      content: base.asset?.cloudinaryId || base.asset?.videoId || `clip-${idSeed}`,
      src: resolvedSrc,
      videoStartTime: 0,
      mediaSrcDuration: base.durationSeconds,
      styles: {
        objectFit: "cover",
        objectPosition: "center center",
        volume: typeof extras?.clipVolume === "number" ? extras.clipVolume : 1,
        animation: { enter: "none", exit: "none" },
        zIndex: 1,
      },
      trimStart: base.asset?.start ?? base.startSeconds,
      trimEnd: base.asset?.end ?? base.endSeconds,
      meta: {
        cloudinaryId: base.asset?.cloudinaryId ?? null,
        videoId: base.asset?.videoId ?? null,
        indexId: base.asset?.indexId ?? null,
        sourcePoolIndex: base.asset?.sourcePoolIndex ?? null,
        start: base.asset?.start ?? base.startSeconds,
        end: base.asset?.end ?? base.endSeconds,
        durationSeconds: base.durationSeconds,
        startFrame,
        durationInFrames,
        startSeconds: placedStartSeconds,
        endSeconds: placedEndSeconds,
        offsetSeconds,
        pauseMusic: Boolean(extras.pauseMusic),
        intent: extras.intent || null,
        beatTime: typeof extras.beatTime === "number" ? extras.beatTime : null,
        clipVolume: typeof extras?.clipVolume === "number" ? extras.clipVolume : undefined,
      },
    });
  };

  normalized.forEach((segment) => {
    const isSilentClip = segment.clipVolume <= 0;
    const isRapid = Boolean(segment.isRapidRange);
    const targetRow =
      (isRapid || isSilentClip) && mutedRow !== null
        ? mutedRow
        : segment.pauseMusic && pauseRow !== null
        ? pauseRow
        : audibleRow !== null
        ? audibleRow
        : mutedRow ?? pauseRow ?? 0;

    addOverlay(segment, targetRow, 0, overlays.length + 1, {
      pauseMusic: segment.pauseMusic,
      intent: segment.intent,
      beatTime: segment.beatTime,
      clipVolume: isRapid ? 0 : segment.clipVolume,
      trackMuted: isSilentClip || isRapid,
    });

    const lastOverlay = overlays[overlays.length - 1];
    if (lastOverlay) {
      lastOverlay.trackMuted = isSilentClip || isRapid;
      lastOverlay.meta = {
        ...(lastOverlay.meta || {}),
        isRapidRange: isRapid,
        originalClipVolume: segment.clipVolume,
      };
    }
  });

  const lastVideoEnd = overlays.reduce(
    (max, overlay) => Math.max(max, (overlay.from || 0) + (overlay.durationInFrames || 0)),
    0
  );
  const highestVideoRow = overlays.reduce(
    (max, overlay) => (Number.isFinite(overlay?.row) ? Math.max(max, overlay.row) : max),
    -1
  );
  const soundRow = highestVideoRow + 1;

  const song =
    songUrl ||
    plan?.songFormat?.source ||
    (plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null) ||
    "/LoveMeAudio.mp3";
  const songLabel = plan?.songFormat?.displayName || plan?.songSlug || "Song";
  const pauseSegments = normalized.filter((seg) => seg.pauseMusic);

  if (song) {
    let resolvedSong = song;
    // If we are in local-only mode and the song is a remote URL, prefer local fallbacks.
    if (useLocalClips && /^https?:\/\//i.test(resolvedSong)) {
      resolvedSong = (plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null) || "/LoveMeAudio.mp3";
      warnings.push("Remote song source replaced with local fallback");
    }
    const cacheBustedSrc = toAbsoluteUrl(resolvedSong, jobId || undefined);
    const songDurationSeconds =
      toNumber(plan?.songFormat?.meta?.durationSeconds, 0) || frameToTime(lastVideoEnd, fps);
    const audioSlices = [];
    let audioId = overlays.length + 1000;
    let songPointer = 0; // seconds into source song
    let timelineCursor = GRACE_SECONDS; // timeline seconds where next audio slice will start

    const pushAudioSlice = (startSeconds, durationSeconds, sourceOffsetSeconds) => {
      if (durationSeconds <= 0) return;
      const sliceDurationFrames = Math.max(1, timeToFrame(durationSeconds, fps));
      audioSlices.push({
        id: audioId++,
        type: "sound",
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
      });
    };

    const sortedPauses = pauseSegments
      .map((seg) => ({
        beatTime: Math.max(seg.beatTime || 0, 0),
        duration: Math.max(seg.durationSeconds || 0, 0),
        beatWindow: Math.max(seg.beatWindowSeconds || seg.durationSeconds || 0, 0),
      }))
      .sort((a, b) => a.beatTime - b.beatTime);

    let silenceAccum = 0;

    sortedPauses.forEach(({ beatTime, duration, beatWindow }) => {
      const overhang = Math.max(0, duration - beatWindow);
      const songBeatTime = Math.max(0, beatTime - silenceAccum);
      const playUntilSong = songBeatTime + beatWindow;
      const playableDuration = Math.max(0, playUntilSong - songPointer);
      if (playableDuration > 0) {
        pushAudioSlice(timelineCursor, playableDuration, songPointer);
        timelineCursor += playableDuration;
        songPointer += playableDuration;
      }

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

  if (useLocalClips) {
    const missingVideo = overlays.filter((o) => o.type === "video" && !(o.src && o.src.trim())).length;
    if (missingVideo > 0) {
      throw new Error("One or more video overlays are missing local src. Materialize clips first.");
    }
  }

  const lastAudioEnd = overlays
    .filter((o) => o.type === "sound")
    .reduce((max, overlay) => Math.max(max, (overlay.from || 0) + (overlay.durationInFrames || 0)), 0);
  const durationInFrames = Math.max(
    plan?.totalFrames ? toNumber(plan.totalFrames, 0) : 0,
    lastVideoEnd,
    lastAudioEnd
  );

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
      warnings,
    },
  };
};
