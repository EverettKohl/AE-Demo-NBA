import clipThumbs from "./clip-thumbnails.json";

type ClipThumbEntry =
  | string
  | {
      src: string;
      id?: string;
      cloudinaryId?: string;
      start?: number;
    };

const toSrcList = (items: ClipThumbEntry[]): string[] =>
  items
    .map((item) => (typeof item === "string" ? item : item?.src))
    .filter((v): v is string => Boolean(v));

export const SEEK_ANIMATION_PLACEHOLDERS = toSrcList(clipThumbs as ClipThumbEntry[]);

export type SeekAnimationPlaceholder = (typeof SEEK_ANIMATION_PLACEHOLDERS)[number];

export const preloadSeekAnimationPlaceholders = () => {
  if (typeof window === "undefined") return;
  SEEK_ANIMATION_PLACEHOLDERS.forEach((src) => {
    const img = new Image();
    img.loading = "eager";
    img.decoding = "async";
    img.src = src;
  });
};
