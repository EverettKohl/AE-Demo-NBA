// Generate Edit -> ReactVideoEditor adapter using locally materialized MP4s.
import { TIMELINE_GRACE_SECONDS } from "./constants";

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toFrames = (seconds, fps) => Math.max(0, Math.round(seconds * fps));

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

const clampVolume = (value, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

export const buildGenerateEditRveProject = ({ plan, jobId = null, songUrl = null }) => {
  const fps = toNumber(plan?.fps, toNumber(plan?.songFormat?.meta?.targetFps, 30)) || 30;
  const graceSeconds = TIMELINE_GRACE_SECONDS;
  const graceFrames = toFrames(graceSeconds, fps);
  const aspectRatio = (plan?.songFormat?.meta?.aspectRatio) || "16:9";
  const overlays = [];

  const segments = Array.isArray(plan?.segments) ? plan.segments : [];

  const clipVolumes = segments.map((segment) => clampVolume(segment?.beatMetadata?.clipSlot?.clipVolume, 1));
  const rapidRanges = segments.map((segment) => Boolean(segment?.isInRapidRange));
  const hasRapid = rapidRanges.some(Boolean);
  const hasMutedClips = clipVolumes.some((v) => v <= 0);
  const hasAudibleClips = clipVolumes.some((v) => v > 0);
  let nextRow = 0;
  const rapidRow = hasRapid ? nextRow++ : null;
  const audibleRow = hasAudibleClips ? nextRow++ : null;
  const mutedRow = hasMutedClips ? nextRow++ : null;

  segments.forEach((segment, idx) => {
    const startSeconds = graceSeconds + toNumber(segment?.startSeconds, 0);
    const endSeconds = toNumber(segment?.endSeconds, startSeconds);
    const durationSeconds = Math.max(0, toNumber(segment?.durationSeconds, endSeconds - startSeconds));
    const startFrame = toFrames(startSeconds, fps);
    const durationInFrames = Math.max(1, segment?.frameCount ?? toFrames(durationSeconds, fps));
    const asset = segment?.asset || null;
    const localSrc = asset?.localPath || null;

    const clipVolume = clipVolumes[idx] ?? 1;
    const isRapid = rapidRanges[idx];
    const isSilentClip = clipVolume <= 0;
    const targetRow =
      isRapid && rapidRow !== null
        ? rapidRow
        : isSilentClip && mutedRow !== null
        ? mutedRow
        : audibleRow ?? 0;

    const overlay = {
      id: idx + 1,
      type: "video",
      row: targetRow,
      from: startFrame,
      durationInFrames,
      left: 0,
      top: 0,
      width: 1280,
      height: 720,
      rotation: 0,
      isDragging: false,
      content: asset?.cloudinaryId || asset?.videoId || `clip-${idx + 1}`,
      src: localSrc || "",
      videoStartTime: 0,
      mediaSrcDuration: toNumber(
        asset?.end && asset?.start ? asset.end - asset.start : asset?.duration,
        durationSeconds
      ),
      styles: {
        objectFit: "cover",
        volume: isRapid ? 0 : clipVolume,
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
        clipVolume,
        isRapidRange: isRapid,
        originalClipVolume: clipVolume,
      },
    };

    overlay.trackMuted = isSilentClip || isRapid;
    overlays.push(overlay);
  });

  const lastVideoEnd = overlays.reduce(
    (max, overlay) => Math.max(max, (overlay.from || 0) + (overlay.durationInFrames || 0)),
    0
  );
  const durationInFrames = plan?.totalFrames ? toNumber(plan.totalFrames, lastVideoEnd) : lastVideoEnd;

  const highestTrackRow = overlays.reduce(
    (max, overlay) => (Number.isFinite(overlay?.row) ? Math.max(max, overlay.row) : max),
    -1
  );
  const soundRow = highestTrackRow + 1;

  const song =
    songUrl ||
    plan?.songFormat?.source ||
    (plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null) ||
    "/LoveMeAudio.mp3";
  const songLabel = plan?.songFormat?.displayName || plan?.songSlug || "Song";

  if (song) {
    const cacheBustedSrc = toAbsoluteUrl(song, jobId || undefined);
    // Keep full audio length; duration already includes grace offset
    const soundDuration = Math.max(1, durationInFrames);
    overlays.push({
      id: overlays.length + 1000,
      type: "sound",
      row: soundRow,
      from: graceFrames,
      durationInFrames: soundDuration,
      left: 0,
      top: 0,
      width: 1920,
      height: 100,
      rotation: 0,
      isDragging: false,
      content: songLabel,
      src: cacheBustedSrc || song || "",
      startFromSound: 0,
      videoDurationInFrames: soundDuration,
      mediaSrcDuration: toNumber(plan?.songFormat?.meta?.durationSeconds, durationInFrames / fps),
      styles: {
        opacity: 1,
        volume: 1,
      },
    });
  }

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
