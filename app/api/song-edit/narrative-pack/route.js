import { NextResponse } from "next/server";
import { analyzeStoryIntent } from "@/lib/storyBuilder/intentAnalyzer";
import { resolveScenesForIntent } from "@/lib/storyBuilder/sceneResolver";
import { buildSceneEvidence } from "@/lib/storyBuilder/sceneEvidence";
import { getStoryOrchestrator } from "@/lib/storyBuilder/orchestrator";

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      character = "",
      clipCount = 12,
      includeDialogue = true,
      narrativeType = "character_focus",
    } = body || {};

    const orchestrator = await getStoryOrchestrator();
    const intent = await analyzeStoryIntent({
      character,
      clipCount,
      narrativeType,
      customPrompt: character ? `Focus on ${character}` : "",
    });

    const scenePlan = await resolveScenesForIntent({
      intent,
      clipCount,
      includeDialogue,
      sceneTimeline: orchestrator.sceneTimeline || [],
      customization: {
        enforceSceneBoundaries: true,
        clipDensity: "balanced",
        allowExternalClips: false,
        maxClipDurationSeconds: 10,
        minClipDurationSeconds: 1,
      },
    });

    if (!scenePlan.sections?.length) {
      return NextResponse.json({
        success: true,
        pack: [],
      });
    }

    const sceneEvidence = buildSceneEvidence({
      sections: scenePlan.sections,
      orchestrator,
      options: {
        dialogueLimit: 10,
        audioDescriptionLimit: 6,
        cutOptions: {
          maxSegmentDurationSeconds: 8,
        },
      },
    });

    const pack = sceneEvidence.map((scene) => ({
      sceneId: scene.sceneId,
      title: scene.title,
      dialogue: scene.dialogue || [],
      audioDescriptions: scene.audioDescriptions || [],
      cuts: (scene.cuts || []).map((cut) => ({
        videoId: cut.videoId,
        cutStart: cut.startLocalSeconds,
        cutEnd: cut.endLocalSeconds,
        durationSeconds: cut.durationSeconds,
      })),
      window: scene.window,
    }));

    return NextResponse.json({
      success: true,
      pack,
      coverage: scenePlan.coverage,
    });
  } catch (error) {
    console.error("[song-edit/narrative-pack] Error:", error);
    return NextResponse.json(
      { error: "Failed to assemble narrative evidence pack." },
      { status: 500 }
    );
  }
}

