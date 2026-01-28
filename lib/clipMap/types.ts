export type ClipMapMode = "song" | "freeform";

export type SlotKind = "beatLocked" | "pauseMusic" | "freeform";

export type SlotConstraints = {
  kind: SlotKind;
  /**
   * When true, replacement/reselection should preserve chronological order.
   * Adapters may additionally provide window metadata in `metadata`.
   */
  chronological?: boolean;
};

export type AssignedClip = {
  videoId: string | null;
  indexId?: string | null;
  cloudinaryId?: string | null;
  start: number;
  end: number;
  /** Optional extra fields carried through from upstream plans. */
  sourcePoolIndex?: number | null;
  localPath?: string | null;
};

export type ClipSlot = {
  id: string;
  /** 0-based display order within the map. */
  order: number;
  /** Song time (seconds) for song mode; null for freeform. */
  songTime: number | null;
  /** Target/locked duration (seconds) where applicable. */
  targetDuration: number | null;
  constraints: SlotConstraints;
  assignedClip: AssignedClip | null;
  /** Raw upstream segment/slot data for consumers that still need it. */
  upstream?: any;
  /** Extra slot metadata (e.g. sourcePoolIndex/chrono window). */
  metadata?: Record<string, any>;
};

export type ClipMap = {
  id: string;
  mode: ClipMapMode;
  fps: number;
  chronologicalOrder?: boolean;
  slots: ClipSlot[];
  /** Raw upstream plan payload for compatibility shims. */
  upstreamPlan?: any;
};

export type AssignedClipOverride = {
  videoId: string;
  indexId?: string | null;
  start: number;
  end: number;
};

export const isBeatLocked = (slot: ClipSlot) => slot.constraints.kind === "beatLocked";
export const isPauseMusic = (slot: ClipSlot) => slot.constraints.kind === "pauseMusic";
export const isFreeform = (slot: ClipSlot) => slot.constraints.kind === "freeform";

