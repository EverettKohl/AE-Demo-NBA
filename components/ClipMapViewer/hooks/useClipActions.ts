import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AssignedClipOverride, ClipMap, ClipSlot } from "@/lib/clipMap/types";
import { enforceDuration, validateChrono } from "@/lib/clipMap/constraints";

type EditModalState = {
  slotId: string;
  slot: ClipSlot;
  videoDetail: any;
  previewUrl: string;
  previewWindow: { previewStart: number; previewEnd: number; previewDuration: number } | null;
  initialStart: number;
  initialEnd: number;
  videoDuration: number;
  fixedDuration: number | null;
};

type ReplaceModalState = {
  slotId: string;
  slot: ClipSlot;
};

const safeNumber = (value: any, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const findNeighborBounds = (clipMap: ClipMap, slot: ClipSlot) => {
  const ordered = [...clipMap.slots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = ordered.findIndex((s) => s.id === slot.id);
  if (idx < 0) return { minPoolIndex: null, maxPoolIndex: null, minGlobal: null, maxGlobal: null };

  const getPoolIndex = (s: ClipSlot) =>
    typeof s.assignedClip?.sourcePoolIndex === "number"
      ? s.assignedClip.sourcePoolIndex
      : typeof s.metadata?.sourcePoolIndex === "number"
      ? s.metadata.sourcePoolIndex
      : null;

  const getGlobalStart = (s: ClipSlot) =>
    typeof s.upstream?.startGlobalSeconds === "number"
      ? s.upstream.startGlobalSeconds
      : typeof s.upstream?.startGlobalMs === "number"
      ? s.upstream.startGlobalMs / 1000
      : null;

  let prev = idx - 1;
  let minPoolIndex = null;
  let minGlobal = null;
  while (prev >= 0) {
    const candidate = ordered[prev];
    minPoolIndex = getPoolIndex(candidate);
    minGlobal = getGlobalStart(candidate);
    if (minPoolIndex !== null || minGlobal !== null) break;
    prev -= 1;
  }

  let next = idx + 1;
  let maxPoolIndex = null;
  let maxGlobal = null;
  while (next < ordered.length) {
    const candidate = ordered[next];
    maxPoolIndex = getPoolIndex(candidate);
    maxGlobal = getGlobalStart(candidate);
    if (maxPoolIndex !== null || maxGlobal !== null) break;
    next += 1;
  }

  return { minPoolIndex, maxPoolIndex, minGlobal, maxGlobal };
};

export const useClipActions = ({
  clipMap,
  overrides,
  setOverrides,
  setErrorMessage,
  reselectEndpoint = "/api/quick-edit-3",
}: {
  clipMap: ClipMap;
  overrides: Record<string, AssignedClipOverride>;
  setOverrides: Dispatch<SetStateAction<Record<string, AssignedClipOverride>>>;
  setErrorMessage?: (msg: string | null) => void;
  reselectEndpoint?: string;
}) => {
  const [editModalState, setEditModalState] = useState<EditModalState | null>(null);
  const [replaceModalState, setReplaceModalState] = useState<ReplaceModalState | null>(null);

  const closeEdit = useCallback(() => setEditModalState(null), []);
  const closeReplace = useCallback(() => setReplaceModalState(null), []);

  const validateCandidateChrono = useCallback(
    (slot: ClipSlot, candidate: any) => {
      if (!slot.constraints?.chronological) {
        return { ok: true, reason: null };
      }

      const candPoolIndex =
        typeof candidate?.sourcePoolIndex === "number"
          ? candidate.sourcePoolIndex
          : typeof candidate?.asset?.sourcePoolIndex === "number"
          ? candidate.asset.sourcePoolIndex
          : null;
      const candGlobal =
        typeof candidate?.startGlobalSeconds === "number"
          ? candidate.startGlobalSeconds
          : typeof candidate?.startGlobalMs === "number"
          ? candidate.startGlobalMs / 1000
          : null;

      const bounds = findNeighborBounds(clipMap, slot);

      // Preferred: enforce pool index bounds when available.
      if (candPoolIndex !== null) {
        const baseCheck = validateChrono(slot, { sourcePoolIndex: candPoolIndex });
        if (!baseCheck.ok) return { ok: false, reason: baseCheck.error };
        if (typeof bounds.minPoolIndex === "number" && candPoolIndex < bounds.minPoolIndex) {
          return { ok: false, reason: "Candidate violates chronological ordering (before previous slot)." };
        }
        if (typeof bounds.maxPoolIndex === "number" && candPoolIndex >= bounds.maxPoolIndex) {
          return { ok: false, reason: "Candidate violates chronological ordering (after next slot)." };
        }
        return { ok: true, reason: null };
      }

      // Fallback: enforce global time bounds if available (e.g. story builder clips).
      if (candGlobal !== null) {
        if (typeof bounds.minGlobal === "number" && candGlobal < bounds.minGlobal) {
          return { ok: false, reason: "Candidate violates chronological ordering (global time before previous slot)." };
        }
        if (typeof bounds.maxGlobal === "number" && candGlobal >= bounds.maxGlobal) {
          return { ok: false, reason: "Candidate violates chronological ordering (global time after next slot)." };
        }
      }

      return { ok: true, reason: null };
    },
    [clipMap]
  );

  const openReplace = useCallback(
    (slot: ClipSlot) => {
      setErrorMessage?.(null);
      setReplaceModalState({ slotId: slot.id, slot });
    },
    [setErrorMessage]
  );

  const openEdit = useCallback(
    async (slot: ClipSlot) => {
      setErrorMessage?.(null);

      const override = overrides[slot.id];
      const base = slot.assignedClip;
      const videoId = override?.videoId || base?.videoId;
      if (!videoId) {
        setErrorMessage?.("Clip does not have video information");
        return;
      }

      const indexId = override?.indexId ?? base?.indexId ?? null;
      const indexIdParam = indexId ? `&indexId=${encodeURIComponent(indexId)}` : "";
      const videoDetailRes = await fetch(`/api/getVideo?videoId=${encodeURIComponent(videoId)}${indexIdParam}`);
      if (!videoDetailRes.ok) {
        setErrorMessage?.("Failed to fetch video detail");
        return;
      }
      const videoDetail = await videoDetailRes.json();
      const videoDuration = safeNumber(videoDetail?.system_metadata?.duration, 180);

      const currentStart = safeNumber(override?.start ?? base?.start, 0);
      const currentEnd = safeNumber(override?.end ?? base?.end ?? currentStart + 2.5, currentStart + 2.5);

      const filename = videoDetail?.system_metadata?.filename;
      const cloudinaryId =
        typeof filename === "string" ? filename.replace(/\.mp4$/i, "") : base?.cloudinaryId || videoId;

      const { getOptimalClipUrl } = await import("@/utils/cloudinary");
      const optimalClip = getOptimalClipUrl(cloudinaryId, currentStart, currentEnd);
      const previewUrl = optimalClip.url;
      const previewWindow = {
        previewStart: optimalClip.previewStart,
        previewEnd: optimalClip.previewEnd,
        previewDuration: optimalClip.previewDuration,
      };

      const fixedDuration = slot.constraints.kind === "beatLocked" ? slot.targetDuration : null;

      setEditModalState({
        slotId: slot.id,
        slot,
        videoDetail,
        previewUrl,
        previewWindow,
        initialStart: currentStart,
        initialEnd: currentEnd,
        videoDuration,
        fixedDuration: typeof fixedDuration === "number" && fixedDuration > 0 ? fixedDuration : null,
      });
    },
    [overrides, setErrorMessage]
  );

  const saveEdit = useCallback(
    (slotId: string, start: number, end: number) => {
      const slot = clipMap.slots.find((s) => s.id === slotId);
      if (!slot) return;
      const base = overrides[slotId]?.videoId ? overrides[slotId] : slot.assignedClip;
      const videoId = (base as any)?.videoId;
      if (!videoId) return;

      const durationCheck = enforceDuration(slot, { start, end }, clipMap.fps);
      if (!durationCheck.ok) {
        setErrorMessage?.(durationCheck.error);
        return;
      }

      setOverrides((prev) => ({
        ...prev,
        [slotId]: {
          videoId,
          indexId: (base as any)?.indexId ?? null,
          start,
          end,
        },
      }));
      setEditModalState(null);
    },
    [clipMap.fps, clipMap.slots, overrides, setOverrides, setErrorMessage]
  );

  const saveReplace = useCallback(
    (_segmentIndex: number, replacementClip: any) => {
      // ReplaceModal gives us segmentIndex; we map it back via the active slotId in state.
      const slotId = replaceModalState?.slotId;
      const slot = replaceModalState?.slot;
      if (!slotId || !slot) return;

      const chronoCheck = validateCandidateChrono(slot, replacementClip);
      if (!chronoCheck.ok) {
        setErrorMessage?.(chronoCheck.reason || "Candidate violates chronological constraints.");
        return;
      }

      const start = safeNumber(replacementClip?.start, 0);
      const end = safeNumber(replacementClip?.end, start);

      const durationCheck = enforceDuration(slot, { start, end }, clipMap.fps);
      if (!durationCheck.ok) {
        setErrorMessage?.(durationCheck.error);
        return;
      }

      setOverrides((prev) => ({
        ...prev,
        [slotId]: {
          videoId: replacementClip.videoId || replacementClip.video_id,
          indexId: replacementClip.indexId || null,
          start,
          end,
        },
      }));
      setReplaceModalState(null);
    },
    [clipMap.fps, replaceModalState, setOverrides, setErrorMessage, validateCandidateChrono]
  );

  const isReplaceClipDisabled = useCallback(
    (clip: any) => {
      const slot = replaceModalState?.slot;
      if (!slot) return false;
      const res = validateCandidateChrono(slot, clip);
      return !res.ok;
    },
    [replaceModalState, validateCandidateChrono]
  );

  const getReplaceClipDisabledReason = useCallback(
    (clip: any) => {
      const slot = replaceModalState?.slot;
      if (!slot) return null;
      const res = validateCandidateChrono(slot, clip);
      return res.ok ? null : res.reason || "Candidate violates chronological constraints.";
    },
    [replaceModalState, validateCandidateChrono]
  );

  const reselect = useCallback(
    async (slot: ClipSlot) => {
      setErrorMessage?.(null);

      // If the upstream plan already includes per-slot candidates, reuse that pool for reselect.
      const upstreamCandidates = Array.isArray(slot?.upstream?.candidateClips) ? slot.upstream.candidateClips : [];
      if (upstreamCandidates.length) {
        const pick = upstreamCandidates[Math.floor(Math.random() * upstreamCandidates.length)];
        const replacement = {
          videoId: pick.videoId || pick.video_id,
          indexId: pick.indexId || null,
          start: safeNumber(pick.start, 0),
          end: safeNumber(pick.end, safeNumber(pick.start, 0) + 1),
          sourcePoolIndex: typeof pick.sourcePoolIndex === "number" ? pick.sourcePoolIndex : null,
          startGlobalSeconds: typeof pick.startGlobalSeconds === "number" ? pick.startGlobalSeconds : null,
        };

        const chronoCheck = validateCandidateChrono(slot, replacement);
        if (!chronoCheck.ok) {
          setErrorMessage?.(chronoCheck.reason || "Candidate violates chronological constraints.");
          return;
        }
        const durationCheck = enforceDuration(slot, { start: replacement.start, end: replacement.end }, clipMap.fps);
        if (!durationCheck.ok) {
          setErrorMessage?.(durationCheck.error);
          return;
        }
        setOverrides((prev) => ({
          ...prev,
          [slot.id]: {
            videoId: replacement.videoId,
            indexId: replacement.indexId,
            start: replacement.start,
            end: replacement.end,
          },
        }));
        return;
      }

      // Quick Edit 3 / Instant Edit 3: delegate to server-side assignment logic for a single slot.
      const songSlug = clipMap?.upstreamPlan?.songSlug;
      const chronologicalOrder = Boolean(clipMap?.upstreamPlan?.chronologicalOrder);
      const hasPoolIndex = typeof slot.assignedClip?.sourcePoolIndex === "number";
      if (songSlug && hasPoolIndex) {
        const usedPoolIndices = clipMap.slots
          .map((s) => s.assignedClip?.sourcePoolIndex)
          .filter((v) => typeof v === "number");
        const bounds = findNeighborBounds(clipMap, slot);

        try {
          const res = await fetch(reselectEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              songSlug,
              chronologicalOrder,
              reselect: {
                segmentIndex: slot.order,
                usedPoolIndices,
                minPoolIndex: bounds.minPoolIndex,
                maxPoolIndex: bounds.maxPoolIndex,
              },
            }),
          });
          const payload = await res.json();
          if (!res.ok) {
            throw new Error(payload?.error || "Reselect failed");
          }
          const replacement = payload?.replacementClip || payload?.replacement || null;
          if (!replacement?.videoId && !replacement?.video_id) {
            throw new Error("Reselect failed: missing replacement clip");
          }

          const chronoCheck = validateCandidateChrono(slot, replacement);
          if (!chronoCheck.ok) {
            setErrorMessage?.(chronoCheck.reason || "Candidate violates chronological constraints.");
            return;
          }

          const start = safeNumber(replacement?.start, 0);
          const end = safeNumber(replacement?.end, start);
          const durationCheck = enforceDuration(slot, { start, end }, clipMap.fps);
          if (!durationCheck.ok) {
            setErrorMessage?.(durationCheck.error);
            return;
          }

          setOverrides((prev) => ({
            ...prev,
            [slot.id]: {
              videoId: replacement.videoId || replacement.video_id,
              indexId: replacement.indexId || null,
              start,
              end,
            },
          }));
          return;
        } catch (err: any) {
          setErrorMessage?.(err?.message || "Reselect failed");
          return;
        }
      }

      // Fallback: treat reselect as opening the replace flow.
      openReplace(slot);
    },
    [clipMap, openReplace, reselectEndpoint, setErrorMessage, setOverrides, validateCandidateChrono]
  );

  const clearOverride = useCallback(
    (slotId: string) => {
      setOverrides((prev) => {
        if (!prev[slotId]) return prev;
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
    },
    [setOverrides]
  );

  return {
    editModalState,
    replaceModalState,
    openEdit,
    openReplace,
    closeEdit,
    closeReplace,
    saveEdit,
    saveReplace,
    isReplaceClipDisabled,
    getReplaceClipDisabledReason,
    reselect,
    clearOverride,
  };
};

