import {
  DEFAULT_FONT,
  DEFAULT_RECT_RADIUS,
  DEFAULT_TEXT_DIRECTION,
  FONT_FALLBACK,
} from "./constants";
import type { DocSize } from "./document";
import { renderBlurFill } from "./blur";
import type { EditorObject, EditorState, ShapeMode, TextPreset } from "../types";

let idCounter = 0;

export function uid(): string {
  idCounter += 1;
  return `o${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function fontStack(family: string | undefined): string {
  const name = (family || DEFAULT_FONT).replace(/"/g, "");
  return '"' + name + '", ' + FONT_FALLBACK;
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export function rotatePoint(
  p: { x: number; y: number },
  center: { x: number; y: number },
  angleDeg: number,
): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function cloneObject(obj: EditorObject): EditorObject {
  const copy = { ...obj };
  if (obj.points) copy.points = obj.points.map((p) => ({ x: p.x, y: p.y }));
  return copy;
}

export function isResizable(obj: EditorObject): boolean {
  return (
    obj.type === "text" ||
    obj.type === "rect" ||
    obj.type === "ellipse" ||
    obj.type === "image"
  );
}

export function isRotatable(obj: EditorObject | null | undefined): boolean {
  return !!obj && obj.type !== "brush";
}

// ---------------------------------------------------------------------------
// Text metrics
// ---------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    measureCtx = c.getContext("2d");
  }
  if (!measureCtx) throw new Error("Could not create measuring context");
  return measureCtx;
}

export interface TextMetrics {
  fontSize: number;
  lineHeight: number;
  lines: string[];
  width: number;
  height: number;
}

export function getEffectiveFontSize(obj: EditorObject, docWidth: number): number {
  if (!obj.autoFit) return obj.fontSize ?? 48;
  const ctx = getMeasureCtx();
  const avail = Math.max(40, docWidth - 40);
  ctx.save();
  let fs = Math.max(8, obj.maxFontSize || obj.fontSize || 48);
  let guard = 0;
  const lines = (obj.text || " ").split("\n");
  while (fs > 8 && guard < 600) {
    ctx.font = fs + "px " + fontStack(obj.fontFamily);
    let w = 0;
    for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
    if (w <= avail) break;
    fs -= 1;
    guard++;
  }
  ctx.restore();
  return fs;
}

const metricsCache = new Map<string, TextMetrics>();

export function getTextMetrics(obj: EditorObject, docWidth: number): TextMetrics {
  // Cache by content signature rather than object identity so that dragging an
  // auto-fit text does not re-measure it every frame.
  const sig = [
    obj.text || " ",
    obj.fontFamily,
    obj.fontSize,
    obj.maxFontSize,
    obj.autoFit ? 1 : 0,
    Math.round(docWidth),
  ].join("\u0000");
  const cached = metricsCache.get(sig);
  if (cached) return cached;

  const ctx = getMeasureCtx();
  const fontSize = getEffectiveFontSize(obj, docWidth);
  const lineHeight = fontSize * 1.15;
  const lines = (obj.text || " ").split("\n");
  ctx.save();
  ctx.font = fontSize + "px " + fontStack(obj.fontFamily);
  let width = 0;
  for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
  ctx.restore();
  const metrics: TextMetrics = { fontSize, lineHeight, lines, width, height: lineHeight * lines.length };
  if (metricsCache.size > 400) metricsCache.clear();
  metricsCache.set(sig, metrics);
  return metrics;
}

export function getTextBounds(obj: EditorObject, docWidth: number) {
  const m = getTextMetrics(obj, docWidth);
  const sx = obj.scaleX == null ? 1 : obj.scaleX;
  const sy = obj.scaleY == null ? 1 : obj.scaleY;
  const width = m.width * Math.abs(sx);
  const height = m.height * Math.abs(sy);
  let left: number;
  if (obj.align === "left") left = obj.x;
  else if (obj.align === "right") left = obj.x - width;
  else left = obj.x - width / 2;
  return { x: left, y: obj.y - height / 2, width, height };
}

export function getObjectBounds(obj: EditorObject, docWidth: number) {
  if (obj.type === "text") return getTextBounds(obj, docWidth);
  if (obj.type === "brush") {
    const pts = obj.points || [];
    if (!pts.length) return { x: obj.x || 0, y: obj.y || 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = (obj.size ?? 1) / 2;
    return {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + (obj.size ?? 1),
      height: maxY - minY + (obj.size ?? 1),
    };
  }
  return { x: obj.x, y: obj.y, width: obj.width ?? 0, height: obj.height ?? 0 };
}

export function getObjectCenter(obj: EditorObject, docWidth: number) {
  const b = getObjectBounds(obj, docWidth);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function toLocalPoint(
  obj: EditorObject,
  point: { x: number; y: number },
  docWidth: number,
) {
  const rot = obj.rotation || 0;
  if (!rot) return point;
  return rotatePoint(point, getObjectCenter(obj, docWidth), -rot);
}

export function handleSizeDoc(displayScale: number): number {
  const scale = displayScale > 0 ? displayScale : 1;
  return 11 / scale;
}

export function getHandleRects(obj: EditorObject, displayScale: number, docWidth: number) {
  const b = getObjectBounds(obj, docWidth);
  const s = handleSizeDoc(displayScale);
  const midX = b.x + b.width / 2;
  const midY = b.y + b.height / 2;
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  return (
    [
      ["nw", b.x, b.y],
      ["n", midX, b.y],
      ["ne", right, b.y],
      ["e", right, midY],
      ["se", right, bottom],
      ["s", midX, bottom],
      ["sw", b.x, bottom],
      ["w", b.x, midY],
    ] as const
  ).map((d) => ({ name: d[0], x: d[1] - s / 2, y: d[2] - s / 2, width: s, height: s }));
}

export function hitHandle(
  obj: EditorObject,
  point: { x: number; y: number },
  displayScale: number,
  docWidth: number,
): string | null {
  if (!isResizable(obj)) return null;
  const local = toLocalPoint(obj, point, docWidth);
  const handles = getHandleRects(obj, displayScale, docWidth);
  for (const h of handles) {
    if (local.x >= h.x && local.x <= h.x + h.width && local.y >= h.y && local.y <= h.y + h.height) {
      return h.name;
    }
  }
  return null;
}

export function getRotateHandleRect(obj: EditorObject, displayScale: number, docWidth: number) {
  const b = getObjectBounds(obj, docWidth);
  const u = 1 / (displayScale > 0 ? displayScale : 1);
  const s = handleSizeDoc(displayScale) * 1.15;
  const gap = 26 * u;
  const cx = b.x + b.width / 2;
  const cy = b.y - gap;
  return { x: cx - s / 2, y: cy - s / 2, width: s, height: s };
}

export function hitRotateHandle(
  obj: EditorObject,
  point: { x: number; y: number },
  displayScale: number,
  docWidth: number,
): boolean {
  if (!isRotatable(obj)) return false;
  const local = toLocalPoint(obj, point, docWidth);
  const r = getRotateHandleRect(obj, displayScale, docWidth);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const radius = r.width / 2 + 3 / (displayScale > 0 ? displayScale : 1);
  const dx = local.x - cx;
  const dy = local.y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

export function hitTest(
  objects: EditorObject[],
  point: { x: number; y: number },
  docWidth: number,
): EditorObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    const b = getObjectBounds(o, docWidth);
    const p = toLocalPoint(o, point, docWidth);
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
      return o;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alignment guides
// ---------------------------------------------------------------------------

export function getGuideLines(imageRect: { x: number; y: number; width: number; height: number }) {
  if (!imageRect.width || !imageRect.height) return { xs: [] as number[], ys: [] as number[] };
  return {
    xs: [imageRect.x, imageRect.x + imageRect.width / 2, imageRect.x + imageRect.width],
    ys: [imageRect.y, imageRect.y + imageRect.height / 2, imageRect.y + imageRect.height],
  };
}

export interface SnapResult {
  x: number;
  y: number;
  v: number[];
  h: number[];
  allV: number[];
  allH: number[];
}

export function computeSnappedPosition(
  obj: EditorObject,
  nx: number,
  ny: number,
  imageRect: { x: number; y: number; width: number; height: number },
  displayScale: number,
  docWidth: number,
): SnapResult {
  const guides = getGuideLines(imageRect);
  if (!guides.xs.length) return { x: nx, y: ny, v: [], h: [], allV: [], allH: [] };

  const oldX = obj.x;
  const oldY = obj.y;
  obj.x = nx;
  obj.y = ny;
  const b = getObjectBounds(obj, docWidth);
  obj.x = oldX;
  obj.y = oldY;

  const threshold = 7 / (displayScale > 0 ? displayScale : 1);
  const vCandidates = [b.x, b.x + b.width / 2, b.x + b.width];
  const hCandidates = [b.y, b.y + b.height / 2, b.y + b.height];

  let bestV: { guide: number; delta: number } | null = null;
  let bestVd = Infinity;
  for (const gx of guides.xs) {
    for (const c of vCandidates) {
      const d = Math.abs(gx - c);
      if (d <= threshold && d < bestVd) {
        bestVd = d;
        bestV = { guide: gx, delta: gx - c };
      }
    }
  }
  let bestH: { guide: number; delta: number } | null = null;
  let bestHd = Infinity;
  for (const gy of guides.ys) {
    for (const c of hCandidates) {
      const d = Math.abs(gy - c);
      if (d <= threshold && d < bestHd) {
        bestHd = d;
        bestH = { guide: gy, delta: gy - c };
      }
    }
  }

  const result: SnapResult = { x: nx, y: ny, v: [], h: [], allV: guides.xs, allH: guides.ys };
  if (bestV) {
    result.x = nx + bestV.delta;
    result.v.push(bestV.guide);
  }
  if (bestH) {
    result.y = ny + bestH.delta;
    result.h.push(bestH.guide);
  }
  return result;
}

export interface GuideState {
  allV: number[];
  allH: number[];
  v: number[];
  h: number[];
}

export function drawGuides(
  ctx: CanvasRenderingContext2D,
  guideState: GuideState | null,
  size: DocSize,
  displayScale: number,
): void {
  if (!guideState) return;
  const u = 1 / (displayScale > 0 ? displayScale : 1);
  ctx.save();
  ctx.strokeStyle = "rgba(108, 140, 255, 0.5)";
  ctx.lineWidth = 1 * u;
  ctx.setLineDash([7 * u, 5 * u]);
  ctx.beginPath();
  for (const x of guideState.allV) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.height);
  }
  for (const y of guideState.allH) {
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#4f74ff";
  ctx.lineWidth = 1.8 * u;
  ctx.beginPath();
  for (const x of guideState.v) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.height);
  }
  for (const y of guideState.h) {
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Object creation
// ---------------------------------------------------------------------------

// The style patch a preset applies to a text object. Position and content are
// intentionally untouched.
export function textPresetPatch(preset: TextPreset): Partial<EditorObject> {
  return {
    fontFamily: preset.fontFamily,
    maxFontSize: preset.maxFontSize,
    fontSize: preset.maxFontSize,
    autoFit: true,
    align: preset.align,
    color: preset.color,
    outlineColor: preset.outlineColor,
    outlineWidth: preset.outlineWidth,
    outlineEnabled: preset.outlineEnabled,
    direction: preset.direction ?? DEFAULT_TEXT_DIRECTION,
  };
}

export function getDefaultPreset(state: EditorState): TextPreset | null {
  if (!state.defaultPresetId) return null;
  return state.textPresets.find((p) => p.id === state.defaultPresetId) ?? null;
}

export function createTextObject(
  x: number,
  y: number,
  preset?: TextPreset | null,
): EditorObject {
  const obj: EditorObject = {
    id: uid(),
    type: "text",
    x,
    y,
    text: "Text",
    fontFamily: DEFAULT_FONT,
    fontSize: 48,
    maxFontSize: 24,
    autoFit: false,
    color: "#ffffff",
    outlineColor: "#000000",
    outlineWidth: 4,
    outlineEnabled: true,
    align: "center",
    direction: DEFAULT_TEXT_DIRECTION,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
  if (preset) Object.assign(obj, textPresetPatch(preset));
  return obj;
}

export function createShapeObject(
  type: "rect" | "ellipse",
  x: number,
  y: number,
  fill: string,
  radius: number,
  mode: ShapeMode = "fill",
  blurRadius = 16,
): EditorObject {
  return {
    id: uid(),
    type,
    x,
    y,
    width: 0,
    height: 0,
    fill,
    radius,
    mode,
    blurRadius,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Append the outline of a shape/stroke to the current path (the caller starts
// the path with beginPath). Used to clip fills and build blur masks.
export function objectPath(ctx: CanvasRenderingContext2D, obj: EditorObject): void {
  switch (obj.type) {
    case "rect": {
      const r = rectRadius(obj);
      if (r > 0 && ctx.roundRect) {
        ctx.roundRect(obj.x, obj.y, obj.width ?? 0, obj.height ?? 0, r);
      } else {
        ctx.rect(obj.x, obj.y, obj.width ?? 0, obj.height ?? 0);
      }
      break;
    }
    case "ellipse":
      ctx.ellipse(
        obj.x + (obj.width ?? 0) / 2,
        obj.y + (obj.height ?? 0) / 2,
        Math.abs((obj.width ?? 0) / 2),
        Math.abs((obj.height ?? 0) / 2),
        0,
        0,
        Math.PI * 2,
      );
      break;
    case "brush": {
      // A stroke outline is built from overlapping circles so the path has area
      // and can be filled/clipped (a thin polyline fill would be empty).
      const rr = Math.max(1, (obj.size ?? 1) / 2);
      const pts = obj.points || [];
      const dot = (x: number, y: number) => {
        ctx.moveTo(x + rr, y);
        ctx.arc(x, y, rr, 0, Math.PI * 2);
      };
      if (pts.length === 1) dot(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(dist / rr));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          dot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        }
      }
      break;
    }
    default:
      break;
  }
}

function renderBrush(ctx: CanvasRenderingContext2D, obj: EditorObject): void {
  const pts = obj.points || [];
  if (!pts.length) return;
  const size = obj.size ?? 1;
  ctx.save();
  ctx.strokeStyle = obj.color ?? "#000000";
  ctx.fillStyle = obj.color ?? "#000000";
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function rectRadius(obj: EditorObject): number {
  return Math.max(
    0,
    Math.min(
      obj.radius == null ? DEFAULT_RECT_RADIUS : obj.radius,
      Math.abs(obj.width ?? 0) / 2,
      Math.abs(obj.height ?? 0) / 2,
    ),
  );
}

function renderText(ctx: CanvasRenderingContext2D, obj: EditorObject, docWidth: number): void {
  const m = getTextMetrics(obj, docWidth);
  const sx = obj.scaleX == null ? 1 : obj.scaleX;
  const sy = obj.scaleY == null ? 1 : obj.scaleY;
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.scale(sx, sy);
  ctx.font = m.fontSize + "px " + fontStack(obj.fontFamily);
  ctx.direction = obj.direction === "ltr" ? "ltr" : "rtl";
  ctx.textAlign = obj.align ?? "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  const startY = -m.height / 2 + m.lineHeight / 2;
  m.lines.forEach((line, i) => {
    const yy = startY + i * m.lineHeight;
    if (obj.outlineEnabled && (obj.outlineWidth ?? 0) > 0) {
      ctx.lineWidth = obj.outlineWidth ?? 0;
      ctx.strokeStyle = obj.outlineColor ?? "#000000";
      ctx.strokeText(line, 0, yy);
    }
    ctx.fillStyle = obj.color ?? "#ffffff";
    ctx.fillText(line, 0, yy);
  });
  ctx.restore();
}

export function renderObject(ctx: CanvasRenderingContext2D, obj: EditorObject, docWidth: number): void {
  const rot = obj.rotation || 0;
  if (rot) {
    const c = getObjectCenter(obj, docWidth);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-c.x, -c.y);
  }
  switch (obj.type) {
    case "text":
      renderText(ctx, obj, docWidth);
      break;
    case "rect": {
      if (obj.mode === "blur") {
        renderBlurFill(ctx, obj, docWidth);
        break;
      }
      const r = rectRadius(obj);
      ctx.fillStyle = obj.fill ?? "#000000";
      if (r > 0 && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(obj.x, obj.y, obj.width ?? 0, obj.height ?? 0, r);
        ctx.fill();
      } else {
        ctx.fillRect(obj.x, obj.y, obj.width ?? 0, obj.height ?? 0);
      }
      break;
    }
    case "ellipse":
      if (obj.mode === "blur") {
        renderBlurFill(ctx, obj, docWidth);
        break;
      }
      ctx.beginPath();
      ctx.fillStyle = obj.fill ?? "#000000";
      ctx.ellipse(
        obj.x + (obj.width ?? 0) / 2,
        obj.y + (obj.height ?? 0) / 2,
        Math.abs((obj.width ?? 0) / 2),
        Math.abs((obj.height ?? 0) / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
    case "image":
      if (obj.source) {
        ctx.save();
        ctx.globalAlpha = obj.opacity == null ? 1 : obj.opacity;
        ctx.drawImage(obj.source, obj.x, obj.y, obj.width ?? 0, obj.height ?? 0);
        ctx.restore();
      }
      break;
    case "brush":
      if (obj.mode === "blur") renderBlurFill(ctx, obj, docWidth);
      else renderBrush(ctx, obj);
      break;
    default:
      break;
  }
  if (rot) ctx.restore();
}

export interface ResizeSnapshot {
  baseWidth: number;
  baseHeight: number;
  fontSize: number;
  maxFontSize: number;
  scaleX: number;
  scaleY: number;
}

export function snapshotResize(obj: EditorObject, docWidth: number): Partial<ResizeSnapshot> {
  if (obj.type === "text") {
    const m = getTextMetrics(obj, docWidth);
    return {
      baseWidth: m.width || 1,
      baseHeight: m.height || 1,
      fontSize: obj.fontSize ?? 48,
      maxFontSize: obj.maxFontSize ?? 24,
      scaleX: obj.scaleX == null ? 1 : obj.scaleX,
      scaleY: obj.scaleY == null ? 1 : obj.scaleY,
    };
  }
  return {};
}

export function computeResize(
  obj: EditorObject,
  handle: string,
  bounds: { x: number; y: number; width: number; height: number },
  original: Partial<ResizeSnapshot>,
  p: { x: number; y: number },
): Partial<EditorObject> {
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  let top = bounds.y;
  let bottom = bounds.y + bounds.height;

  if (handle.indexOf("w") !== -1) left = Math.min(p.x, right - 2);
  if (handle.indexOf("e") !== -1) right = Math.max(p.x, left + 2);
  if (handle.indexOf("n") !== -1) top = Math.min(p.y, bottom - 2);
  if (handle.indexOf("s") !== -1) bottom = Math.max(p.y, top + 2);

  if (handle.length === 2 && bounds.width > 0 && bounds.height > 0) {
    const scale = Math.max((right - left) / bounds.width, (bottom - top) / bounds.height);
    const nw = bounds.width * scale;
    const nh = bounds.height * scale;
    if (handle.indexOf("w") !== -1) left = right - nw;
    else right = left + nw;
    if (handle.indexOf("n") !== -1) top = bottom - nh;
    else bottom = top + nh;
  }

  const nw = right - left;
  const nh = bottom - top;

  if (obj.type === "text") {
    const baseW = original.baseWidth || 1;
    const baseH = original.baseHeight || 1;
    const tY = nh / baseH;
    const patch: Partial<EditorObject> = { scaleY: 1 };
    if (obj.autoFit) {
      const startMax = original.maxFontSize || obj.maxFontSize || obj.fontSize || 24;
      patch.maxFontSize = clamp(round2(startMax * tY), 8, 400);
    } else {
      const startSize = original.fontSize || obj.fontSize || 48;
      patch.fontSize = clamp(round2(startSize * tY), 8, 400);
    }
    patch.scaleX = clamp(nw / (baseW * tY), 0.05, 50);
    if (obj.align === "left") patch.x = left;
    else if (obj.align === "right") patch.x = right;
    else patch.x = left + nw / 2;
    patch.y = top + nh / 2;
    return patch;
  }

  return { x: left, y: top, width: nw, height: nh };
}

export function drawSelection(
  ctx: CanvasRenderingContext2D,
  obj: EditorObject | null,
  displayScale: number,
  docWidth: number,
): void {
  if (!obj) return;
  const b = getObjectBounds(obj, docWidth);
  const u = 1 / (displayScale > 0 ? displayScale : 1);
  const pad = 3 * u;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  ctx.save();
  if (obj.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((obj.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  ctx.strokeStyle = "#4f74ff";
  ctx.lineWidth = 1.5 * u;
  ctx.setLineDash([6 * u, 4 * u]);
  ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  ctx.setLineDash([]);

  if (isResizable(obj)) {
    const handles = getHandleRects(obj, displayScale, docWidth);
    ctx.fillStyle = "#4f74ff";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1 * u;
    for (const h of handles) {
      ctx.fillRect(h.x, h.y, h.width, h.height);
      ctx.strokeRect(h.x, h.y, h.width, h.height);
    }
  }

  if (isRotatable(obj)) {
    const rh = getRotateHandleRect(obj, displayScale, docWidth);
    const rcx = rh.x + rh.width / 2;
    const rcy = rh.y + rh.height / 2;
    ctx.strokeStyle = "#4f74ff";
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.moveTo(cx, b.y);
    ctx.lineTo(rcx, rcy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rcx, rcy, rh.width / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#4f74ff";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1 * u;
    ctx.stroke();
  }
  ctx.restore();
}
