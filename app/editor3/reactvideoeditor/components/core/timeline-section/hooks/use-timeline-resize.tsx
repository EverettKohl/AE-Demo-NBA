import React from 'react';
import { useVerticalResize } from '../../../../hooks/use-vertical-resize';
import { TIMELINE_CONSTANTS } from '../../../advanced-timeline/constants';
import { Overlay } from '../../../../types';

interface UseTimelineResizeOptions {
  overlays: Overlay[];
}

/**
 * Constants for timeline height calculations
 */
export const TIMELINE_HEIGHT_CONSTANTS = {
  /** Reserved space for editor header and minimum video player */
  RESERVED_VIEWPORT_SPACE: 260,
  /** Compact minimum height: keep markers + handle visible */
  MIN_TIMELINE_HEIGHT: 80,
  /** Additional padding for timeline (scrollbar + comfortable viewing) */
  TIMELINE_PADDING: 67,
} as const;

/**
 * Custom hook for managing timeline resize functionality
 * Calculates dynamic max height based on track count and manages resize state
 * Auto-expands timeline height when new tracks are added
 */
export const useTimelineResize = ({ overlays }: UseTimelineResizeOptions) => {
  /**
   * Calculate the number of tracks based on overlays
   * Tracks are determined by the row property of overlays
   * Memoized to avoid recalculation on every render
   */
  const trackCount = React.useMemo(() => {
    if (overlays.length === 0) return 1; // Minimum 1 track
    const maxRow = Math.max(...overlays.map(overlay => overlay.row || 0));
    return maxRow + 1; // Rows are 0-indexed
  }, [overlays]);

  /**
   * Preferred height (not enforced) that comfortably fits tracks.
   * Used for initial sizing and auto-expansion when new rows appear.
   */
  const preferredHeight = React.useMemo(() => {
    const requiredHeight = TIMELINE_CONSTANTS.MARKERS_HEIGHT +
      (trackCount * TIMELINE_CONSTANTS.TRACK_HEIGHT) +
      TIMELINE_HEIGHT_CONSTANTS.TIMELINE_PADDING;

    return Math.max(TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT, requiredHeight);
  }, [trackCount]);

  // Track previous track count to detect when new tracks are added
  const prevTrackCountRef = React.useRef(trackCount);
  
  // Track previous bottomHeight to avoid dependency issues in auto-expand effect
  const prevBottomHeightRef = React.useRef(0);

  /**
   * Calculate maximum height based on the available viewport.
   * Always ≥ compact min height so the handle has usable range.
   */
  const maxAvailableHeight = React.useMemo(() => {
    if (typeof window === 'undefined') {
      return TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT;
    }

    const viewportHeight = window.innerHeight;
    const usableHeight = viewportHeight - TIMELINE_HEIGHT_CONSTANTS.RESERVED_VIEWPORT_SPACE;

    return Math.max(TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT, usableHeight);
  }, []);

  /**
   * Calculate initial height: use full available viewport height on first load
   * 
   * Note: This is only called once during initialization (not on window resize)
   * Users can manually resize the timeline, and their preference is saved to localStorage
   */
  const calculateInitialHeight = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT; // SSR fallback
    }
    
    // Use full available height: viewport height minus reserved space for header and video player
    const viewportHeight = window.innerHeight;
    const fullHeight = viewportHeight - TIMELINE_HEIGHT_CONSTANTS.RESERVED_VIEWPORT_SPACE;
    
    // Ensure we never go below minimum height
    return Math.max(TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT, fullHeight);
  }, []);

  /**
   * Vertical resize functionality for timeline with dynamic max height
   */
  const { bottomHeight, isResizing, handleMouseDown, handleTouchStart, setHeight } = useVerticalResize({
    initialHeight: Math.max(TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT, Math.min(preferredHeight, calculateInitialHeight())),
    minHeight: TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT,
    maxHeight: maxAvailableHeight,
    storageKey: 'editor-timeline-height',
  });

  /**
   * Ensure the timeline stays within the dynamic bounds when they change.
   * - Clamp up to compact minimum (so handle stays visible).
   * - Clamp down to the current maximum (viewport changes).
   */
  React.useEffect(() => {
    if (bottomHeight < TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT) {
      setHeight(TIMELINE_HEIGHT_CONSTANTS.MIN_TIMELINE_HEIGHT);
      return;
    }

    if (bottomHeight > maxAvailableHeight) {
      setHeight(maxAvailableHeight);
    }
  }, [bottomHeight, maxAvailableHeight, setHeight]);

  /**
   * Auto-expand timeline height when new tracks are added
   * 
   * Uses refs to avoid race conditions and infinite loops from including
   * bottomHeight in the dependency array
   */
  React.useEffect(() => {
    const prevCount = prevTrackCountRef.current;
    
    if (trackCount > prevCount) {
      // Calculate how many new rows were added
      const newRows = trackCount - prevCount;
      const additionalHeight = newRows * TIMELINE_CONSTANTS.TRACK_HEIGHT;
      
      // Expand the timeline to show the new row(s)
      // Use the ref value to avoid bottomHeight dependency
      const targetHeight = Math.min(
        maxAvailableHeight,
        Math.max(
          prevBottomHeightRef.current + additionalHeight,
          preferredHeight
        )
      );
      setHeight(targetHeight);
    }
    
    // Update the refs for next comparison
    prevTrackCountRef.current = trackCount;
  }, [trackCount, preferredHeight, maxAvailableHeight, setHeight]);

  /**
   * Keep the bottomHeight ref in sync
   * Separate effect to avoid dependency issues
   */
  React.useEffect(() => {
    prevBottomHeightRef.current = bottomHeight;
  }, [bottomHeight]);

  return {
    bottomHeight,
    isResizing,
    handleMouseDown,
    handleTouchStart,
    setHeight,
    trackCount,
    dynamicMaxHeight: maxAvailableHeight,
  };
};

