/**
 * Data Loader for Kill Bill Agent
 * Provides cached, lazy-loaded access to all data sources
 */

import fs from "fs";
import path from "path";
import { loadMovieIndex as loadMovieIndexFromLib } from "../movieIndex.js";
import { getVideoIdForPart, getCanonicalVideoId } from "./utils.js";
import { loadOrGenerateNarrativeIndex } from "./narrativeIndex.js";

// Cache for loaded data
let dataCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const DATA_DIR = path.join(process.cwd(), "data");
const TRANSCRIPT_PATH = path.join(DATA_DIR, "killBillTranscript.json");
const SCREENPLAY_PATH = path.join(DATA_DIR, "killBillScreenplay.json");
const CHARACTERS_PATH = path.join(DATA_DIR, "killBillCharacters.json");
const MANIFEST_PATH = path.join(DATA_DIR, "killBillMovieManifest.json");
const SCENE_TIMELINE_PATH = path.join(DATA_DIR, "scene-timestamps.json");
const TRANSCRIPTS_ROOT = path.join(DATA_DIR, "transcripts", "kill-bill");
const MERGED_WORDS_PATH = path.join(TRANSCRIPTS_ROOT, "merged-words.json");
const MERGED_SEGMENTS_PATH = path.join(TRANSCRIPTS_ROOT, "merged-segments.json");

const safeReadJson = (filePath, fallbackValue, warnLabel) => {
  try {
    if (!fs.existsSync(filePath)) {
      if (warnLabel) console.warn(`[DataLoader] ${warnLabel} file not found at ${filePath}`);
      return fallbackValue;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[DataLoader] Failed to read ${filePath}: ${error.message}`);
    return fallbackValue;
  }
};

const buildSceneIndexMap = (sceneIndex = []) => {
  const map = new Map();
  for (const scene of sceneIndex) {
    if (scene?.id) {
      map.set(scene.id, scene);
    }
  }
  return map;
};

const loadTranscript = () => {
  const transcript = safeReadJson(
    TRANSCRIPT_PATH,
    {
      allDialogue: [],
      characterIndex: {},
      sceneIndex: [],
      chapters: [],
      searchIndex: {},
    },
    "Transcript"
  );

  transcript.sceneIndexById = buildSceneIndexMap(transcript.sceneIndex);
  return transcript;
};

/**
 * Load screenplay/scene structure data
 */
const loadScreenplay = () => {
  return safeReadJson(
    SCREENPLAY_PATH,
    {
      scenes: [],
      chapters: [],
      characterSceneIndex: {},
    },
    "Screenplay"
  );
};

/**
 * Load character data
 */
const loadCharacters = () => {
  return safeReadJson(CHARACTERS_PATH, [], "Characters");
};

const loadSceneTimeline = () => {
  return safeReadJson(SCENE_TIMELINE_PATH, [], "Scene timeline");
};

export const normalizeCharacterName = (name) => {
  if (!name) return "";
  
  // Remove parentheticals like (V.O.), (O.S.), (CONT'D)
  let normalized = name.replace(/\s*\([^)]+\)\s*$/g, "").trim().toUpperCase();
  
  // Map variations to canonical names
  const mappings = {
    "THE BRIDE": "THE BRIDE",
    "BRIDE": "THE BRIDE",
    "BEATRIX": "THE BRIDE",
    "BEATRIX KIDDO": "THE BRIDE",
    "KIDDO": "THE BRIDE",
    "BILL'S VOICE": "BILL",
    "MAN'S VOICE": "BILL",
    "VERNITA GREEN": "VERNITA GREEN",
    "VERNITA GREEN": "VERNITA GREEN",
    "O-REN": "O-REN ISHII",
    "OREN": "O-REN ISHII",
    "ELLE": "ELLE DRIVER",
    "HANZO": "HATTORI HANZO",
    "GOGO": "GOGO YUBARI",
    "SOFIE": "SOFIE FATALE",
    "PAI MEI *": "PAI MEI",
    "THE BRIDE *": "THE BRIDE",
  };

  return mappings[normalized] || normalized;
};

export const loadManifest = () => {
  return safeReadJson(
    MANIFEST_PATH,
    {
      movieId: "kill_bill_volumes_1_2",
      parts: [],
      totalDurationSeconds: 0,
    },
    "Movie manifest"
  );
};

const buildClipFromSegment = (segment, words) => {
  const fallbackWord = words[segment.startWordIndex] || words[segment.endWordIndex] || {};
  const startWord = words[segment.startWordIndex] || fallbackWord;
  const endWord = words[segment.endWordIndex] || fallbackWord;

  const partNumber = startWord?.partNumber ?? endWord?.partNumber ?? null;
  const videoId = getVideoIdForPart(partNumber) || `local_part_${partNumber ?? "unknown"}`;

  const startLocalSeconds = typeof startWord?.localStartMs === "number" ? startWord.localStartMs / 1000 : 0;
  let endLocalSeconds =
    typeof endWord?.localEndMs === "number"
      ? endWord.localEndMs / 1000
      : typeof startWord?.localEndMs === "number"
      ? startWord.localEndMs / 1000
      : startLocalSeconds + Math.max((segment.tokenCount || 5) * 0.4, 2);

  if (endLocalSeconds <= startLocalSeconds) {
    endLocalSeconds = startLocalSeconds + Math.max((segment.tokenCount || 5) * 0.4, 2);
  }

  const startGlobalSeconds =
    typeof segment.startGlobalMs === "number"
      ? segment.startGlobalMs / 1000
      : typeof startWord?.globalStartMs === "number"
      ? startWord.globalStartMs / 1000
      : startLocalSeconds;
  const endGlobalSeconds =
    typeof segment.endGlobalMs === "number"
      ? segment.endGlobalMs / 1000
      : typeof endWord?.globalEndMs === "number"
      ? endWord.globalEndMs / 1000
      : endLocalSeconds;

  return {
    videoId,
    start: startLocalSeconds,
    end: endLocalSeconds,
    startGlobal: startGlobalSeconds,
    endGlobal: endGlobalSeconds,
    duration: Math.max(0, endLocalSeconds - startLocalSeconds),
    character: segment.character,
    dialogue: segment.text,
    dialogueId: segment.dialogueId,
    partNumber,
    source: "transcript",
    confidence:
      segment.tokenCount > 0
        ? Math.min(0.99, (segment.matchedTokenCount || 0) / segment.tokenCount)
        : null,
    description: segment.text,
  };
};

const SILENCE_THRESHOLD_SECONDS = 0.8;

const computeSilenceWindows = (segments = []) => {
  if (!Array.isArray(segments) || segments.length < 2) {
    return [];
  }

  const windows = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const current = segments[i];
    const next = segments[i + 1];

    const currentEnd = typeof current.endGlobalSeconds === "number" ? current.endGlobalSeconds : null;
    const nextStart = typeof next.startGlobalSeconds === "number" ? next.startGlobalSeconds : null;

    if (currentEnd === null || nextStart === null) {
      continue;
    }

    const gap = nextStart - currentEnd;
    if (gap >= SILENCE_THRESHOLD_SECONDS) {
      windows.push({
        startGlobalSeconds: currentEnd,
        endGlobalSeconds: nextStart,
        durationSeconds: gap,
        precedingDialogueId: current.dialogueId,
        followingDialogueId: next.dialogueId,
        precedingCharacter: current.character,
        followingCharacter: next.character,
        precedingSceneId: current.sceneId || null,
        followingSceneId: next.sceneId || null,
      });
    }
  }
  return windows;
};

const loadMergedTranscript = () => {
  if (!fs.existsSync(MERGED_WORDS_PATH) || !fs.existsSync(MERGED_SEGMENTS_PATH)) {
    console.warn("[DataLoader] Merged transcript files not found. Agent will use screenplay-only data.");
    return {
      words: [],
      segments: [],
      segmentsById: new Map(),
      clipsByDialogueId: new Map(),
      characterSegmentsIndex: {},
      silenceWindows: [],
    };
  }

  const words = safeReadJson(MERGED_WORDS_PATH, [], "Merged transcript words");
  const rawSegments = safeReadJson(MERGED_SEGMENTS_PATH, [], "Merged transcript segments");

  const segmentsById = new Map();
  const clipsByDialogueId = new Map();
  const characterSegmentsIndex = {};

  const processedSegments = rawSegments.map((segment) => {
    const clip = buildClipFromSegment(segment, words);
    const textLower = segment.text?.toLowerCase() || "";
    const enriched = {
      ...segment,
      textLower,
      partNumber: clip.partNumber,
      startLocalSeconds: clip.start,
      endLocalSeconds: clip.end,
      startGlobalSeconds: clip.startGlobal,
      endGlobalSeconds: clip.endGlobal,
      durationSeconds: clip.duration,
      clip,
    };

    segmentsById.set(segment.dialogueId, enriched);
    clipsByDialogueId.set(segment.dialogueId, clip);

    const normalizedChar = normalizeCharacterName(segment.character);
    if (normalizedChar) {
      if (!characterSegmentsIndex[normalizedChar]) {
        characterSegmentsIndex[normalizedChar] = [];
      }
      characterSegmentsIndex[normalizedChar].push(enriched);
    }

    return enriched;
  });

  return {
    words,
    segments: processedSegments,
    segmentsById,
    clipsByDialogueId,
    characterSegmentsIndex,
    silenceWindows: computeSilenceWindows(processedSegments),
  };
};

const buildMovieIndexFromManifest = (manifest) => {
  if (!manifest?.parts?.length) {
    return {
      movieTitle: "Kill Bill",
      generatedAt: new Date().toISOString(),
      fromCache: true,
      chunkCount: 0,
      totalDuration: 0,
      anchors: [],
      chunks: [],
    };
  }

  const chunks = manifest.parts.map((part, idx) => {
    const videoId = getVideoIdForPart(part.partNumber) || `local_part_${part.partNumber}`;
    return {
      indexId: "local",
      videoId,
      title: part.label || part.filename,
      filename: part.filename,
      duration: part.durationSeconds,
      chunkLabel: part.label || part.filename,
      start_offset: part.globalStartSeconds,
      end_offset: part.globalEndSeconds,
      order: idx + 1,
    };
  });

  return {
    movieTitle: manifest.movieId || "Kill Bill",
    generatedAt: new Date().toISOString(),
    fromCache: true,
    chunkCount: chunks.length,
    totalDuration: manifest.totalDurationSeconds,
    anchors: [],
    chunks,
  };
};

/**
 * Load all data sources with caching
 */
export const loadDataSources = async ({ forceRefresh = false } = {}) => {
  const now = Date.now();
  
  // Return cached data if still valid
  if (!forceRefresh && dataCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
    return dataCache;
  }

  const manifest = loadManifest();
  const mergedTranscript = loadMergedTranscript();
  const sceneTimeline = loadSceneTimeline();
  const sceneTimelineById = new Map(
    (sceneTimeline || []).filter((scene) => scene?.sceneId).map((scene) => [scene.sceneId, scene])
  );
  mergedTranscript.sceneTimeline = sceneTimeline;
  mergedTranscript.sceneTimelineById = sceneTimelineById;

  const movieIndexPromise = loadMovieIndexFromLib({ forceRefresh }).catch((error) => {
    console.warn(`[DataLoader] Unable to load Twelve Labs movie index: ${error.message}`);
    return null;
  });

  const [transcript, screenplay, characters, movieIndexRemote] = await Promise.all([
    Promise.resolve(loadTranscript()),
    Promise.resolve(loadScreenplay()),
    Promise.resolve(loadCharacters()),
    movieIndexPromise,
  ]);

  const movieIndex =
    movieIndexRemote ||
    (manifest?.parts?.length ? buildMovieIndexFromManifest(manifest) : null);

  const narrativeIndex = loadOrGenerateNarrativeIndex({
    movieId: manifest?.movieId,
    dataSources: {
      transcript,
      screenplay,
      mergedTranscript,
    },
    forceRefresh,
    helpers: {
      normalizeCharacterName,
    },
  });

  dataCache = {
    transcript,
    screenplay,
    characters,
    movieIndex,
    manifest,
    mergedTranscript,
    narrativeIndex,
    sceneTimeline,
    sceneTimelineById,
  };
  cacheTimestamp = now;

  return dataCache;
};

/**
 * Get just the transcript (for lighter weight operations)
 */
export const getTranscript = () => {
  if (dataCache?.transcript) {
    return dataCache.transcript;
  }
  return loadTranscript();
};

/**
 * Get just the characters
 */
export const getCharacters = () => {
  if (dataCache?.characters) {
    return dataCache.characters;
  }
  return loadCharacters();
};

/**
 * Get just the screenplay
 */
export const getScreenplay = () => {
  if (dataCache?.screenplay) {
    return dataCache.screenplay;
  }
  return loadScreenplay();
};

export const getNarrativeIndex = () => {
  if (dataCache?.narrativeIndex) {
    return dataCache.narrativeIndex;
  }
  const transcript = getTranscript();
  const screenplay = getScreenplay();
  const mergedTranscript = loadMergedTranscript();
  const narrativeIndex = loadOrGenerateNarrativeIndex({
    dataSources: { transcript, screenplay, mergedTranscript },
    helpers: { normalizeCharacterName },
  });
  if (dataCache) {
    dataCache.narrativeIndex = narrativeIndex;
  }
  return narrativeIndex;
};

/**
 * Clear the cache (useful for testing or forcing refresh)
 */
export const clearCache = () => {
  dataCache = null;
  cacheTimestamp = null;
};

export default {
  loadDataSources,
  getTranscript,
  getCharacters,
  getScreenplay,
  getNarrativeIndex,
  clearCache,
  normalizeCharacterName,
  loadManifest,
};


