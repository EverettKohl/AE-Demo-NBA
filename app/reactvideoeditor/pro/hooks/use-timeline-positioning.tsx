import { Overlay } from "../types";
import { FPS, MIN_START_TIME_SECONDS } from "../../../constants";

export const useTimelinePositioning = () => {
  const MIN_START_FRAME = Math.round(MIN_START_TIME_SECONDS * FPS);
  const clampToMinStart = (frame: number) => Math.max(MIN_START_FRAME, frame);

  /**
   * Finds the next available position for a new overlay in a multi-row timeline
   * @param existingOverlays - Array of current overlays in the timeline
   * @param visibleRows - Number of rows currently visible in the timeline
   * @param totalDuration - Total duration of the timeline in frames
   * @returns Object containing the starting position (from) and row number
   */
  const findNextAvailablePosition = (
    existingOverlays: Overlay[],
    visibleRows: number,
    totalDuration: number
  ): { from: number; row: number } => {
    // If no overlays exist, start at the beginning
    if (existingOverlays.length === 0) {
      return { from: MIN_START_FRAME, row: 0 };
    }

    const sortedOverlays = [...existingOverlays].sort(
      (a, b) => a.from - b.from
    );

    // Find the earliest available position across all rows
    let bestPosition = { from: totalDuration, row: 0 };

    // Check each visible row
    for (let row = 0; row < visibleRows; row++) {
      const overlaysInRow = sortedOverlays.filter(
        (overlay) => overlay.row === row
      );

      // If row is empty, we can place at the start
      if (overlaysInRow.length === 0) {
        return { from: MIN_START_FRAME, row };
      }

      let lastEndTime = 0;

      // Check gaps between overlays in this row
      for (const overlay of overlaysInRow) {
        if (overlay.from - lastEndTime >= 1) {
          // Found a potential gap
          const potentialPosition = clampToMinStart(lastEndTime);

          // Check if this gap overlaps with any overlay in other rows
          const isOverlapping = sortedOverlays.some(
            (other) =>
              other.row !== row &&
              potentialPosition < other.from + other.durationInFrames &&
              other.from < potentialPosition + 1
          );

          if (!isOverlapping && potentialPosition < bestPosition.from) {
            bestPosition = { from: potentialPosition, row };
          }
        }
        lastEndTime = Math.max(
          lastEndTime,
          overlay.from + overlay.durationInFrames
        );
      }

      // Check position after the last overlay in this row
      const candidatePosition = clampToMinStart(lastEndTime);
      const isOverlapping = sortedOverlays.some(
        (other) =>
          other.row !== row &&
          candidatePosition < other.from + other.durationInFrames &&
          other.from < candidatePosition + 1
      );

      if (!isOverlapping && candidatePosition < bestPosition.from) {
        bestPosition = { from: candidatePosition, row };
      }
    }

    // If we found a valid position, use it
    if (bestPosition.from < totalDuration) {
      return { from: clampToMinStart(bestPosition.from), row: bestPosition.row };
    }

    // If no better position found, find the row with the earliest end time
    const rowEndTimes = new Array(visibleRows).fill(0);
    sortedOverlays.forEach((overlay) => {
      if (overlay.row < visibleRows) {
        rowEndTimes[overlay.row] = Math.max(
          rowEndTimes[overlay.row],
          overlay.from + overlay.durationInFrames
        );
      }
    });

    const earliestRow = rowEndTimes.reduce(
      (minRow, endTime, index) =>
        endTime < rowEndTimes[minRow] ? index : minRow,
      0
    );

    return {
      from: clampToMinStart(rowEndTimes[earliestRow]),
      row: earliestRow,
    };
  };

  /**
   * Adds a new overlay at the current playhead position by creating a new row at the top
   * All existing overlays are shifted down by one row
   * @param currentFrame - Current playhead position in frames
   * @param existingOverlays - Array of current overlays in the timeline
   * @param placement - Where to add the overlay: 'top' (default) or 'bottom'
   * @returns Object containing the starting position (from) and row number
   */
  const addAtPlayhead = (
    currentFrame: number,
    existingOverlays: Overlay[],
    placement: 'top' | 'bottom' = 'top'
  ): { from: number; row: number; updatedOverlays: Overlay[] } => {
    const clampedFrame = clampToMinStart(currentFrame);
    if (placement === 'bottom') {
      // Find the highest row number currently in use
      const maxRow = existingOverlays.reduce(
        (max, overlay) => Math.max(max, overlay.row),
        -1
      );
      
      // Add to the next row at the bottom (no shifting needed)
      return {
        from: clampedFrame,
        row: maxRow + 1,
        updatedOverlays: existingOverlays
      };
    }

    // Default behavior: add at top and shift all existing overlays down
    const updatedOverlays = existingOverlays.map(overlay => ({
      ...overlay,
      row: overlay.row + 1
    }));

    // Return position at playhead on the new top row (row 0)
    return {
      from: clampedFrame,
      row: 0,
      updatedOverlays
    };
  };

  return { findNextAvailablePosition, addAtPlayhead };
};
