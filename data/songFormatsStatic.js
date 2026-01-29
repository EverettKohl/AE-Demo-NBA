/**
 * Static song format fallbacks that are bundled with the app.
 * These are intentionally minimal but valid, so the editor always has formats even
 * if filesystem-based JSON is missing or malformed in production.
 */
export const STATIC_SONG_FORMATS = [
  "bingbingbing",
  "cinemaedit",
  "double-take",
  "electric",
  "factory",
  "fashionkilla",
  "loveme",
  "lovemeaudio",
  "pieceofheaven",
  "slowmospanish",
  "touchthesky",
  "uptosomething",
  "way-down-we-go",
].map((slug) => ({
  slug,
  // Use an existing bundled audio file so serverless can find it.
  source: "/LoveMeAudio.mp3",
  meta: {
    durationSeconds: 120,
    targetFps: 30,
    totalClips: 0,
  },
  beatGrid: Array.from({ length: 30 }, (_, i) => i * 4),
  rapidClipRanges: [],
  beatMetadata: [],
  layers: [],
}));

export const getStaticFormatBySlug = (slug) =>
  STATIC_SONG_FORMATS.find((f) => f.slug === slug) || null;
