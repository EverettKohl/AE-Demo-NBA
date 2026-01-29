/**
 * Placeholder scene resolver that returns a simple, bounded plan.
 */
export const resolveScenesForIntent = async ({
  intent,
  clipCount = 12,
  includeDialogue = true,
  sceneTimeline = [],
  customization = {},
} = {}) => {
  const count = Math.max(1, Math.min(Number(clipCount) || 12, 24));

  const sections = new Array(count).fill(null).map((_, idx) => ({
    sceneId: `scene-${idx + 1}`,
    title: `${intent?.character || "Character"} — moment ${idx + 1}`,
    window: {
      start: sceneTimeline[idx]?.start ?? idx * 5,
      end: sceneTimeline[idx]?.end ?? idx * 5 + 4,
    },
    dialogue: includeDialogue ? [] : [],
    audioDescriptions: [],
    cuts: [
      {
        videoId: "Kill_Bill_Vol1_Part1_30FPS",
        startLocalSeconds: idx * 5,
        endLocalSeconds: idx * 5 + 4,
        durationSeconds: 4,
      },
    ],
  }));

  return {
    sections,
    coverage: {
      totalScenes: sections.length,
      customization,
    },
  };
};

export default { resolveScenesForIntent };
