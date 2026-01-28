import fs from "fs";
import path from "path";

const VARIANTS_ROOT = path.join(process.cwd(), "data", "instant-edit-variants");
const PUBLIC_ROOT = path.join(process.cwd(), "public", "instant-edits");

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[instantVariants] Failed to read JSON", filePath, err);
    return null;
  }
};

const writeJsonAtomic = (filePath, data) => {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
};

const decodeDataUrlToBuffer = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const parts = dataUrl.split(",");
  if (parts.length < 2) return null;
  return Buffer.from(parts[1], "base64");
};

export const loadVariantManifest = (songSlug) => {
  if (!songSlug) return { songSlug: "", parts: [], clipVariants: [] };
  const filePath = path.join(VARIANTS_ROOT, `${songSlug}.json`);
  const data = readJsonSafe(filePath) || {};
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const clipVariants = Array.isArray(data.clipVariants) ? data.clipVariants : [];
  return { songSlug, parts, clipVariants };
};

export const saveVariantManifest = (songSlug, manifest) => {
  if (!songSlug) return;
  const filePath = path.join(VARIANTS_ROOT, `${songSlug}.json`);
  writeJsonAtomic(filePath, manifest);
};

export const generateVariantId = ({ songSlug, variantSeed }) => {
  const ts = Date.now();
  const seedPart = variantSeed ? String(variantSeed) : "seed";
  return `${songSlug || "song"}-${seedPart}-${ts}`;
};

export const summarizeClipsFromPlan = (plan) => {
  const segments = Array.isArray(plan?.segments) ? plan.segments : [];
  return segments.map((seg) => {
    const asset = seg?.asset || {};
    return asset.poolClipId || asset.videoId || asset.cloudinaryId || asset.sourcePoolIndex || null;
  });
};

export const derivePartSlices = () => [];

export const persistPartEntry = ({ songSlug, entry }) => {
  if (!songSlug) throw new Error("songSlug is required to persist part");
  const manifest = loadVariantManifest(songSlug);
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  parts.unshift(entry);
  manifest.parts = parts;
  saveVariantManifest(songSlug, manifest);
  return entry;
};

export const persistPartEntries = ({ songSlug, entries = [] }) => {
  if (!songSlug) throw new Error("songSlug is required to persist parts");
  const manifest = loadVariantManifest(songSlug);
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  manifest.parts = [...entries, ...parts];
  saveVariantManifest(songSlug, manifest);
  return entries;
};

export const listVariants = () => [];

export const listParts = (songSlug = null) => {
  if (songSlug) {
    const manifest = loadVariantManifest(songSlug);
    return Array.isArray(manifest.parts) ? manifest.parts : [];
  }
  if (!fs.existsSync(VARIANTS_ROOT)) return [];
  const files = fs.readdirSync(VARIANTS_ROOT).filter((f) => f.endsWith(".json"));
  const all = [];
  files.forEach((file) => {
    const data = readJsonSafe(path.join(VARIANTS_ROOT, file));
    if (Array.isArray(data?.parts)) {
      all.push(...data.parts);
    }
  });
  return all;
};

export const listClipVariants = (songSlug = null) => {
  if (songSlug) {
    const manifest = loadVariantManifest(songSlug);
    return manifest.clipVariants || [];
  }
  if (!fs.existsSync(VARIANTS_ROOT)) return [];
  const files = fs.readdirSync(VARIANTS_ROOT).filter((f) => f.endsWith(".json"));
  const all = [];
  files.forEach((file) => {
    const data = readJsonSafe(path.join(VARIANTS_ROOT, file));
    if (Array.isArray(data?.clipVariants)) {
      all.push(...data.clipVariants);
    }
  });
  return all;
};

export const updatePartEntry = (songSlug, partId, patch = {}) => {
  if (!songSlug || !partId) return null;
  const manifest = loadVariantManifest(songSlug);
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  const idx = parts.findIndex((p) => p.id === partId);
  if (idx === -1) return null;
  const updated = { ...parts[idx], ...patch };
  parts[idx] = updated;
  manifest.parts = parts;
  saveVariantManifest(songSlug, manifest);
  return updated;
};

export const deletePartEntry = (songSlug, partId) => {
  if (!songSlug || !partId) return false;
  const manifest = loadVariantManifest(songSlug);
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  const next = parts.filter((p) => p.id !== partId);
  const changed = next.length !== parts.length;
  if (!changed) return false;
  manifest.parts = next;
  saveVariantManifest(songSlug, manifest);
  return true;
};

export const persistClipVariant = ({ songSlug, clipKey, variantSeed, replacementClip, source = "hub" }) => {
  if (!songSlug || !clipKey) {
    throw new Error("songSlug and clipKey are required");
  }
  const manifest = loadVariantManifest(songSlug);
  manifest.clipVariants = Array.isArray(manifest.clipVariants) ? manifest.clipVariants : [];
  const entry = {
    id: `${clipKey}-${Date.now()}`,
    songSlug,
    clipKey,
    variantSeed: variantSeed ?? null,
    replacementClip,
    source,
    createdAt: new Date().toISOString(),
  };
  manifest.clipVariants.unshift(entry);
  saveVariantManifest(songSlug, manifest);
  return entry;
};

