import { computeDocumentSize } from "./document";
import { getObjectCenter, objectPath, renderObject } from "./object";
import { setBlurSync } from "./blur";
import { VIDEO_MIME_RE } from "./image";
import { VIDEO_PATH_RE } from "./constants";
import type { EditorObject, EditorState, MediaType } from "../types";

// ---------------------------------------------------------------------------
// Video helpers (ported from the Wails app)
// ---------------------------------------------------------------------------

// mm:ss for the timeline labels.
export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function isVideoFile(file: File): boolean {
  return VIDEO_MIME_RE.test(file.type || "") || VIDEO_PATH_RE.test(file.name || "");
}

export function isVideoMime(type: string): boolean {
  return VIDEO_MIME_RE.test(type || "");
}

// Whether a timed object is visible at time `t`. Objects without a range are
// always visible; image projects ignore timing entirely.
export function isObjectActiveAt(obj: EditorObject, t: number, mediaType: MediaType): boolean {
  if (mediaType !== "video") return true;
  if (obj.tStart == null && obj.tEnd == null) return true;
  const start = obj.tStart == null ? 0 : obj.tStart;
  const end = obj.tEnd == null ? Infinity : obj.tEnd;
  return t >= start - 1e-4 && t <= end + 1e-4;
}

// A freshly created object in a video project appears from the playhead until
// the end of the clip.
export function defaultTimingPatch(
  mediaType: MediaType,
  playhead: number,
  duration: number,
): Partial<EditorObject> | null {
  if (mediaType !== "video") return null;
  return { tStart: Math.round(playhead * 100) / 100, tEnd: duration || 0 };
}

export function chooseRulerStep(dur: number): number {
  const target = dur / 10;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const s of steps) {
    if (s >= target) return s;
  }
  return 300;
}

export function formatTick(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${Math.round(s * 10) / 10}s`;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}

export function clipLabel(obj: EditorObject): string {
  if (obj.type === "text") {
    const t = (obj.text || "").replace(/\s+/g, " ").trim();
    return t ? `T  ${t.length > 20 ? t.slice(0, 20) + "…" : t}` : "Text";
  }
  const names: Record<string, string> = {
    rect: "Rectangle",
    ellipse: "Ellipse",
    image: "Image",
    brush: "Brush",
  };
  return names[obj.type] || obj.type;
}

// Render a single object to a transparent full-document PNG. Objects are
// static, so one image per object plus a time window is all ffmpeg needs.
export function renderObjectPng(state: EditorState, obj: EditorObject): string {
  const size = computeDocumentSize(state.baseImage, state.padding);
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(size.width));
  off.height = Math.max(1, Math.round(size.height));
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("Could not create object canvas");
  setBlurSync(true);
  try {
    renderObject(ctx, obj, size.width);
  } finally {
    setBlurSync(false);
  }
  return off.toDataURL("image/png");
}

export function isBlurObject(obj: EditorObject): boolean {
  return (
    !!obj &&
    obj.mode === "blur" &&
    (obj.type === "rect" || obj.type === "ellipse" || obj.type === "brush")
  );
}

// A black-and-white mask for a background-blur object: white where the shape
// is, black elsewhere. ffmpeg blurs the (moving) frame and composites it back
// through this mask, so the blur tracks the video rather than a frozen frame.
export function renderBlurMaskPng(state: EditorState, obj: EditorObject): string {
  const size = computeDocumentSize(state.baseImage, state.padding);
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(size.width));
  off.height = Math.max(1, Math.round(size.height));
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("Could not create blur mask canvas");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, off.width, off.height);
  const rot = obj.rotation || 0;
  ctx.save();
  if (rot) {
    const c = getObjectCenter(obj, size.width);
    ctx.translate(c.x, c.y);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-c.x, -c.y);
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  objectPath(ctx, obj);
  ctx.fill();
  ctx.restore();
  return off.toDataURL("image/png");
}
