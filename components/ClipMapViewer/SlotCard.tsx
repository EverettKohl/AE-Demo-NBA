"use client";

import * as React from "react";
import clsx from "clsx";
import ClipPreviewPlayer from "@/components/ClipPreviewPlayer";
import useCloudinaryCloudName from "@/hooks/useCloudinaryCloudName";
import type { AssignedClipOverride, ClipSlot } from "@/lib/clipMap/types";

const formatSeconds = (seconds: number | null) => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  return `${seconds.toFixed(2)}s`;
};

const kindBadge = (kind: string) => {
  if (kind === "pauseMusic") return "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/40";
  if (kind === "beatLocked") return "bg-emerald-500/15 text-emerald-200 border-emerald-400/40";
  return "bg-slate-500/15 text-slate-200 border-slate-400/40";
};

export default function SlotCard({
  slot,
  effectiveOverride,
  isEdited,
  onEdit,
  onReplace,
  onReselect,
  onClear,
  onActivate,
  active,
}: {
  slot: ClipSlot;
  effectiveOverride: AssignedClipOverride | null;
  isEdited: boolean;
  onEdit: () => void;
  onReplace: () => void;
  onReselect: () => void;
  onClear: () => void;
  onActivate: () => void;
  active: boolean;
}) {
  const { getCloudinaryCloudName } = useCloudinaryCloudName();

  const effective = React.useMemo(() => {
    const base = slot.assignedClip;
    if (!base) return null;
    if (!effectiveOverride) return base;
    return {
      ...base,
      videoId: effectiveOverride.videoId,
      indexId: effectiveOverride.indexId ?? base.indexId ?? null,
      start: effectiveOverride.start,
      end: effectiveOverride.end,
    };
  }, [effectiveOverride, slot.assignedClip]);

  const [hlsUrl, setHlsUrl] = React.useState<string | null>(null);
  const [mp4Url, setMp4Url] = React.useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = React.useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!effective?.videoId) {
        setHlsUrl(null);
        setMp4Url(null);
        setThumbnailUrl(null);
        return;
      }
      setLoadingPreview(true);
      try {
        const indexIdParam = effective.indexId ? `&indexId=${encodeURIComponent(effective.indexId)}` : "";
        const res = await fetch(`/api/getVideo?videoId=${encodeURIComponent(effective.videoId)}${indexIdParam}`);
        if (!res.ok || cancelled) {
          setLoadingPreview(false);
          return;
        }
        const videoDetail = await res.json();
        if (cancelled) return;

        const hls = videoDetail?.hls?.video_url || null;
        setHlsUrl(hls);

        const start = effective.start ?? 0;
        const thumbnailTime = Math.floor(start);
        const thumbs = videoDetail?.hls?.thumbnail_urls || null;
        if (thumbs && typeof thumbs === "object") {
          if (thumbs[thumbnailTime]) {
            setThumbnailUrl(thumbs[thumbnailTime]);
          } else {
            const keys = Object.keys(thumbs);
            if (keys.length) {
              const nearestKey = keys.reduce((prev: string, curr: string) =>
                Math.abs(parseInt(curr, 10) - thumbnailTime) < Math.abs(parseInt(prev, 10) - thumbnailTime) ? curr : prev
              );
              setThumbnailUrl(thumbs[nearestKey]);
            }
          }
        }

        const cloudName = await getCloudinaryCloudName();
        if (!cloudName || cancelled) return;
        const filename = videoDetail?.system_metadata?.filename;
        const cloudinaryId =
          typeof filename === "string" ? filename.replace(/\.mp4$/i, "") : effective.cloudinaryId || effective.videoId;

        const startVal = effective.start ?? 0;
        const endVal = effective.end ?? 0;
        const { startRounded, endRounded } = (await import("@/utils/cloudinary")).buildSafeRange(startVal, endVal);
        if (endRounded > startRounded) {
          setMp4Url(
            `https://res.cloudinary.com/${cloudName}/video/upload/so_${startRounded},eo_${endRounded},f_mp4/${cloudinaryId}.mp4`
          );
        } else {
          setMp4Url(null);
        }
      } catch {
        if (!cancelled) {
          setHlsUrl(null);
          setMp4Url(null);
          setThumbnailUrl(null);
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [effective?.videoId, effective?.indexId, effective?.start, effective?.end, effective?.cloudinaryId, getCloudinaryCloudName]);

  return (
    <div
      className={clsx(
        "rounded-2xl border bg-white/5 overflow-hidden transition",
        active ? "border-emerald-400/60 ring-1 ring-emerald-400/30" : "border-white/10 hover:border-white/20"
      )}
      onClick={onActivate}
      role="button"
      tabIndex={0}
    >
      <div className="p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs font-mono text-white/70 shrink-0">#{slot.order + 1}</div>
          <div
            className={clsx(
              "text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide border shrink-0",
              kindBadge(slot.constraints.kind)
            )}
          >
            {slot.constraints.kind}
          </div>
          {isEdited && (
            <div className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide border bg-amber-500/10 text-amber-200 border-amber-400/30">
              edited
            </div>
          )}
        </div>
        <div className="text-xs text-white/60 text-right">
          {slot.constraints.kind === "beatLocked" ? (
            <>
              <div className="font-semibold text-white/80">Locked</div>
              <div>{formatSeconds(slot.targetDuration)}</div>
            </>
          ) : (
            <>
              <div className="font-semibold text-white/80">Duration</div>
              <div>{formatSeconds(effective ? effective.end - effective.start : null)}</div>
            </>
          )}
        </div>
      </div>

      <div className="aspect-video bg-black/40">
        {loadingPreview && !hlsUrl && !mp4Url ? (
          <div className="w-full h-full flex items-center justify-center text-white/50 text-sm">Loading preview…</div>
        ) : effective ? (
          <ClipPreviewPlayer
            hlsUrl={hlsUrl || undefined}
            mp4Url={mp4Url || undefined}
            thumbnailUrl={thumbnailUrl || undefined}
            startTime={Math.floor(effective.start ?? 0)}
            endTime={Math.ceil(effective.end ?? 0)}
            playing={playing}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/50 text-sm">No clip assigned</div>
        )}
      </div>

      <div className="p-3 flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex-1 px-3 py-2 rounded-lg border border-white/15 text-xs font-semibold text-white/80 hover:text-white hover:border-white/30"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReplace();
          }}
          className="flex-1 px-3 py-2 rounded-lg border border-emerald-400/40 text-xs font-semibold text-emerald-200 hover:text-emerald-100 hover:border-emerald-400/70"
        >
          Search
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReselect();
          }}
          className="flex-1 px-3 py-2 rounded-lg border border-white/15 text-xs font-semibold text-white/80 hover:text-white hover:border-white/30"
        >
          Randomize
        </button>
        {isEdited && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="px-3 py-2 rounded-lg border border-amber-400/30 text-xs font-semibold text-amber-200 hover:text-amber-100 hover:border-amber-400/60"
            title="Clear override"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

