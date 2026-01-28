import fs from "fs";
import path from "path";

const SONG_FORMATS_DIR_6 = path.join(process.cwd(), "data", "song-formats-6");

export const loadSongFormat6 = (slug) => {
  const formatPath = path.join(SONG_FORMATS_DIR_6, `${slug}.json`);
  if (!fs.existsSync(formatPath)) {
    throw new Error(`Song format not found: ${slug}`);
  }
  const content = fs.readFileSync(formatPath, "utf-8");
  return JSON.parse(content);
};

export const listSongFormats6 = () => {
  if (!fs.existsSync(SONG_FORMATS_DIR_6)) {
    return [];
  }

  const files = fs.readdirSync(SONG_FORMATS_DIR_6);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const slug = file.replace(/\.json$/, "");
      try {
        const format = loadSongFormat6(slug);
        return {
          slug,
          displayName: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          source: format.source,
          duration: format.meta?.durationSeconds || 0,
          bpm: format.meta?.bpm || null,
          beatCount: format.beatGrid?.length || 0,
          rapidRangeCount: format.rapidClipRanges?.length || 0,
          totalClips: format.meta?.totalClips || format.clipSegments?.length || 0,
          captions: format.captions
            ? {
                enabled: typeof format.captions.enabled === "boolean" ? format.captions.enabled : true,
                status: format.captions.status || "ready",
              }
            : null,
        };
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean);
};

