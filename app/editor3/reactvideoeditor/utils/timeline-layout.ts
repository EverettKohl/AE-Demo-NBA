export const TIMELINE_COLLAPSE_EVENT = "editor:timeline:collapse-to-rows";

type CollapseDetail = {
  rows?: number;
};

/**
 * Request the timeline to collapse so only the top N tracks remain visible.
 * Uses a window event so timeline layout logic can respond without prop drilling.
 */
export const requestTimelineCollapseToRows = (rows: number = 2) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CollapseDetail>(TIMELINE_COLLAPSE_EVENT, {
      detail: { rows },
    })
  );
};
