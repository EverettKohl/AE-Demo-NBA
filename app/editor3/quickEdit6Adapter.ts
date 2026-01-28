import { OverlayType, type Overlay, type AspectRatio } from "@editor/reactvideoeditor/types";
import { TIMELINE_GRACE_SECONDS } from "./constants";

type QuickEdit6Segment = {
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
    cutFreeVerified?: boolean;
    poolClipId?: string;
    sourcePoolIndex?: number;
    localPath?: string | null;
  } | null;
};

type QuickEdit6Plan = {
  songSlug?: string;
  songFormat?: { source?: string; meta?: { targetFps?: number; durationSeconds?: number } | null } | null;
  fps?: number;
  totalFrames?: number;
  segments?: QuickEdit6Segment[];
};

export type QuickEdit6ImportPayload = {
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

const toFrames = (seconds: number, fps: number) => Math.max(0, Math.round(seconds * fps));

const getAppOrigin = () => {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || "";
};

const preferProxy = (url?: string | null) => {
  if (!url) return null;
  // Only proxy absolute URLs; leave relative/local untouched.
  if (!/^https?:\/\//i.test(url)) return url;
  // Opt-out by setting NEXT_PUBLIC_USE_MEDIA_PROXY=false
  const useProxy = (process.env.NEXT_PUBLIC_USE_MEDIA_PROXY ?? "true").toLowerCase() !== "false";
  if (!useProxy) return url;
  try {
    const target = new URL(url);
    const origin = getAppOrigin();
    if (origin && target.origin === origin) {
      return url; // already same-origin
    }
  } catch {
    return url; // leave relative URLs untouched
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

const buildCloudinaryTrimUrl = ({
  cloudinaryId,
  start,
  end,
  cloudName,
  fps,
}: {
  cloudinaryId?: string | null;
  start?: number;
  end?: number;
  cloudName?: string | null;
  fps?: number;
}) => {
  if (!cloudinaryId || !cloudName) return null;
  const startSafe = Math.max(0, toNumber(start, 0));
  const endSafe = Math.max(startSafe, toNumber(end, startSafe));
  const startStr = startSafe.toFixed(3);
  const endStr = endSafe.toFixed(3);
  const durationSeconds = Math.max(0, endSafe - startSafe);
  const effectiveFps = Math.max(1, toNumber(fps, 30));
  const tinyClipThresholdSeconds = 5 / effectiveFps; // ~3–5 frames
  const isTinyClip = durationSeconds <= tinyClipThresholdSeconds;

  // Force very tight keyframe spacing to ensure a keyframe at/near t=0 for trims.
  // Use the smallest interval (1 frame) to avoid startup gaps on short clips.
  const keyframeInterval = 1;
  const keyframeTransform = `ki_${keyframeInterval}`;

  // Example (for docs/debugging):
  // https://res.cloudinary.com/<cloud>/video/upload/f_auto,q_auto:good,vc_h264:high,ki_15,so_0.000,eo_1.200/<id>.mp4
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

/**
 * Convert a Quick Edit 6 plan into a ReactVideoEditor project payload.
 * The payload can be stashed in sessionStorage and loaded by the editor client.
 */
export const buildQuickEdit6RveProject = ({
  plan,
  jobId = null,
  cloudName = null,
  renderUrl = null,
  songUrl = null,
}: {
  plan: QuickEdit6Plan;
  jobId?: string | null;
  cloudName?: string | null;
  renderUrl?: string | null;
  songUrl?: string | null;
}): QuickEdit6ImportPayload => {
  const resolvedCloudName =
    cloudName ||
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || null
      : null);
  const fps = toNumber(plan?.fps, toNumber((plan?.songFormat as any)?.meta?.targetFps, 30)) || 30;
  const graceSeconds = TIMELINE_GRACE_SECONDS;
  const graceFrames = toFrames(graceSeconds, fps);
  const aspectRatio: AspectRatio =
    ((plan?.songFormat as any)?.meta?.aspectRatio as AspectRatio | undefined) ||
    ("16:9" as AspectRatio);
  const warnings: string[] = [];
  const overlays: Overlay[] = [];

  const toAbsoluteUrl = (src: string | null, jobToken?: string) => {
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

  const resolveSongSrc = (): { src: string | null; label: string; fromRender?: boolean } => {
    const explicit =
      songUrl ||
      plan?.songFormat?.source ||
      (plan?.songFormat as any)?.audio ||
      (plan as any)?.audioUrl ||
      null;
    const slugFallback = plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null;
    const bestSrc = explicit || slugFallback || "/LoveMeAudio.mp3";
    const labelFromSlug = plan?.songSlug || (explicit ? explicit.split("/").pop() : null) || "Song";
    if (bestSrc) {
      return { src: toAbsoluteUrl(bestSrc), label: labelFromSlug };
    }
    if (renderUrl) {
      return { src: toAbsoluteUrl(renderUrl), label: plan?.songSlug || "Render audio", fromRender: true };
    }
    return { src: null, label: "Song" };
  };

  const segments: QuickEdit6Segment[] = Array.isArray(plan?.segments) ? plan.segments : [];

  segments.forEach((segment, idx) => {
    const startSeconds = graceSeconds + toNumber(segment?.startSeconds, 0);
    const durationSeconds =
      toNumber(segment?.durationSeconds, toNumber(segment?.endSeconds, startSeconds) - startSeconds);
    const startFrame = toFrames(startSeconds, fps);
    const durationInFrames = Math.max(1, segment?.frameCount ?? toFrames(durationSeconds, fps));
    const asset = segment?.asset || null;

    const cloudinaryTrimUrl = buildCloudinaryTrimUrl({
      cloudinaryId: asset?.cloudinaryId,
      start: asset?.start ?? startSeconds,
      end: asset?.end ?? startSeconds + durationSeconds,
      cloudName: resolvedCloudName,
      fps,
    });

    const src = preferProxy(cloudinaryTrimUrl) || asset?.localPath || renderUrl;

    if (!src) {
      warnings.push(`Segment ${idx + 1}: missing media source; left placeholder`);
    }

    overlays.push({
      id: idx + 1,
      type: OverlayType.VIDEO,
      row: 0,
      from: startFrame,
      durationInFrames: Math.max(1, durationInFrames),
      left: 0,
      top: 0,
      width: 1280,
      height: 720,
      rotation: 0,
      isDragging: false,
      content: asset?.cloudinaryId || asset?.videoId || asset?.poolClipId || `clip-${idx + 1}`,
      src: src || "",
      videoStartTime: 0, // trimmed Cloudinary URLs already start at the clip's in-point
      mediaSrcDuration: toNumber(
        asset?.end && asset?.start ? asset.end - asset.start : asset?.duration,
        toNumber(asset?.availableDuration, durationSeconds)
      ),
      styles: {
        objectFit: "cover",
        volume: 1,
        animation: { enter: "none", exit: "none" },
      },
    });
  });

  const lastVideoEnd = overlays.reduce((max, overlay) => Math.max(max, (overlay.from || 0) + (overlay.durationInFrames || 0)), 0);
  const durationInFrames = plan?.totalFrames ? toNumber(plan.totalFrames, lastVideoEnd) : lastVideoEnd;

  const highestTrackRow = overlays.reduce(
    (max, overlay) => (Number.isFinite((overlay as any)?.row) ? Math.max(max, (overlay as any).row) : max),
    -1
  );
  const soundRow = highestTrackRow + 1;

  const songDurationSeconds =
    toNumber(plan?.songFormat?.meta?.durationSeconds, 0) || toNumber((plan as any)?.audioDurationSeconds, 0);
  const { src: resolvedSong, label: resolvedSongLabel } = resolveSongSrc();

  const pushSoundOverlay = (src: string | null, label: string) => {
    if (!src) return;
    const durationFrames = Math.max(durationInFrames, lastVideoEnd);
    const soundOffsetFrames = graceFrames;
    const soundDuration = Math.max(1, durationFrames - soundOffsetFrames);
    const token = jobId || String(Date.now());
    const cacheBustedSrc = toAbsoluteUrl(src, token);
    overlays.push({
      id: overlays.length + 1000,
      type: OverlayType.SOUND,
      row: soundRow, // always reserve bottom-most track dynamically
      from: soundOffsetFrames,
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
      mediaSrcDuration: songDurationSeconds || durationFrames / fps,
      styles: {
        opacity: 1,
        volume: 1,
      },
    } as Overlay);
  };

  // Force a single definitive sound source in priority order; no duplicates.
  const songFormat = plan?.songFormat as any;
  const soundSrc =
    resolvedSong ||
    (songFormat?.source ?? null) ||
    (plan?.songSlug ? `/songs/${plan.songSlug}.mp3` : null) ||
    renderUrl ||
    "/LoveMeAudio.mp3";
  const songLabel = songFormat?.displayName ?? resolvedSongLabel ?? plan?.songSlug ?? "Song";
  pushSoundOverlay(soundSrc, songLabel);

  return {
    overlays,
    aspectRatio,
    backgroundColor: "#000000",
    fps,
    durationInFrames,
    meta: {
      jobId,
      songSlug: plan?.songSlug || null,
      projectId: jobId ? `qe6-${jobId}` : null,
      renderUrl,
      songUrl: resolvedSong,
      warnings,
    },
  };
};
