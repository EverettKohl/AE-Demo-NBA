/**
 * Kill Bill Unified Agent
 * 
 * A centralized intelligent agent that all tabs can call with different task modes.
 * Provides access to transcript, screenplay, characters, Twelve Labs search, and movie index.
 */

import { TASK_MODES, getSystemPrompt } from "./killBillAgent/prompts.js";
import { TOOL_DEFINITIONS, executeTool, searchClips, getCharacterScenes } from "./killBillAgent/tools.js";
import { loadDataSources } from "./killBillAgent/dataLoader.js";
import { deduplicateClips, sortClipsChronologically, formatClip } from "./killBillAgent/utils.js";

// Re-export task modes for convenience
export { TASK_MODES } from "./killBillAgent/prompts.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Call OpenAI API directly using fetch
 */
const callOpenAI = async ({ messages, tools, toolChoice = "auto", temperature = 0.7 }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature,
    max_tokens: 2048,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI request failed: ${res.status} ${errText}`);
  }

  return res.json();
};

/**
 * Main agent class
 */
export class KillBillAgent {
  constructor(mode = TASK_MODES.ASK_MOVIE) {
    this.mode = mode;
    this.systemPrompt = getSystemPrompt(mode);
    this.conversationHistory = [];
    this.dataSources = null;
  }

  /**
   * Initialize data sources (call once before processing)
   */
  async initialize() {
    if (!this.dataSources) {
      this.dataSources = await loadDataSources();
    }
    return this;
  }

  /**
   * Process a user query and return results
   */
  async process(userQuery, options = {}) {
    const {
      maxClips = 10,
      chronological = false,
    } = options;

    await this.initialize();

    // Build messages array
    const messages = [
      { role: "system", content: this.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: userQuery },
    ];

    // Call OpenAI with tools
    let response;
    let allClips = [];
    let toolResults = [];
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    try {
      while (iterations < MAX_ITERATIONS) {
        iterations++;

        response = await callOpenAI({
          messages,
          tools: TOOL_DEFINITIONS,
          toolChoice: "auto",
          temperature: 0.7,
        });

        const choice = response.choices[0];

        // If no tool calls, we're done
        if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
          // Add assistant message to history
          this.conversationHistory.push({ role: "user", content: userQuery });
          this.conversationHistory.push(choice.message);
          break;
        }

        // Process tool calls
        messages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[Agent] Calling tool: ${toolName}`, toolArgs);

          const result = await executeTool(toolName, toolArgs);
          toolResults.push({ tool: toolName, args: toolArgs, result });

          // Collect clips from search results
          if (result.clips && Array.isArray(result.clips)) {
            allClips.push(...result.clips);
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Process collected clips
      if (allClips.length > 0) {
        allClips = deduplicateClips(allClips);
        if (chronological) {
          allClips = sortClipsChronologically(allClips);
        }
        allClips = allClips.slice(0, maxClips);
      }

      const assistantMessage = response.choices[0].message.content || "";

      return {
        success: true,
        message: assistantMessage,
        clips: allClips.map((clip, i) => formatClip(clip, i)),
        toolResults,
        mode: this.mode,
      };
    } catch (error) {
      console.error("[Agent] Error:", error);
      return {
        success: false,
        error: error.message,
        clips: [],
        toolResults,
        mode: this.mode,
      };
    }
  }

  /**
   * Reset conversation history
   */
  resetConversation() {
    this.conversationHistory = [];
  }

  /**
   * Change the task mode
   */
  setMode(mode) {
    this.mode = mode;
    this.systemPrompt = getSystemPrompt(mode);
    this.resetConversation();
  }
}

/**
 * Quick function to process a query with a specific mode
 */
export const processQuery = async (query, mode = TASK_MODES.ASK_MOVIE, options = {}) => {
  const agent = new KillBillAgent(mode);
  return agent.process(query, options);
};

/**
 * Mode-specific helper functions
 */

/**
 * Ask a question about the movie
 */
export const askTheMovie = async (question, options = {}) => {
  return processQuery(question, TASK_MODES.ASK_MOVIE, options);
};

/**
 * Find iconic scenes
 */
export const findIconicScenes = async (query, options = {}) => {
  const defaultOptions = { maxClips: 10, chronological: true };
  return processQuery(query, TASK_MODES.ICONIC_SCENES, { ...defaultOptions, ...options });
};

/**
 * Get top 5 moments
 */
export const getTop5 = async (criteria, options = {}) => {
  const defaultOptions = { maxClips: 5 };
  return processQuery(criteria, TASK_MODES.TOP_5_EDIT, { ...defaultOptions, ...options });
};

/**
 * Get clips for love me edit
 */
export const getLoveMeClips = async (theme, options = {}) => {
  const defaultOptions = { maxClips: 15 };
  return processQuery(theme, TASK_MODES.LOVE_ME_EDIT, { ...defaultOptions, ...options });
};

/**
 * Get clips for song edit
 */
export const getSongEditClips = async (description, options = {}) => {
  const defaultOptions = { maxClips: 20 };
  return processQuery(description, TASK_MODES.SONG_EDIT, { ...defaultOptions, ...options });
};

/**
 * Build a character story
 */
export const buildCharacterStory = async (characterName, narrativeRequest, options = {}) => {
  const query = `Build a story about ${characterName}. ${narrativeRequest}`;
  const defaultOptions = { maxClips: 20, chronological: true, character: characterName };
  return processQuery(query, TASK_MODES.STORY_BUILDER, { ...defaultOptions, ...options });
};

/**
 * Direct search without AI (for simple clip retrieval)
 */
export const directSearch = async (query, options = {}) => {
  const { limit = 10, searchOptions = ["visual", "audio", "transcription"] } = options;

  const result = await searchClips({ query, limit, searchOptions });

  if (!result.success) {
    return result;
  }

  let clips = result.clips;
  if (options.chronological) {
    clips = sortClipsChronologically(clips);
  }

  return {
    success: true,
    clips: clips.map((clip, i) => formatClip(clip, i)),
    totalFound: result.totalFound,
    query,
  };
};

/**
 * Get all clips for a character
 */
export const getCharacterClips = async (characterName, options = {}) => {
  const { limit = 30 } = options;

  // Get character dialogue scenes
  const dialogueResult = await getCharacterScenes({ characterName, limit });

  if (!dialogueResult.success) {
    return dialogueResult;
  }

  // Search for visual clips of the character
  const visualResult = await searchClips({
    query: `${characterName} scenes moments`,
    limit: Math.min(limit, 20),
    searchOptions: ["visual"],
  });

  // Combine dialogue info with visual clips
  return {
    success: true,
    character: characterName,
    characterInfo: dialogueResult.characterInfo,
    dialogueScenes: dialogueResult.scenes,
    visualClips: visualResult.clips?.map((clip, i) => formatClip(clip, i)) || [],
    totalDialogue: dialogueResult.totalScenes,
    totalVisualClips: visualResult.totalFound || 0,
  };
};

export default {
  KillBillAgent,
  TASK_MODES,
  processQuery,
  askTheMovie,
  findIconicScenes,
  getTop5,
  getLoveMeClips,
  getSongEditClips,
  buildCharacterStory,
  directSearch,
  getCharacterClips,
};
