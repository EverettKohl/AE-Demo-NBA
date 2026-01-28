/**
 * Central catalog of Kill Bill video parts stored in Twelve Labs.
 * Each part has an associated env var so we can map user-friendly labels
 * (e.g., Kill_Bill_Vol2_Part3) to their Twelve Labs video IDs.
 */

const VIDEO_PART_DEFINITIONS = [
  {
    label: "Kill_Bill_Vol1_Part1",
    cloudinaryPublicId: "Kill_Bill_Vol1_Part1_30FPS",
    envVar: "TWELVELABS_KILL_BILL_VOL1_PART1_VIDEO_ID",
    defaultVideoId: "69254495b401380ebb921f0d",
    partNumber: 1,
    volume: 1,
    aliases: ["kill bill vol1 part 1", "volume1 part1", "vol1-part1"],
  },
  {
    label: "Kill_Bill_Vol1_Part2",
    cloudinaryPublicId: "Kill_Bill_Vol1_Part2_30FPS",
    envVar: "TWELVELABS_KILL_BILL_VOL1_PART2_VIDEO_ID",
    defaultVideoId: "69254488b401380ebb921f0a",
    partNumber: 2,
    volume: 1,
    aliases: ["kill bill vol1 part 2", "volume1 part2", "vol1-part2"],
  },
  {
    label: "Kill_Bill_Vol2_Part1",
    cloudinaryPublicId: "Kill_Bill_Vol2_Part1_30FPS",
    envVar: "TWELVELABS_KILL_BILL_VOL2_PART1_VIDEO_ID",
    defaultVideoId: "69255fc7c631cdc4fe330a73",
    partNumber: 3,
    volume: 2,
    aliases: ["kill bill vol2 part 1", "volume2 part1", "vol2-part1"],
  },
  {
    label: "Kill_Bill_Vol2_Part2",
    cloudinaryPublicId: "Kill_Bill_Vol2_Part2_30FPS",
    envVar: "TWELVELABS_KILL_BILL_VOL2_PART2_VIDEO_ID",
    defaultVideoId: "69255fe49fbc66589d49dbac",
    partNumber: 4,
    volume: 2,
    aliases: ["kill bill vol2 part 2", "volume2 part2", "vol2-part2"],
  },
  {
    label: "Kill_Bill_Vol2_Part3",
    cloudinaryPublicId: "Kill_Bill_Vol2_Part3_30FPS",
    envVar: "TWELVELABS_KILL_BILL_VOL2_PART3_VIDEO_ID",
    defaultVideoId: "69255ff6c631cdc4fe330a9c",
    partNumber: 5,
    volume: 2,
    aliases: ["kill bill vol2 part 3", "volume2 part3", "vol2-part3"],
  },
];

const normalizeToken = (value) => {
  if (value === null || value === undefined) return "";
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
};

let cachedCatalog = null;

const buildCatalog = () => {
  const parts = VIDEO_PART_DEFINITIONS.map((definition) => {
    const envValue = process.env[definition.envVar]?.trim();
    const videoId = envValue || definition.defaultVideoId;
    if (!videoId) return null;
    const cloudinaryPublicId = definition.cloudinaryPublicId || definition.label;
    const filename = definition.filename || `${cloudinaryPublicId}.mp4`;

    return {
      ...definition,
      videoId,
      cloudinaryPublicId,
      filename,
    };
  }).filter(Boolean);

  const byId = new Map();
  const byPartNumber = new Map();
  const aliasMap = new Map();

  const registerAlias = (alias, videoId) => {
    const normalized = normalizeToken(alias);
    if (normalized) {
      aliasMap.set(normalized, videoId);
    }
  };

  parts.forEach((part) => {
    byId.set(part.videoId, part);
    byPartNumber.set(Number(part.partNumber), part.videoId);

    registerAlias(part.videoId, part.videoId);
    registerAlias(part.label, part.videoId);
    registerAlias(part.cloudinaryPublicId, part.videoId);
    registerAlias(`${part.label}.mp4`, part.videoId);
    registerAlias(`${part.cloudinaryPublicId}.mp4`, part.videoId);
    registerAlias(`volume${part.volume}_part${part.partNumber}`, part.videoId);
    registerAlias(`vol${part.volume}_part${part.partNumber}`, part.videoId);
    registerAlias(`vol${part.volume}${part.partNumber}`, part.videoId);
    registerAlias(`volume${part.volume}${part.partNumber}`, part.videoId);

    (part.aliases || []).forEach((alias) => registerAlias(alias, part.videoId));
  });

  return {
    parts,
    byId,
    byPartNumber,
    aliasMap,
  };
};

const ensureCatalog = () => {
  if (!cachedCatalog) {
    cachedCatalog = buildCatalog();
  }
  return cachedCatalog;
};

export const refreshKillBillVideoCatalog = () => {
  cachedCatalog = buildCatalog();
  return cachedCatalog;
};

export const getKillBillVideoCatalog = () => ensureCatalog();

export const getKillBillVideoParts = () => ensureCatalog().parts.slice();

export const listKillBillVideoIds = () =>
  ensureCatalog()
    .parts.map((part) => part.videoId)
    .filter(Boolean);

export const getKillBillVideoMetadataById = (videoId) => ensureCatalog().byId.get(videoId) || null;

export const getKillBillVideoIdForPart = (partNumber) => {
  const numeric = Number(partNumber);
  if (!Number.isFinite(numeric)) return null;
  return ensureCatalog().byPartNumber.get(numeric) || null;
};

export const resolveKillBillVideoId = (input) => {
  if (input === null || input === undefined) return null;

  if (typeof input === "number" && Number.isFinite(input)) {
    return getKillBillVideoIdForPart(input);
  }

  if (typeof input === "object") {
    if (input.videoId) {
      return resolveKillBillVideoId(input.videoId);
    }
    if (input.partNumber || input.part) {
      return getKillBillVideoIdForPart(input.partNumber ?? input.part);
    }
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const catalog = ensureCatalog();
    if (catalog.byId.has(trimmed)) {
      return trimmed;
    }

    const normalized = normalizeToken(trimmed);
    if (!normalized) return null;
    const aliasMatch = catalog.aliasMap.get(normalized);
    if (aliasMatch) {
      return aliasMatch;
    }
  }

  return null;
};

export const resolveKillBillVideoIds = (selection) => {
  if (selection === null || selection === undefined) {
    return [];
  }

  const inputs = Array.isArray(selection) ? selection : [selection];
  const resolved = [];
  const seen = new Set();

  inputs.forEach((entry) => {
    const candidate = resolveKillBillVideoId(entry);
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      resolved.push(candidate);
    }
  });

  return resolved;
};

export default {
  getKillBillVideoCatalog,
  getKillBillVideoParts,
  getKillBillVideoIdForPart,
  getKillBillVideoMetadataById,
  resolveKillBillVideoId,
  resolveKillBillVideoIds,
  listKillBillVideoIds,
  refreshKillBillVideoCatalog,
};

