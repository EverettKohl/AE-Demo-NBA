import clipThumbs from "./clip-thumbnails.json";
import nbaClipThumbs from "./nba-clip-thumbnails.json";

type ClipThumbEntry =
  | string
  | {
      src: string;
      id?: string;
      cloudinaryId?: string;
      start?: number;
      playerTag?: string;
    };

type NormalizedEntry = { src: string; playerTag?: string | null };

const toEntries = (items: ClipThumbEntry[]): NormalizedEntry[] =>
  items
    .map((item) =>
      typeof item === "string"
        ? { src: item, playerTag: null }
        : item?.src
        ? { src: item.src, playerTag: item.playerTag ?? null }
        : null
    )
    .filter((v): v is NormalizedEntry => Boolean(v?.src));

const PLACEHOLDER_POOLS: Record<PlaceholderSource, NormalizedEntry[]> = {
  killbill: toEntries(clipThumbs as ClipThumbEntry[]),
  nba: toEntries(nbaClipThumbs as ClipThumbEntry[]),
};

export type PlaceholderSource = "killbill" | "nba";
export type SeekAnimationPlaceholder = string;

export const getSeekAnimationPlaceholders = (source: PlaceholderSource = "killbill", playerTag?: string | null) => {
  const entries = PLACEHOLDER_POOLS[source] || PLACEHOLDER_POOLS.killbill;
  if (source !== "nba" || !playerTag || playerTag === "all") {
    return entries.map((e) => e.src);
  }
  const tag = playerTag.toLowerCase();
  return entries
    .filter((e) => {
      if (e.playerTag) return e.playerTag.toLowerCase() === tag;
      // fallback to filename prefix check if playerTag missing
      return e.src.toLowerCase().includes(`${tag}-`);
    })
    .map((e) => e.src);
};

export const preloadSeekAnimationPlaceholders = (source: PlaceholderSource = "killbill", playerTag?: string | null) => {
  if (typeof window === "undefined") return;
  getSeekAnimationPlaceholders(source, playerTag).forEach((src) => {
    const img = new Image();
    img.loading = "eager";
    img.decoding = "async";
    img.src = src;
  });
};
