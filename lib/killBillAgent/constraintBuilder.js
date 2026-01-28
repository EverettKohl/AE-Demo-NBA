/**
 * Constraint builder merges the raw user query with the visual oracle output.
 * The resulting structure drives deterministic transcript searches.
 */

import { normalizeCharacterName } from "./dataLoader.js";

const ACTION_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "with",
  "for",
  "at",
  "is",
  "are",
  "be",
  "was",
  "were",
  "when",
  "timestamp",
  "time",
  "scene",
  "moment",
  "kill",
  "bill",
]);

const detectCharactersInText = (text = "", characterNames = []) => {
  if (!text || !characterNames.length) return [];
  const lowerText = text.toLowerCase();
  return characterNames
    .filter(Boolean)
    .filter((name) => lowerText.includes(name.toLowerCase()))
    .map((name) => normalizeCharacterName(name));
};

const buildActionKeywords = (query = "") => {
  if (!query) return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2 && !ACTION_STOPWORDS.has(token))
    .slice(0, 8);
};

const collectSceneIdsFromHints = (clipHints = []) => {
  const sceneIds = new Set();
  clipHints.forEach((hint) => {
    hint.contextDetails?.forEach?.((detail) => {
      if (detail?.sceneId) {
        sceneIds.add(detail.sceneId);
      }
    });
  });
  return [...sceneIds];
};

const uniqueStrings = (items = []) => {
  return [...new Set(items.filter(Boolean))];
};

export const buildMomentConstraints = ({ query, oracle, dataSources, scope = null }) => {
  const characters = dataSources?.characters || [];
  const knownNames = characters.map((char) => char.name).filter(Boolean);
  const knownNameSet = new Set(knownNames.map((name) => normalizeCharacterName(name)));

  const queryCharacters = detectCharactersInText(query, knownNames);
  const oracleCharacters = (oracle?.aggregatedCharacters || [])
    .map((name) => normalizeCharacterName(name))
    .filter((name) => name && knownNameSet.has(name));
  const scopeCharacters = (scope?.characters || []).map((name) => normalizeCharacterName(name));
  const requiredCharacters = uniqueStrings([...queryCharacters, ...scopeCharacters]);
  const optionalCharacters = oracleCharacters.filter((name) => !requiredCharacters.includes(name));

  const scopeLocations = (scope?.locations || []).map((loc) => loc?.toLowerCase?.() || loc).filter(Boolean);
  const locationKeywords = uniqueStrings([
    ...(oracle?.aggregatedLocations?.map((loc) => loc.toLowerCase()) || []),
    ...scopeLocations,
  ]);

  const sceneIdSet = new Set(collectSceneIdsFromHints(oracle?.clipHints || []));
  const primaryClip = oracle?.clipHints?.[0] || null;
  const primaryClipIsLowConfidence = primaryClip?.rawClip?.source === "local_transcript";
  if (scope?.sceneIds?.length) {
    scope.sceneIds.forEach((sceneId) => {
      if (sceneId) {
        sceneIdSet.add(sceneId);
      }
    });
  }

  const scopeSearchWindow =
    Number.isFinite(scope?.startGlobalSeconds) || Number.isFinite(scope?.endGlobalSeconds)
      ? {
          start: Number.isFinite(scope?.startGlobalSeconds) ? scope.startGlobalSeconds : null,
          end: Number.isFinite(scope?.endGlobalSeconds) ? scope.endGlobalSeconds : null,
        }
      : null;

  const scopeMidpoint =
    Number.isFinite(scope?.startGlobalSeconds) && Number.isFinite(scope?.endGlobalSeconds)
      ? (scope.startGlobalSeconds + scope.endGlobalSeconds) / 2
      : Number.isFinite(scope?.startGlobalSeconds)
      ? scope.startGlobalSeconds
      : Number.isFinite(scope?.endGlobalSeconds)
      ? scope.endGlobalSeconds
      : null;

  const precedingDialogueId =
    !primaryClipIsLowConfidence && primaryClip?.precedingDialogueId ? primaryClip.precedingDialogueId : null;
  const followingDialogueId =
    !primaryClipIsLowConfidence && primaryClip?.followingDialogueId ? primaryClip.followingDialogueId : null;
  const approxSeconds =
    !primaryClipIsLowConfidence && typeof primaryClip?.approxGlobalSeconds === "number"
      ? primaryClip.approxGlobalSeconds
      : scopeMidpoint;

  return {
    label: query?.trim() || "Requested moment",
    requiredCharacters,
    optionalCharacters,
    locationKeywords,
    actionKeywords: buildActionKeywords(query),
    preferSilence: Boolean(oracle?.preferSilence),
    precedingDialogueId,
    followingDialogueId,
    approxGlobalSeconds: approxSeconds,
    sceneIds: [...sceneIdSet],
    oracleSummary: oracle?.visualSummary || "",
    searchWindow: scopeSearchWindow,
    scopeLabel: scope?.label || null,
  };
};

export default {
  buildMomentConstraints,
};

