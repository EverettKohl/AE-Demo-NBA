/**
 * Tools for Kill Bill Agent
 * These are the functions the agent can call to search and retrieve data
 */

import axios from "axios";
import FormData from "form-data";
import { loadDataSources, normalizeCharacterName } from "./dataLoader.js";
import {
  isBannedClip,
  deduplicateClips,
  sortClipsChronologically,
  getCanonicalVideoId,
} from "./utils.js";
import { resolveKillBillVideoIds } from "../twelveLabs/videoCatalog.js";

const TL_API_URL = process.env.TWELVELABS_API_URL || "https://api.twelvelabs.io/v1.3";

const scoreSegmentMatch = (segment, queryLower, tokens, normalizedChar) => {
  const textLower = segment.textLower || segment.text?.toLowerCase() || "";
  let score = 0;

  if (queryLower && textLower.includes(queryLower)) {
    score += tokens.length > 0 ? tokens.length * 2 : 2;
  }

  const tokenList = tokens.length > 0 ? tokens : queryLower ? [queryLower] : [];
  for (const token of tokenList) {
    if (token && textLower.includes(token)) {
      score += 1;
    }
  }

  if (normalizedChar && normalizeCharacterName(segment.character) === normalizedChar) {
    score += 0.5;
  }

  return score;
};

const searchLocalClips = async ({ query, limit = 5, character, allowedVideoIdSet = null }) => {
  const { mergedTranscript } = await loadDataSources();

  if (!mergedTranscript?.segments?.length) {
    return { success: false, error: "Merged transcript not available", clips: [] };
  }

  const queryLower = query?.toLowerCase()?.trim() || "";
  const tokens = queryLower
    .split(/[^a-z0-9']+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
  const normalizedChar = character ? normalizeCharacterName(character) : null;

  const scoredSegments = mergedTranscript.segments
    .filter((segment) => {
      if (normalizedChar && normalizeCharacterName(segment.character) !== normalizedChar) {
        return false;
      }
      return true;
    })
    .map((segment) => ({
      segment,
      score: scoreSegmentMatch(segment, queryLower, tokens, normalizedChar),
    }));

  let filtered = scoredSegments.filter(({ score }) => score > 0);

  if (filtered.length === 0 && normalizedChar) {
    filtered = scoredSegments;
  }

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.segment.startGlobalSeconds || 0) - (b.segment.startGlobalSeconds || 0);
  });

  let clips = filtered.map(({ segment, score }) => {
    const confidenceBase =
      tokens.length > 0
        ? Math.min(0.99, score / Math.max(tokens.length, 1))
        : Math.min(0.99, score / 5);

    return {
      ...segment.clip,
      confidence: Number.isFinite(confidenceBase) ? confidenceBase : segment.clip?.confidence || 0.5,
      dialogue: segment.text,
      character: segment.character,
      source: "local_transcript",
    };
  });

  if (allowedVideoIdSet?.size) {
    clips = clips.filter((clip) => allowedVideoIdSet.has(getCanonicalVideoId(clip.videoId)));
  }

  clips = clips.slice(0, limit);

  return {
    success: clips.length > 0,
    clips,
    query,
    totalFound: filtered.length,
    source: "local_transcript",
    characterFilter: character || null,
  };
};

/**
 * Tool definitions for OpenAI function calling
 */
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_clips",
      description: "Search for video clips. Uses Twelve Labs visual/audio search when available and falls back to the local timestamped transcript when offline.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query describing what to find. Be specific about visual elements, characters, actions, or dialogue.",
          },
          limit: {
            type: "number",
            description: "Maximum number of clips to return (1-20). Default is 5.",
          },
          searchOptions: {
            type: "array",
            items: { type: "string", enum: ["visual", "audio", "transcription"] },
            description: "Which search modes to use. Default is all three.",
          },
          videoFilters: {
            description:
              "Restrict search to one or more Kill Bill parts (e.g., 'Kill_Bill_Vol2_Part3', 4) or direct Twelve Labs video IDs.",
            anyOf: [
              {
                type: "array",
                items: {
                  anyOf: [{ type: "string" }, { type: "number" }],
                },
              },
              { type: "string" },
              { type: "number" },
            ],
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_dialogue",
      description: "Search the movie transcript for specific dialogue or lines. Can filter by character. Returns dialogue entries with line numbers.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for in dialogue.",
          },
          character: {
            type: "string",
            description: "Optional: Filter to specific character (e.g., 'THE BRIDE', 'BILL').",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (1-50). Default is 10.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_character_scenes",
      description: "Get all dialogue and scenes featuring a specific character. Returns chronological list of their moments.",
      parameters: {
        type: "object",
        properties: {
          characterName: {
            type: "string",
            description: "Character name (e.g., 'The Bride', 'O-Ren Ishii', 'Bill').",
          },
          limit: {
            type: "number",
            description: "Maximum number of scenes to return. Default is 30.",
          },
        },
        required: ["characterName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_chapter_scenes",
      description: "Get all scenes from a specific chapter of the movie.",
      parameters: {
        type: "object",
        properties: {
          chapterNumber: {
            type: "string",
            description: "Chapter number or name (e.g., 'one', 'two', 'Three').",
          },
        },
        required: ["chapterNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_dialogue_timestamp",
      description: "Find the video timestamp for a specific dialogue line via Twelve Labs (when available) or the local per-word transcript.",
      parameters: {
        type: "object",
        properties: {
          dialogueText: {
            type: "string",
            description: "The dialogue text to find in the video.",
          },
        },
        required: ["dialogueText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_scene_context",
      description: "Get context around a specific timestamp - surrounding dialogue, scene description, and chapter info.",
      parameters: {
        type: "object",
        properties: {
          videoId: {
            type: "string",
            description: "The Twelve Labs video ID.",
          },
          timestamp: {
            type: "number",
            description: "Timestamp in seconds.",
          },
        },
        required: ["videoId", "timestamp"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_characters",
      description: "Get list of all main characters with their descriptions.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_movie_structure",
      description: "Get the chapter structure of the movie with scene counts.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

/**
 * Search clips using Twelve Labs API
 */
export const searchClips = async ({
  query,
  limit = 5,
  searchOptions = ["visual", "audio", "transcription"],
  character,
  videoFilters,
}) => {
  const forceLocalSearch = process.env.AGENT_FORCE_LOCAL_SEARCH === "true";
  const apiKey = process.env.TWELVELABS_API_KEY;
  const indexId = process.env.TWELVELABS_INDEX_ID;
  const twelveLabsEnabled = Boolean(apiKey && indexId) && !forceLocalSearch;
  const resolvedVideoIds = resolveKillBillVideoIds(videoFilters);
  const allowedVideoIdSet =
    resolvedVideoIds.length > 0
      ? new Set(resolvedVideoIds.map((id) => getCanonicalVideoId(id)))
      : null;

  if (!twelveLabsEnabled) {
    return searchLocalClips({ query, limit, character, allowedVideoIdSet });
  }

  try {
    const form = new FormData();
    for (const option of searchOptions) {
      form.append("search_options", option);
    }
    form.append("index_id", indexId);
    form.append("query_text", query);
    form.append("page_limit", String(Math.min(limit, 20)));
    if (resolvedVideoIds.length > 0) {
      resolvedVideoIds.forEach((id) => form.append("video_ids", id));
    }

    const response = await axios.post(`${TL_API_URL}/search`, form, {
      headers: {
        "Content-Type": "multipart/form-data",
        "x-api-key": apiKey,
      },
    });

    const results = response.data?.data || [];

    // Process and filter results
    let processedClips = results
      .map((item) => {
        const videoId = item.video_id || item.videoId;
        const start = typeof item.start === "number" ? item.start : 0;
        const end = typeof item.end === "number" ? item.end : start + 5;

        if (isBannedClip(videoId, start)) {
          return null;
        }

        return {
          videoId,
          video_id: videoId,
          start: Math.round(start * 100) / 100,
          end: Math.round(end * 100) / 100,
          confidence: item.confidence || item.score || null,
          thumbnail_url: item.thumbnail_url || null,
        };
      })
      .filter(Boolean);
    if (allowedVideoIdSet?.size) {
      processedClips = processedClips.filter((clip) =>
        allowedVideoIdSet.has(getCanonicalVideoId(clip.videoId))
      );
    }

    const dedupedClips = deduplicateClips(processedClips).slice(0, limit);

    if (!dedupedClips.length) {
      const fallback = await searchLocalClips({ query, limit, character, allowedVideoIdSet });
      if (fallback.success) {
        return { ...fallback, warning: "Twelve Labs returned no matches; using transcript fallback." };
      }
    }

    return {
      success: dedupedClips.length > 0,
      clips: dedupedClips,
      query,
      totalFound: dedupedClips.length,
      source: "twelve_labs",
    };
  } catch (error) {
    console.error("[searchClips] Error:", error.message);
    const fallback = await searchLocalClips({ query, limit, character, allowedVideoIdSet });
    if (fallback.success) {
      return { ...fallback, warning: error.message };
    }
    return { success: false, error: error.message, clips: [] };
  }
};

/**
 * Search dialogue in transcript
 */
export const searchDialogue = async ({ query, character, limit = 10 }) => {
  const { transcript, mergedTranscript } = await loadDataSources();

  if (!transcript?.allDialogue) {
    return { success: false, error: "Transcript not loaded", results: [] };
  }

  const queryLower = query.toLowerCase();
  const normalizedChar = character ? normalizeCharacterName(character) : null;

  const results = transcript.allDialogue.filter((d) => {
    const matchesText = d.text.toLowerCase().includes(queryLower);
    const matchesChar = !normalizedChar || normalizeCharacterName(d.character) === normalizedChar;
    return matchesText && matchesChar;
  });

  return {
    success: true,
    results: results.slice(0, limit).map((d) => ({
      id: d.id,
      character: d.character,
      text: d.text,
      lineNumber: d.startLine,
      chapter: d.chapter,
      sceneId: d.sceneId,
      clip: mergedTranscript?.clipsByDialogueId?.get?.(d.id) || null,
      timestamps: mergedTranscript?.clipsByDialogueId?.get?.(d.id)
        ? {
            videoId: mergedTranscript.clipsByDialogueId.get(d.id).videoId,
            start: mergedTranscript.clipsByDialogueId.get(d.id).start,
            end: mergedTranscript.clipsByDialogueId.get(d.id).end,
            startGlobal: mergedTranscript.clipsByDialogueId.get(d.id).startGlobal,
            endGlobal: mergedTranscript.clipsByDialogueId.get(d.id).endGlobal,
            partNumber: mergedTranscript.clipsByDialogueId.get(d.id).partNumber,
          }
        : null,
    })),
    totalFound: results.length,
    query,
    characterFilter: character || null,
  };
};

/**
 * Get all scenes for a character
 */
export const getCharacterScenes = async ({ characterName, limit = 30 }) => {
  const { transcript, characters, mergedTranscript } = await loadDataSources();
  if (!transcript?.characterIndex && !mergedTranscript?.characterSegmentsIndex) {
    return { success: false, error: "Transcript not loaded", scenes: [] };
  }
  const normalized = normalizeCharacterName(characterName);

  const transcriptSegments = mergedTranscript?.characterSegmentsIndex?.[normalized] || [];
  let scenes = [];

  if (transcriptSegments.length > 0) {
    scenes = transcriptSegments.slice(0, limit).map((segment) => ({
      id: segment.dialogueId,
      character: segment.character,
      text: segment.text,
      lineNumber: segment.startLine,
      chapter: segment.chapter,
      sceneId: segment.sceneId,
      clip: segment.clip,
    }));
  } else {
    let dialogueIds = [];
    for (const [charKey, ids] of Object.entries(transcript.characterIndex || {})) {
      if (normalizeCharacterName(charKey) === normalized) {
        dialogueIds.push(...ids);
      }
    }
    dialogueIds = [...new Set(dialogueIds)];
    scenes = dialogueIds
      .map((id) => transcript.allDialogue.find((d) => d.id === id))
      .filter(Boolean)
      .slice(0, limit)
      .map((d) => ({
        id: d.id,
        character: d.character,
        text: d.text,
        lineNumber: d.startLine,
        chapter: d.chapter,
        sceneId: d.sceneId,
        clip: mergedTranscript?.clipsByDialogueId?.get?.(d.id) || null,
      }));
  }

  // Get character info if available
  const charInfo = characters?.find(
    (c) => c.name.toUpperCase().includes(normalized) || normalized.includes(c.name.toUpperCase())
  );

  return {
    success: true,
    character: characterName,
    characterInfo: charInfo || null,
    scenes,
    totalScenes:
      transcriptSegments.length > 0 ? transcriptSegments.length : scenes.length,
  };
};

/**
 * Get scenes from a specific chapter
 */
export const getChapterScenes = async ({ chapterNumber }) => {
  const { transcript, screenplay, mergedTranscript } = await loadDataSources();

  if (!transcript?.chapters && !screenplay?.chapters) {
    return { success: false, error: "Chapter data not loaded", scenes: [] };
  }

  const chapterNum = chapterNumber.toString().toLowerCase();

  // Find chapter in transcript
  const chapter = transcript.chapters?.find(
    (c) => c.number?.toLowerCase() === chapterNum || c.title?.toLowerCase().includes(chapterNum)
  );

  if (!chapter) {
    return {
      success: false,
      error: `Chapter "${chapterNumber}" not found`,
      availableChapters: transcript.chapters?.map((c) => ({ number: c.number, title: c.title })),
    };
  }

  // Get dialogue from this chapter
  const dialogue = transcript.allDialogue?.filter((d) => d.chapter?.toLowerCase() === chapter.number?.toLowerCase());

  return {
    success: true,
    chapter: {
      number: chapter.number,
      title: chapter.title,
      startLine: chapter.startLine,
    },
    scenes: chapter.scenes || [],
    dialogue: dialogue?.slice(0, 50).map((d) => ({
      character: d.character,
      text: d.text,
      lineNumber: d.startLine,
      clip: mergedTranscript?.clipsByDialogueId?.get?.(d.id) || null,
    })),
    dialogueCount: dialogue?.length || 0,
  };
};

/**
 * Find timestamp for a dialogue line using Twelve Labs transcription search
 */
export const findDialogueTimestamp = async ({ dialogueText }) => {
  // Use transcription-only search for best dialogue matching
  const result = await searchClips({
    query: dialogueText,
    limit: 3,
    searchOptions: ["transcription"],
  });

  if (!result.success || result.clips.length === 0) {
    return {
      success: false,
      error: "Could not find timestamp for dialogue",
      dialogueText,
    };
  }

  const bestMatch = result.clips[0];

  return {
    success: true,
    dialogueText,
    timestamp: {
      videoId: bestMatch.videoId,
      start: bestMatch.start,
      end: bestMatch.end,
      confidence: bestMatch.confidence,
    },
    clip: bestMatch,
    source: result.source || "twelve_labs",
    alternativeMatches: result.clips.slice(1),
  };
};

/**
 * Get context around a timestamp
 */
export const getSceneContext = async ({ videoId, timestamp }) => {
  const { movieIndex, mergedTranscript } = await loadDataSources();

  const chunk = movieIndex?.chunks?.find((c) => c.videoId === videoId);
  const baseOffset = chunk?.start_offset || 0;
  const absoluteTime = baseOffset + (timestamp || 0);

  let transcriptContext = [];
  if (mergedTranscript?.segments?.length) {
    transcriptContext = mergedTranscript.segments
      .filter(
        (segment) =>
          typeof segment.startGlobalSeconds === "number" &&
          typeof segment.endGlobalSeconds === "number" &&
          absoluteTime >= segment.startGlobalSeconds - 5 &&
          absoluteTime <= segment.endGlobalSeconds + 5
      )
      .slice(0, 8)
      .map((segment) => ({
        dialogueId: segment.dialogueId,
        character: segment.character,
        text: segment.text,
        clip: segment.clip,
      }));
  }

  return {
    success: true,
    videoId,
    timestamp,
    chunk: chunk
      ? {
          filename: chunk.filename,
          duration: chunk.duration,
          order: chunk.order,
        }
      : null,
    transcriptContext,
  };
};

/**
 * List all main characters
 */
export const listCharacters = async () => {
  const { characters, transcript } = await loadDataSources();

  // Enhance with dialogue counts from transcript
  const enhancedCharacters = characters.map((char) => {
    const normalized = normalizeCharacterName(char.name);
    let dialogueCount = 0;

    for (const [charKey, ids] of Object.entries(transcript?.characterIndex || {})) {
      if (normalizeCharacterName(charKey) === normalized) {
        dialogueCount += ids.length;
      }
    }

    return {
      ...char,
      dialogueCount,
    };
  });

  return {
    success: true,
    characters: enhancedCharacters,
    totalCharacters: enhancedCharacters.length,
  };
};

/**
 * Get movie structure (chapters)
 */
export const getMovieStructure = async () => {
  const { transcript, screenplay } = await loadDataSources();

  const chapters = transcript?.chapters || screenplay?.chapters || [];

  return {
    success: true,
    chapters: chapters.map((c) => ({
      number: c.number,
      title: c.title,
      sceneCount: c.scenes?.length || 0,
      dialogueCount: c.dialogueCount || 0,
    })),
    totalChapters: chapters.length,
    totalScenes: transcript?.sceneIndex?.length || screenplay?.scenes?.length || 0,
  };
};

/**
 * Execute a tool by name
 */
export const executeTool = async (toolName, args) => {
  switch (toolName) {
    case "search_clips":
      return await searchClips(args);
    case "search_dialogue":
      return await searchDialogue(args);
    case "get_character_scenes":
      return await getCharacterScenes(args);
    case "get_chapter_scenes":
      return await getChapterScenes(args);
    case "find_dialogue_timestamp":
      return await findDialogueTimestamp(args);
    case "get_scene_context":
      return await getSceneContext(args);
    case "list_characters":
      return await listCharacters();
    case "get_movie_structure":
      return await getMovieStructure();
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
};

export default {
  TOOL_DEFINITIONS,
  searchClips,
  searchDialogue,
  getCharacterScenes,
  getChapterScenes,
  findDialogueTimestamp,
  getSceneContext,
  listCharacters,
  getMovieStructure,
  executeTool,
};


