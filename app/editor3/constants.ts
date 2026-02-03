import { Overlay } from "./reactvideoeditor/types";

// Default and maximum number of rows to display in the editor
export const INITIAL_ROWS = 5;
export const MAX_ROWS = 8;
// Frames per second for video rendering
export const FPS = 30;

// Lead-in buffer to reserve at the start of every timeline
export const TIMELINE_GRACE_SECONDS = 1;
export const TIMELINE_GRACE_FRAMES = TIMELINE_GRACE_SECONDS * FPS;

// Name of the component being tested/rendered
export const COMP_NAME = "TestComponent";

// Video configuration
export const DURATION_IN_FRAMES = 30;
export const VIDEO_WIDTH = 1280; // 720p HD video dimensions
export const VIDEO_HEIGHT = 720;

// UI configuration
export const ROW_HEIGHT = 44; // Slightly increased from 48
export const SHOW_LOADING_PROJECT_ALERT = true; // Controls visibility of asset loading indicator
export const DISABLE_MOBILE_LAYOUT = false;
export const SHOW_MOBILE_WARNING = true; // Show warning modal on mobile devices
export const DEFAULT_BACKGROUND_COLOR = "#000000";

/**
 * This constant disables video keyframe extraction in the browser. Enable this if you're working with
 * multiple videos or large video files to improve performance. Keyframe extraction is CPU-intensive and can
 * cause browser lag. For production use, consider moving keyframe extraction to the server side.
 * Future versions of Remotion may provide more efficient keyframe handling.
 */
export const DISABLE_VIDEO_KEYFRAMES = false;

// AWS deployment configuration
export const SITE_NAME = "example-site";
export const LAMBDA_FUNCTION_NAME =
  "remotion-render-4-0-356-mem2048mb-disk2048mb-120sec";
export const REGION = "us-east-1";

// Zoom control configuration
export const ZOOM_CONSTRAINTS = {
  min: 0.1, // Minimum zoom level (changed from 1)
  max: 30, // Maximum zoom level (increased from 10 for extreme zoom capability)
  step: 0.15, // Smallest increment for manual zoom controls
  default: 1, // Default zoom level
  zoomStep: 0.15, // Zoom increment for zoom in/out buttons
  wheelStep: 0.5, // Zoom increment for mouse wheel
  transitionDuration: 100, // Animation duration in milliseconds
  easing: "cubic-bezier(0.4, 0.0, 0.2, 1)", // Smooth easing function for zoom transitions
};

// Timeline Snapping configuration
export const SNAPPING_CONFIG = {
  thresholdFrames: 1, // Default snapping sensitivity in frames
  enableVerticalSnapping: true, // Enable snapping to items in adjacent rows
};

// Add new constant for push behavior
export const ENABLE_PUSH_ON_DRAG = false; // Set to false to disable pushing items on drag

// Autosave configuration
export const AUTO_SAVE_INTERVAL = 10000; // Autosave every 10 seconds

// Overlay colors for timeline items
export const OVERLAY_COLORS = {
  TEXT: '#9E53E6', // blue
  IMAGE: '#10b981', // green
  VIDEO: '#8b5cf6', // purple
  SOUND: '#f59e0b', // amber
  CAPTION: '#6b7280', 
  STICKER: '#ec4899', // pink
  SHAPE: '#6b7280', // gray
  DEFAULT: '#9ca3af', // gray
} as const;

/**
 * Default duration for image overlays when added to an empty timeline
 * Equivalent to approximately 6.67 seconds at 30fps
 */
export const DEFAULT_IMAGE_DURATION_FRAMES = 200;

/**
 * Percentage of composition duration to use for smart image duration
 * When adding an image to a timeline with existing content, the image duration
 * will be set to this percentage of the total composition duration (0.2 = 20% or 1/5th)
 */
export const IMAGE_DURATION_PERCENTAGE = 0.2;

/**
 * Minimum composition duration in seconds
 * Used when calculating smart durations for empty timelines
 */
export const MINIMUM_COMPOSITION_DURATION_SECONDS = 1;

export const DEFAULT_OVERLAYS: Overlay[] = [];
