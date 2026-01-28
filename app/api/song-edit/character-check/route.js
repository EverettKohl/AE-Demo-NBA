import { NextResponse } from "next/server";
import {
  loadDataSources,
  normalizeCharacterName,
} from "@/lib/killBillAgent/dataLoader";

const overlaps = (aStart, aEnd, bStart, bEnd, tolerance = 0.15) => {
  if (
    !Number.isFinite(aStart) ||
    !Number.isFinite(aEnd) ||
    !Number.isFinite(bStart) ||
    !Number.isFinite(bEnd)
  ) {
    return false;
  }
  const latestStart = Math.max(aStart, bStart);
  const earliestEnd = Math.min(aEnd, bEnd);
  return earliestEnd - latestStart >= tolerance;
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { character, clips } = body || {};

    if (!character || !Array.isArray(clips) || clips.length === 0) {
      return NextResponse.json(
        { error: "Provide a character and at least one clip range." },
        { status: 400 }
      );
    }

    const normalizedCharacter = normalizeCharacterName(character);
    if (!normalizedCharacter) {
      return NextResponse.json(
        { error: `Unable to normalize character "${character}".` },
        { status: 400 }
      );
    }

    const { mergedTranscript } = await loadDataSources({ forceRefresh: false });
    const segmentIndex = mergedTranscript.characterSegmentsIndex || {};
    const characterSegments = segmentIndex[normalizedCharacter];

    if (!characterSegments || characterSegments.length === 0) {
      return NextResponse.json({
        success: true,
        results: clips.map((clip) => ({
          index: clip.index,
          hasMatch: false,
          examples: [],
        })),
      });
    }

    const results = clips.map((clip) => {
      const videoId = clip.videoId;
      const start = Number(clip.start);
      const end = Number(clip.end);
      if (!videoId || !Number.isFinite(start) || !Number.isFinite(end)) {
        return {
          index: clip.index,
          hasMatch: false,
          examples: [],
          error: "Missing clip metadata",
        };
      }

      const matches = characterSegments
        .filter(
          (segment) =>
            segment?.clip?.videoId === videoId &&
            overlaps(segment.clip.start, segment.clip.end, start, end)
        )
        .slice(0, 3)
        .map((segment) => ({
          dialogueId: segment.dialogueId,
          text: segment.text,
          start: segment.clip?.start,
          end: segment.clip?.end,
          character: segment.character,
        }));

      return {
        index: clip.index,
        hasMatch: matches.length > 0,
        examples: matches,
      };
    });

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("[song-edit/character-check] Error:", error);
    return NextResponse.json(
      { error: "Failed to validate clips for character focus." },
      { status: 500 }
    );
  }
}

