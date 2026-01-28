import React, { useEffect, useState } from "react";
import { BaseItemContentProps } from "../timeline-item-content-factory";
import { getPosterForVideoAt } from "../../../../../utils/remotion/components/helpers/poster-cache";

interface PosterData {
  isPoster?: boolean;
  posterKind?: "head" | "tail";
  posterTime?: number;
  posterSrc?: string;
  src?: string;
  fallbackThumbnail?: string;
  overlayId?: number;
}

export const PosterItemContent: React.FC<BaseItemContentProps> = ({
  data,
  itemWidth,
}) => {
  const { posterKind, posterSrc, posterTime, src, fallbackThumbnail } = (data || {}) as PosterData;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const useSrc = posterSrc || fallbackThumbnail || src;
    if (!useSrc || posterTime === undefined || posterTime === null) {
      console.warn("[PosterItemContent] Missing source or time", { useSrc, posterTime, posterKind });
      return;
    }
    getPosterForVideoAt(useSrc, posterTime, posterKind || "head")
      .then((res) => {
        if (cancelled) return;
        if (res) {
          setUrl(res);
        } else if (fallbackThumbnail) {
          setUrl(fallbackThumbnail);
        } else {
          // Fallback: use the source URL directly if capture fails
          setUrl(useSrc);
        }
      })
      .catch((err) => {
        console.warn("[PosterItemContent] failed to fetch poster", err);
        if (!cancelled) {
          setUrl(fallbackThumbnail || useSrc || null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [posterSrc, posterTime, posterKind, fallbackThumbnail, src]);

  const label = posterKind === "tail" ? "Tail poster" : "Head poster";

  return (
    <div
      className="w-full h-full rounded-sm overflow-hidden border border-white/20 relative"
      style={{
        backgroundColor: "rgba(34,197,94,0.15)",
      }}
    >
      {url && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.9,
          }}
        />
      )}
      <div
        className="relative flex items-center h-full px-2 text-[10px] text-white/90 truncate"
        style={{
          backdropFilter: url ? "brightness(0.85)" : undefined,
        }}
      >
        <div
          className="w-2 h-2 rounded-full mr-2 flex-shrink-0"
          style={{
            backgroundColor: posterKind === "tail" ? "rgba(14,165,233,0.9)" : "rgba(34,197,94,0.9)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
          }}
        />
        <span className="truncate">{label}</span>
        {itemWidth > 80 && (
          <span className="ml-2 text-white/60 truncate">
            {(posterTime ?? 0).toFixed(2)}s
          </span>
        )}
      </div>
    </div>
  );
};
