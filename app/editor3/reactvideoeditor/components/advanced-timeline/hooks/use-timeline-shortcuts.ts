import { useHotkeys } from "react-hotkeys-hook";
import { ZOOM_CONSTRAINTS } from "../constants";

interface UseTimelineShortcutsProps {
  handlePlayPause: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  zoomScale: number;
  setZoomScale: (scale: number) => void;
  stepFrame: (direction: -1 | 1) => void;
}

/**
 * A custom hook that sets up keyboard shortcuts for timeline controls
 *
 * Keyboard shortcuts:
 * - Space: Play/Pause
 * - Cmd/Ctrl + Z: Undo
 * - Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y: Redo
 * - Cmd/Ctrl + Plus/=: Zoom in
 * - Cmd/Ctrl + Minus/-: Zoom out
 * - Arrow Left/Right: Step one frame backward/forward
 *
 * @param {Object} props
 * @param {() => void} props.handlePlayPause - Function to toggle play/pause state
 * @param {() => void} props.undo - Function to handle undo operation
 * @param {() => void} props.redo - Function to handle redo operation
 * @param {boolean} props.canUndo - Whether undo operation is available
 * @param {boolean} props.canRedo - Whether redo operation is available
 * @param {number} props.zoomScale - Current zoom level
 * @param {(scale: number) => void} props.setZoomScale - Function to update zoom level
 * @param {(direction: -1 | 1) => void} props.stepFrame - Function to step the playhead one frame
 */
export const useTimelineShortcuts = ({
  handlePlayPause,
  undo,
  redo,
  canUndo,
  canRedo,
  zoomScale,
  setZoomScale,
  stepFrame,
}: UseTimelineShortcutsProps) => {
  const shouldSkipForInputs = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return false;

    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      !!target.closest('[contenteditable="true"]')
    );
  };

  useHotkeys(
    "space",
    (e) => {
      if (shouldSkipForInputs(e)) {
        return;
      }
      
      e.preventDefault();
      handlePlayPause();
    }
  );

  useHotkeys("meta+z, ctrl+z", (e) => {
    e.preventDefault();
    if (canUndo) undo();
  });

  useHotkeys("meta+shift+z, ctrl+shift+z, meta+y, ctrl+y", (e) => {
    e.preventDefault();
    if (canRedo) redo();
  });

  useHotkeys("meta+=, meta+plus, ctrl+=, ctrl+plus", (e) => {
    e.preventDefault();
    const newScale = Math.min(
      zoomScale + ZOOM_CONSTRAINTS.step,
      ZOOM_CONSTRAINTS.max
    );
    setZoomScale(newScale);
  });

  useHotkeys(
    "meta+-, meta+minus, ctrl+-, ctrl+minus",
    (e) => {
      e.preventDefault();
      const newScale = Math.max(
        zoomScale - ZOOM_CONSTRAINTS.step,
        ZOOM_CONSTRAINTS.min
      );
      setZoomScale(newScale);
    },
    {
      keydown: true,
      preventDefault: true,
    }
  );

  useHotkeys(
    "arrowright",
    (e) => {
      if (shouldSkipForInputs(e) || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      e.preventDefault();
      stepFrame(1);
    },
    {
      keydown: true,
      preventDefault: true,
    }
  );

  useHotkeys(
    "arrowleft",
    (e) => {
      if (shouldSkipForInputs(e) || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      e.preventDefault();
      stepFrame(-1);
    },
    {
      keydown: true,
      preventDefault: true,
    }
  );
}; 