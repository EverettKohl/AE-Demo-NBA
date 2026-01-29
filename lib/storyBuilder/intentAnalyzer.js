/**
 * Lightweight placeholder intent analyzer.
 * Returns a normalized intent object for downstream planners.
 */
export const analyzeStoryIntent = async ({
  character = "",
  clipCount = 12,
  narrativeType = "character_focus",
  customPrompt = "",
} = {}) => {
  const normalizedCharacter = character?.trim() || "Unknown Character";
  return {
    character: normalizedCharacter,
    narrativeType,
    clipCount,
    prompt: customPrompt || `Focus on ${normalizedCharacter}`,
  };
};

export default { analyzeStoryIntent };
