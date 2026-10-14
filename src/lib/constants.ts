import type { VideoCodec, VideoHardware, VideoResolution } from "../types";

export const DEFAULT_FONT = "Zain Bold";
export const FONT_FALLBACK = '"Zain", "Vazirmatn", system-ui, sans-serif';

export const DEFAULT_CANVAS = { width: 800, height: 600 };

// Default canvas background.
export const DEFAULT_BACKGROUND = "#000000";
export const MAX_HISTORY = 120;
// Consecutive history commits that share a key and arrive within this window
// (e.g. typing or dragging a slider) collapse into one undo step.
export const COMMIT_COALESCE_MS = 800;
export const PREFERENCES_VERSION = 1;

export const DEFAULT_TEXT_DIRECTION = "rtl";
export const DEFAULT_RECT_RADIUS = 12;
export const DEFAULT_BLUR_RADIUS = 16;
export const DEFAULT_VIDEO_FPS = 30;
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = "original";
export const DEFAULT_VIDEO_CODEC: VideoCodec = "h264";
export const DEFAULT_VIDEO_HARDWARE: VideoHardware = "software";

export const VIDEO_PATH_RE = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|avi)$/i;
export const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

// Render the document at a higher internal resolution so text and vector shapes
// stay crisp even when the base image is small.
export const RENDER_TARGET = 1600;
export const MAX_RENDER_SCALE = 4;
export const PLAYBACK_MAX_SCALE = 2;

export const CURSORS: Record<string, string> = {
  select: "default",
  text: "text",
  brush: "crosshair",
  rect: "crosshair",
  ellipse: "crosshair",
  crop: "crosshair",
  eyedropper: "crosshair",
};
