// Shim to reuse the main app's QE6 adapter logic.
// Lightweight JS reimplementation of buildQuickEdit6RveProject
import { TIMELINE_GRACE_SECONDS } from "./constants";

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toFrames = (seconds, fps) => Math.max(0, Math.round(seconds * fps));

const getAppOrigin = () => {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || "";
};

const preferProxy = (url) => {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  const useProxy = (process.env.NEXT_PUBLIC_USE_MEDIA_PROXY ?? "true").toLowerCase() !== "false";
  if (!useProxy) return url;
  try {
    const target = new URL(url);
    const origin = getAppOrigin();
    if (origin && target.origin === origin) return url;
  } catch {
    return url;
  }
  const proxyPath = process.env.NEXT_PUBLIC_MEDIA_PROXY_PATH || "/api/proxy-video";
  const base = getAppOrigin();
  const prefix = proxyPath.startsWith("http")
    ? proxyPath
    : base
    ? `${base}${proxyPath.startsWith("/") ? "" : "/"}${proxyPath}`
    : proxyPath.startsWith("/")
    ? proxyPath
    : `/${proxyPath}`;
  const separator = prefix.includes("?") ? "&" : "?";
  return `${prefix}${separator}url=${encodeURIComponent(url)}`;
};

const buildCloudinaryTrimUrl = ({ cloudinaryId, start, end, cloudName, fps }) => {
  if (!cloudinaryId || !cloudName) return null;
  const startSafe = Math.max(0, toNumber(start, 0));
  const endSafe = Math.max(startSafe, toNumber(end, startSafe));
  const startStr = startSafe.toFixed(3);
  const endStr = endSafe.toFixed(3);
  const durationSeconds = Math.max(0, endSafe - startSafe);
  const effectiveFps = Math.max(1, toNumber(fps, 30));
  const tinyClipThresholdSeconds = 5 / effectiveFps;
  const keyframeInterval = 1;
  const keyframeTransform = `ki_${keyframeInterval}`;
  const transformParts = [
    `so_${startStr}`,
    `eo_${endStr}`,
    "f_mp4",
    "vc_h264:high",
    "q_auto:good",
    keyframeTransform,
    "fl_splice",
  ];
  const transform = transformParts.join(",");
  return `https://res.cloudinary.com/${cloudName}/video/upload/${transform}/${cloudinaryId}.mp4`;
};

export const buildQuickEdit6RveProject = ({
  plan,
  jobId = null,
  cloudName = null,
  renderUrl = null,
  songUrl = null,
}) => {
  const resolvedCloudName =
    cloudName ||
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || null
      : null);
  const fps = toNumber(plan?.fps, toNumber(plan?.songFormat?.meta?.targetFps, 30)) || 30;
  const graceSeconds = TIMELINE_GRACE_SECONDS;
  const graceFrames = toFrames(graceSeconds, fps);
  const aspectRatio = plan?.songFormat?.meta?.aspectRatio || "16:9";
  const overlays = [];

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

  const resolveSongSrc = () => {
    const explicit =
      songUrl ||
      plan?.songFormat?.source ||
      plan?.songFormat?.audio ||
      plan?.audioUrl ||
      null;
    const slugFallback = plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null;
    const bestSrc = explicit || slugFallback || "/LoveMeAudio.mp3";
    const labelFromSlug = plan?.songSlug || (explicit ? explicit.split("/").pop() : null) || "Song";
    if (bestSrc) return { src: toAbsoluteUrl(bestSrc), label: labelFromSlug };
    if (renderUrl) return { src: toAbsoluteUrl(renderUrl), label: plan?.songSlug || "Render audio", fromRender: true };
    return { src: null, label: "Song" };
  };

  const segments = Array.isArray(plan?.segments) ? plan.segments : [];

  segments.forEach((segment, idx) => {
    const baseStart = graceSeconds + toNumber(segment.startSeconds, 0);
    const baseEnd = toNumber(segment.endSeconds, baseStart);
    const baseDuration = Math.max(0, toNumber(segment.durationSeconds, baseEnd - baseStart));
    const fixedDuration = toFrames(baseDuration, fps);
    const asset = segment.asset || null;
    const startInFrames = toFrames(baseStart, fps);
    const endInFrames = Math.max(startInFrames + fixedDuration, toFrames(baseEnd, fps));

    const videoId = asset?.videoId || asset?.cloudinaryId || null;
    const cloudinaryId = asset?.cloudinaryId || videoId || null;
    const localSrc = asset?.localPath || null;
    const cloudinaryTrim = buildCloudinaryTrimUrl({
      cloudinaryId,
      start: asset?.start ?? baseStart,
      end: asset?.end ?? baseEnd,
      cloudName: resolvedCloudName,
      fps,
    });
    const proxySrc = preferProxy(cloudinaryTrim || asset?.url || null);
    const src = localSrc || proxySrc || cloudinaryTrim || asset?.url || asset?.path || null;

    overlays.push({
      id: idx + 1,
      durationInFrames: Math.max(1, endInFrames - startInFrames),
      from: startInFrames,
      height: 720,
      row: idx % 4,
      left: 0,
      top: 0,
      width: 1280,
      isDragging: false,
      rotation: 0,
      type: "video",
      content: "",
      src: src || undefined,
      styles: {
        opacity: 1,
        zIndex: 1,
        volume: 1,
        playbackRate: 1,
      },
      trimStart: asset?.start ?? baseStart,
      trimEnd: asset?.end ?? baseEnd,
      meta: {
        poolClipId: asset?.poolClipId || null,
        sourcePoolIndex: asset?.sourcePoolIndex ?? null,
      },
    });
  });

  const lastVideoEnd = overlays.reduce((max, overlay) => Math.max(max, (overlay.from || 0) + (overlay.durationInFrames || 0)), 0);
  const durationInFrames = plan?.totalFrames ? toNumber(plan.totalFrames, lastVideoEnd) : lastVideoEnd;
  const highestTrackRow = overlays.reduce(
    (max, overlay) => (Number.isFinite(overlay?.row) ? Math.max(max, overlay.row) : max),
    -1
  );
  const soundRow = highestTrackRow + 1;
  const song = resolveSongSrc();
  const songDurationSeconds = toNumber(plan?.songFormat?.meta?.durationSeconds, 0) || toNumber(plan?.audioDurationSeconds, 0);

  const pushSoundOverlay = (src, label) => {
    if (!src) return;
    const token = jobId || String(Date.now());
    const cacheBustedSrc = toAbsoluteUrl(src, token);
    const soundDuration = Math.max(1, durationInFrames - graceFrames);
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
      content: label,
      src: cacheBustedSrc,
      startFromSound: 0,
      videoDurationInFrames: soundDuration,
      mediaSrcDuration: songDurationSeconds || durationInFrames / fps,
      styles: {
        opacity: 1,
        volume: 1,
      },
    });
  };

  const songFormat = plan?.songFormat || {};
  const soundSrc =
    song.src ||
    songFormat.source ||
    (plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null) ||
    renderUrl ||
    "/LoveMeAudio.mp3";
  const songLabel = songFormat.displayName || song.label || plan?.songSlug || "Song";
  pushSoundOverlay(soundSrc, songLabel);

  return {
    overlays,
    aspectRatio,
    fps,
    durationInFrames,
    backgroundColor: "#000000",
    meta: {
      jobId,
      songSlug: plan?.songSlug || null,
      projectId: jobId ? `qe6-${jobId}` : plan?.songSlug || jobId || null,
      renderUrl: renderUrl ? toAbsoluteUrl(renderUrl, jobId || undefined) : null,
      songUrl: song.src,
      warnings: [],
    },
  };
};
