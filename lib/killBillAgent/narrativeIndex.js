import fs from "fs";
import path from "path";

const DEFAULT_MOVIE_ID = "kill_bill_volumes_1_2";
const DATA_DIR = path.join(process.cwd(), "data");
const OUTPUT_DIR = path.join(DATA_DIR, "narrative-index");

const roundSeconds = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
};

const ratio = (part, total) => {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((part / total) * 1000) / 1000;
};

const dedupeList = (items = []) => {
  const seen = new Set();
  const ordered = [];
  for (const item of items) {
    const trimmed = typeof item === "string" ? item.trim() : item;
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
};

const slugify = (value, fallback) => {
  const source = value || fallback || "";
  const slug = source
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return `chapter-${Math.random().toString(36).slice(2, 7)}`;
};

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const safeReadJson = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[NarrativeIndex] Failed to read ${filePath}: ${error.message}`);
    return null;
  }
};

const safeWriteJson = (filePath, data) => {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
};

const computeDialogueCoverageSeconds = (segments = []) => {
  const ranges = segments
    .map((segment) => {
      const start = Number(segment.startGlobalSeconds);
      const end = Number(segment.endGlobalSeconds);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      return { start, end: Math.max(end, start) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (!ranges.length) {
    return 0;
  }

  let total = 0;
  let currentStart = ranges[0].start;
  let currentEnd = ranges[0].end;

  for (let i = 1; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (range.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, range.end);
    } else {
      total += currentEnd - currentStart;
      currentStart = range.start;
      currentEnd = range.end;
    }
  }

  total += currentEnd - currentStart;
  return Math.max(0, total);
};

const buildSceneName = (scene, screenplayScene) => {
  if (scene?.title) return scene.title;
  const location = screenplayScene?.location || scene?.location;
  const timeOfDay = screenplayScene?.timeOfDay || scene?.timeOfDay;
  if (location && timeOfDay) return `${location} (${timeOfDay})`;
  if (location) return location;
  if (timeOfDay) return `Scene (${timeOfDay})`;
  if (scene?.id) return `Scene ${scene.id}`;
  return "Unknown scene";
};

const buildNarrativePurpose = (scene, screenplayScene) => {
  const source = [
    ...(scene?.keyActions || []),
    ...(screenplayScene?.keyActions || []),
  ]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  if (source.length === 0) {
    if (scene?.location) {
      return `Action at ${scene.location}${scene.timeOfDay ? ` (${scene.timeOfDay})` : ""}.`;
    }
    return "Story beat without explicit description.";
  }

  return source.slice(0, 2).join(" ");
};

const buildVisualNotes = (screenplayScene, enrichmentNotes) => {
  const combined = [
    ...(screenplayScene?.keyActions || []),
    ...(Array.isArray(enrichmentNotes) ? enrichmentNotes : enrichmentNotes ? [enrichmentNotes] : []),
  ];
  return dedupeList(combined).slice(0, 5);
};

const buildCharacterList = (segments = [], fallbackNames = [], normalizeName = (value) => value) => {
  const counts = new Map();
  const register = (rawName) => {
    const normalized = normalizeName(rawName);
    if (!normalized) return;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  };

  segments.forEach((segment) => register(segment.character));
  fallbackNames.forEach((name) => register(name));

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 6);
};

const buildToneTags = ({ dialogueDensity, silenceDensity, visualNotes }) => {
  const tags = new Set();

  if (Number.isFinite(dialogueDensity)) {
    if (dialogueDensity >= 0.65) {
      tags.add("dialogue-heavy");
    } else if (dialogueDensity <= 0.25) {
      tags.add("silence-heavy");
    } else {
      tags.add("balanced-dialogue");
    }
  }

  if (Number.isFinite(silenceDensity) && silenceDensity >= 0.5) {
    tags.add("visual-heavy");
  }

  if ((visualNotes?.length || 0) >= 3) {
    tags.add("visual-descriptive");
  }

  if (!tags.size) {
    tags.add("neutral");
  }

  return Array.from(tags);
};

const aggregateTopValues = (items = [], limit = 3) => {
  const counts = new Map();
  for (const value of items) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value)
    .slice(0, limit);
};

const buildChapterSummary = (chapter, chapterScenes, durationSeconds) => {
  const sceneCount = chapterScenes.length;
  const minutes = Number.isFinite(durationSeconds) ? Math.max(1, Math.round(durationSeconds / 60)) : null;
  const locationList = aggregateTopValues(chapterScenes.map((scene) => scene.location).filter(Boolean), 2);
  const characterList = aggregateTopValues(
    chapterScenes.flatMap((scene) => scene.charactersPresent || []),
    3
  );

  const parts = [];
  parts.push(`Contains ${sceneCount} scene${sceneCount === 1 ? "" : "s"}.`);
  if (minutes) {
    parts.push(`Covers roughly ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  if (characterList.length) {
    parts.push(`Focus on ${characterList.join(", ")}.`);
  }
  if (locationList.length) {
    parts.push(`Key locations: ${locationList.join(", ")}.`);
  }

  const summary = parts.join(" ");
  if (summary) return summary;
  return `Chapter ${chapter.title || chapter.number || ""}`.trim();
};

const formatDurationStats = (scene) => {
  if (!Number.isFinite(scene.startGlobalSeconds) || !Number.isFinite(scene.endGlobalSeconds)) {
    return {
      durationSeconds: null,
      dialogueDensity: null,
      silenceDensity: null,
      silenceDurationSeconds: null,
    };
  }

  const durationSeconds = Math.max(0, scene.endGlobalSeconds - scene.startGlobalSeconds);
  const dialogueDurationSeconds = Number.isFinite(scene.dialogueDurationSeconds)
    ? scene.dialogueDurationSeconds
    : 0;
  const silenceDurationSeconds = Math.max(0, durationSeconds - dialogueDurationSeconds);

  return {
    durationSeconds: roundSeconds(durationSeconds),
    dialogueDensity: ratio(dialogueDurationSeconds, durationSeconds),
    silenceDensity: ratio(silenceDurationSeconds, durationSeconds),
    silenceDurationSeconds: roundSeconds(silenceDurationSeconds),
  };
};

const prepareVisualEnrichmentMap = (enrichment = {}) => {
  const map = new Map();
  if (enrichment.visualSceneNotes instanceof Map) {
    enrichment.visualSceneNotes.forEach((value, key) => {
      if (key) map.set(key, value);
    });
    return map;
  }
  if (Array.isArray(enrichment.visualSceneNotes)) {
    enrichment.visualSceneNotes.forEach((entry) => {
      if (entry?.sceneId) {
        map.set(entry.sceneId, entry.notes || entry.description || []);
      }
    });
    return map;
  }
  if (enrichment.visualSceneNotes && typeof enrichment.visualSceneNotes === "object") {
    Object.entries(enrichment.visualSceneNotes).forEach(([sceneId, notes]) => {
      if (sceneId) {
        map.set(sceneId, notes);
      }
    });
  }
  return map;
};

const buildSceneRecords = ({
  transcriptScenes = [],
  transcriptChapters = [],
  screenplaySceneMap,
  mergedSegments,
  normalizeName = (value) => value,
  enrichment = {},
}) => {
  const visualNotesMap = prepareVisualEnrichmentMap(enrichment);
  const segmentsByScene = new Map();

  mergedSegments.forEach((segment) => {
    if (!segment?.sceneId) return;
    if (!segmentsByScene.has(segment.sceneId)) {
      segmentsByScene.set(segment.sceneId, []);
    }
    segmentsByScene.get(segment.sceneId).push(segment);
  });

  const sceneToChapterId = new Map();
  transcriptChapters.forEach((chapter, idx) => {
    const chapterId = slugify(chapter.number || chapter.title || `chapter-${idx + 1}`);
    (chapter.scenes || []).forEach((sceneId) => {
      if (sceneId) {
        sceneToChapterId.set(sceneId, chapterId);
      }
    });
  });

  const sceneRecords = transcriptScenes.map((scene, idx) => {
    const screenplayScene = screenplaySceneMap.get(scene.id) || null;
    const segments = segmentsByScene.get(scene.id) || [];

    const start = segments.length
      ? Math.min(...segments.map((segment) => Number(segment.startGlobalSeconds)).filter(Number.isFinite))
      : null;
    const end = segments.length
      ? Math.max(...segments.map((segment) => Number(segment.endGlobalSeconds)).filter(Number.isFinite))
      : null;
    const dialogueDurationSeconds = computeDialogueCoverageSeconds(segments);

    return {
      id: scene.id || `scene-${idx + 1}`,
      chapterId: sceneToChapterId.get(scene.id) || null,
      name: buildSceneName(scene, screenplayScene),
      location: screenplayScene?.location || scene.location || null,
      intExt: screenplayScene?.intExt || scene.intExt || null,
      timeOfDay: screenplayScene?.timeOfDay || scene.timeOfDay || null,
      lineNumber: scene.lineNum || idx,
      startGlobalSeconds: Number.isFinite(start) ? roundSeconds(start) : null,
      endGlobalSeconds: Number.isFinite(end) ? roundSeconds(end) : null,
      timingMethod: segments.length ? "dialogueAnchors" : "unresolved",
      dialogueDurationSeconds: roundSeconds(dialogueDurationSeconds),
      charactersPresent: buildCharacterList(
        segments,
        screenplayScene?.characters || scene?.characters || [],
        normalizeName
      ),
      narrativePurpose: buildNarrativePurpose(scene, screenplayScene),
      visualNotes: buildVisualNotes(screenplayScene, visualNotesMap.get(scene.id)),
      dialogueCount: segments.length,
      screenplayContext: {
        keyActions: screenplayScene?.keyActions || [],
      },
    };
  });

  // Pass 2: interpolate missing timings using neighbors
  const orderedScenes = [...sceneRecords].sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0));
  const findPrev = (index) => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (Number.isFinite(orderedScenes[i].endGlobalSeconds)) {
        return orderedScenes[i];
      }
    }
    return null;
  };
  const findNext = (index) => {
    for (let i = index + 1; i < orderedScenes.length; i += 1) {
      if (Number.isFinite(orderedScenes[i].startGlobalSeconds)) {
        return orderedScenes[i];
      }
    }
    return null;
  };

  orderedScenes.forEach((scene, idx) => {
    const prevScene = findPrev(idx);
    const nextScene = findNext(idx);

    if (!Number.isFinite(scene.startGlobalSeconds) && prevScene?.endGlobalSeconds != null) {
      scene.startGlobalSeconds = prevScene.endGlobalSeconds;
      scene.timingMethod = scene.timingMethod === "dialogueAnchors" ? "dialogueAnchors" : "neighborInterpolation";
    }
    if (!Number.isFinite(scene.endGlobalSeconds) && nextScene?.startGlobalSeconds != null) {
      scene.endGlobalSeconds = nextScene.startGlobalSeconds;
      scene.timingMethod = scene.timingMethod === "dialogueAnchors" ? "dialogueAnchors" : "neighborInterpolation";
    }
    if (
      !Number.isFinite(scene.startGlobalSeconds) &&
      !Number.isFinite(scene.endGlobalSeconds) &&
      prevScene?.endGlobalSeconds != null &&
      nextScene?.startGlobalSeconds != null
    ) {
      scene.startGlobalSeconds = prevScene.endGlobalSeconds;
      scene.endGlobalSeconds = nextScene.startGlobalSeconds;
      scene.timingMethod = "neighborInterpolation";
    }

    if (
      Number.isFinite(scene.startGlobalSeconds) &&
      Number.isFinite(scene.endGlobalSeconds) &&
      scene.endGlobalSeconds < scene.startGlobalSeconds
    ) {
      scene.endGlobalSeconds = scene.startGlobalSeconds;
    }
  });

  // Pass 3: finalize derived stats
  return orderedScenes.map((scene) => {
    const { durationSeconds, dialogueDensity, silenceDensity, silenceDurationSeconds } = formatDurationStats(scene);
    const toneTags = buildToneTags({
      dialogueDensity,
      silenceDensity,
      visualNotes: scene.visualNotes,
    });
    return {
      id: scene.id,
      chapterId: scene.chapterId,
      name: scene.name,
      location: scene.location,
      intExt: scene.intExt,
      timeOfDay: scene.timeOfDay,
      startGlobalSeconds: Number.isFinite(scene.startGlobalSeconds) ? scene.startGlobalSeconds : null,
      endGlobalSeconds: Number.isFinite(scene.endGlobalSeconds) ? scene.endGlobalSeconds : null,
      durationSeconds,
      dialogueDurationSeconds: scene.dialogueDurationSeconds,
      silenceDurationSeconds,
      dialogueDensity,
      silenceDensity,
      toneTags,
      charactersPresent: scene.charactersPresent,
      narrativePurpose: scene.narrativePurpose,
      visualNotes: scene.visualNotes,
      dialogueCount: scene.dialogueCount,
      timingMethod: scene.timingMethod,
      lineNumber: scene.lineNumber,
    };
  });
};

const buildChapters = ({ transcriptChapters = [], sceneRecords }) => {
  const sceneMap = new Map(sceneRecords.map((scene) => [scene.id, scene]));
  return transcriptChapters.map((chapter, idx) => {
    const chapterId = slugify(chapter.number || chapter.title || `chapter-${idx + 1}`);
    const chapterScenes = (chapter.scenes || []).map((sceneId) => sceneMap.get(sceneId)).filter(Boolean);

    const start = Math.min(
      ...chapterScenes.map((scene) => scene.startGlobalSeconds).filter(Number.isFinite)
    );
    const end = Math.max(...chapterScenes.map((scene) => scene.endGlobalSeconds).filter(Number.isFinite));
    const durationSeconds =
      Number.isFinite(start) && Number.isFinite(end) ? roundSeconds(Math.max(0, end - start)) : null;

    const locations = aggregateTopValues(chapterScenes.map((scene) => scene.location).filter(Boolean), 4);
    const primaryCharacters = aggregateTopValues(
      chapterScenes.flatMap((scene) => scene.charactersPresent || []),
      5
    );
    const toneTags = dedupeList(chapterScenes.flatMap((scene) => scene.toneTags || []));
    const narrativeSummary = buildChapterSummary(chapter, chapterScenes, durationSeconds);

    return {
      id: chapterId,
      number: chapter.number || null,
      title: chapter.title || `Chapter ${idx + 1}`,
      startGlobalSeconds: Number.isFinite(start) ? roundSeconds(start) : null,
      endGlobalSeconds: Number.isFinite(end) ? roundSeconds(end) : null,
      durationSeconds,
      narrativeSummary,
      locations,
      primaryCharacters,
      toneTags,
      scenes: chapterScenes.map((scene) => ({ ...scene })),
    };
  });
};

export const generateNarrativeIndex = ({
  movieId = DEFAULT_MOVIE_ID,
  dataSources = {},
  enrichment = {},
  helpers = {},
} = {}) => {
  const transcriptScenes = dataSources?.transcript?.sceneIndex || [];
  const transcriptChapters = dataSources?.transcript?.chapters || [];
  const screenplayChapters = dataSources?.screenplay?.chapters || [];
  const mergedSegments = dataSources?.mergedTranscript?.segments || [];

  const screenplaySceneMap = new Map();
  screenplayChapters.forEach((chapter) => {
    (chapter.scenes || []).forEach((scene) => {
      if (scene?.id) {
        screenplaySceneMap.set(scene.id, scene);
      }
    });
  });

  const normalizeName =
    typeof helpers.normalizeCharacterName === "function"
      ? helpers.normalizeCharacterName
      : (name) => (name || "").trim();

  const sceneRecords = buildSceneRecords({
    transcriptScenes,
    transcriptChapters,
    screenplaySceneMap,
    mergedSegments,
    normalizeName,
    enrichment,
  });

  const chapters = buildChapters({
    transcriptChapters,
    sceneRecords,
  });

  const coverageEnd = Math.max(
    ...sceneRecords.map((scene) => scene.endGlobalSeconds).filter(Number.isFinite),
    0
  );
  const dialogueCoverage = sceneRecords
    .map((scene) => Number(scene.dialogueDurationSeconds) || 0)
    .reduce((acc, value) => acc + value, 0);

  return {
    movieId,
    generatedAt: new Date().toISOString(),
    stats: {
      chapterCount: chapters.length,
      sceneCount: sceneRecords.length,
      coverageSeconds: roundSeconds(coverageEnd),
      dialogueCoverageSeconds: roundSeconds(dialogueCoverage),
    },
    chapters,
    scenes: sceneRecords,
  };
};

export const getNarrativeIndexPath = (movieId = DEFAULT_MOVIE_ID) => {
  return path.join(OUTPUT_DIR, `${movieId}.json`);
};

export const loadNarrativeIndexFromDisk = ({ movieId = DEFAULT_MOVIE_ID } = {}) => {
  const filePath = getNarrativeIndexPath(movieId);
  return safeReadJson(filePath);
};

export const persistNarrativeIndex = (index, { movieId = DEFAULT_MOVIE_ID } = {}) => {
  if (!index) return;
  const filePath = getNarrativeIndexPath(movieId);
  safeWriteJson(filePath, index);
};

export const loadOrGenerateNarrativeIndex = ({
  movieId = DEFAULT_MOVIE_ID,
  dataSources,
  forceRefresh = false,
  enrichment,
  helpers,
} = {}) => {
  if (!forceRefresh) {
    const cached = loadNarrativeIndexFromDisk({ movieId });
    if (cached) {
      return cached;
    }
  }

  const generated = generateNarrativeIndex({
    movieId,
    dataSources,
    enrichment,
    helpers,
  });
  persistNarrativeIndex(generated, { movieId });
  return generated;
};

export const getChapterById = (narrativeIndex, chapterId) => {
  if (!narrativeIndex?.chapters || !chapterId) return null;
  return narrativeIndex.chapters.find((chapter) => chapter.id === chapterId) || null;
};

export const getSceneById = (narrativeIndex, sceneId) => {
  if (!narrativeIndex?.scenes || !sceneId) return null;
  return narrativeIndex.scenes.find((scene) => scene.id === sceneId) || null;
};

export const resolveNarrativeScope = ({
  narrativeIndex,
  chapterId,
  sceneId,
  startGlobalSeconds,
  endGlobalSeconds,
}) => {
  if (!narrativeIndex) {
    return null;
  }

  if (sceneId) {
    const scene = getSceneById(narrativeIndex, sceneId);
    if (scene) {
      return {
        label: scene.name,
        startGlobalSeconds: scene.startGlobalSeconds,
        endGlobalSeconds: scene.endGlobalSeconds,
        sceneIds: [scene.id],
        chapterId: scene.chapterId,
        characters: scene.charactersPresent || [],
        locations: scene.location ? [scene.location] : [],
      };
    }
  }

  if (chapterId) {
    const chapter = getChapterById(narrativeIndex, chapterId);
    if (chapter) {
      return {
        label: chapter.title,
        startGlobalSeconds: chapter.startGlobalSeconds,
        endGlobalSeconds: chapter.endGlobalSeconds,
        sceneIds: chapter.scenes?.map((scene) => scene.id) || [],
        chapterId: chapter.id,
        characters: chapter.primaryCharacters || [],
        locations: chapter.locations || [],
      };
    }
  }

  if (Number.isFinite(startGlobalSeconds) || Number.isFinite(endGlobalSeconds)) {
    return {
      label: "custom-window",
      startGlobalSeconds: Number.isFinite(startGlobalSeconds) ? startGlobalSeconds : null,
      endGlobalSeconds: Number.isFinite(endGlobalSeconds) ? endGlobalSeconds : null,
      sceneIds: [],
      characters: [],
      locations: [],
    };
  }

  return null;
};

export default {
  generateNarrativeIndex,
  loadNarrativeIndexFromDisk,
  loadOrGenerateNarrativeIndex,
  persistNarrativeIndex,
  getNarrativeIndexPath,
  getChapterById,
  getSceneById,
  resolveNarrativeScope,
};
