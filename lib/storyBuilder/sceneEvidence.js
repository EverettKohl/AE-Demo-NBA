/**
 * Build lightweight evidence objects from a scene plan.
 */
export const buildSceneEvidence = ({ sections = [], orchestrator = {}, options = {} } = {}) => {
  return sections.map((section) => ({
    sceneId: section.sceneId,
    title: section.title,
    dialogue: section.dialogue || [],
    audioDescriptions: section.audioDescriptions || [],
    cuts: section.cuts || [],
    window: section.window || null,
    orchestratorContext: {
      version: orchestrator.version || "placeholder",
      options,
    },
  }));
};

export default { buildSceneEvidence };
