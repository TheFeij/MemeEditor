import { DEFAULT_BLUR_RADIUS } from "./constants";
import { getObjectBounds, objectPath } from "./object";
import type { EditorObject } from "../types";

// Background-blur fill: samples whatever is already drawn beneath an object,
// blurs that region, and paints it back inside the object's silhouette.
//
// The heavy pixel work runs in the Electron main process (`window.meme.blurPng`,
// a port of blur.go); a pure-JS box blur is kept as a synchronous fallback so
// export and non-desktop previews still work. Results are cached per object and
// refreshed only when the content, geometry or radius changes.

interface RegionInfo {
  x0: number;
  y0: number;
  rw: number;
  rh: number;
  rDev: number;
}

interface Entry {
  key?: string;
  bitmap?: HTMLCanvasElement;
  pendingKey?: string;
  failedKey?: string;
  region?: RegionInfo;
  lastRequest?: number;
}

const cache = new Map<string, Entry>();
const REQUEST_THROTTLE_MS = 60;

let contentRev = 0;
let forceSync = false;
let redrawRequest: (() => void) | null = null;

export function bumpContentRev(): void {
  contentRev += 1;
}

export function setBlurSync(value: boolean): void {
  forceSync = value;
}

export function setBlurRedraw(fn: (() => void) | null): void {
  redrawRequest = fn;
}

export function invalidateBlur(): void {
  cache.clear();
}

// Drop cache entries for objects that no longer exist.
export function pruneBlurCache(objects: EditorObject[]): void {
  if (!cache.size) return;
  for (const id of Array.from(cache.keys())) {
    if (!objects.some((o) => o.id === id)) cache.delete(id);
  }
}

// A cheap signature of the visual document content, used to bump `contentRev`
// only on real changes (so cached blurs are reused on selection/zoom redraws).
export function contentSignature(state: {
  background: string;
  padding: { top: number; right: number; bottom: number; left: number };
  baseImage: { width: number; height: number };
  objects: EditorObject[];
}): string {
  const pad = state.padding;
  const objs = state.objects
    .map((o) =>
      [
        o.id,
        o.type,
        o.x,
        o.y,
        o.width,
        o.height,
        o.rotation,
        o.fill,
        o.mode,
        o.color,
        o.size,
        o.opacity,
        o.radius,
        o.points ? o.points.length : 0,
        o.tStart,
        o.tEnd,
      ].join(","),
    )
    .join(";");
  return `${state.background}|${pad.top},${pad.right},${pad.bottom},${pad.left}|${state.baseImage.width}x${state.baseImage.height}|${objs}`;
}

function deviceScaleOf(ctx: CanvasRenderingContext2D): number {
  const t = ctx.getTransform();
  return Math.hypot(t.a, t.b) || 1;
}

// Compute the device-space region a blur object must sample plus the
// device-space blur radius. Must run while the object transform is active.
function blurRegionInfo(
  ctx: CanvasRenderingContext2D,
  obj: EditorObject,
  docWidth: number,
): RegionInfo | null {
  const radius = Math.max(1, obj.blurRadius || DEFAULT_BLUR_RADIUS);
  const scale = deviceScaleOf(ctx);
  const canvas = ctx.canvas;
  const t = ctx.getTransform();
  const b = getObjectBounds(obj, docWidth);
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ].map((p) => ({
    x: t.a * p.x + t.c * p.y + t.e,
    y: t.b * p.x + t.d * p.y + t.f,
  }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const rDev = Math.max(1, Math.round(radius * scale));
  const pad = rDev * 2 + 4;
  const x0 = Math.max(0, Math.min(canvas.width, Math.floor(minX - pad)));
  const y0 = Math.max(0, Math.min(canvas.height, Math.floor(minY - pad)));
  const x1 = Math.max(0, Math.min(canvas.width, Math.ceil(maxX + pad)));
  const y1 = Math.max(0, Math.min(canvas.height, Math.ceil(maxY + pad)));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 1 || rh < 1) return null;
  return { x0, y0, rw, rh, rDev };
}

function drawBlurBitmap(
  ctx: CanvasRenderingContext2D,
  obj: EditorObject,
  bitmap: CanvasImageSource,
  info: RegionInfo,
): void {
  ctx.save();
  ctx.beginPath();
  objectPath(ctx, obj);
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bitmap, info.x0, info.y0);
  ctx.restore();
}

// One separable box-blur pass over an ImageData buffer.
function boxBlurPass(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
): void {
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const innerStride = horizontal ? 4 : w * 4;
  const outerStride = horizontal ? w * 4 : 4;
  const win = 2 * r + 1;
  const tmp = new Float32Array(inner * 4);
  for (let o = 0; o < outer; o++) {
    const base = o * outerStride;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = -r; i <= r; i++) {
      const ii = i < 0 ? 0 : i >= inner ? inner - 1 : i;
      const idx = base + ii * innerStride;
      sr += data[idx];
      sg += data[idx + 1];
      sb += data[idx + 2];
      sa += data[idx + 3];
    }
    for (let x = 0; x < inner; x++) {
      const oi = x * 4;
      tmp[oi] = sr / win;
      tmp[oi + 1] = sg / win;
      tmp[oi + 2] = sb / win;
      tmp[oi + 3] = sa / win;
      const addI = x + r + 1;
      const subI = x - r;
      const ai = base + (addI >= inner ? inner - 1 : addI) * innerStride;
      const si = base + (subI < 0 ? 0 : subI) * innerStride;
      sr += data[ai] - data[si];
      sg += data[ai + 1] - data[si + 1];
      sb += data[ai + 2] - data[si + 2];
      sa += data[ai + 3] - data[si + 3];
    }
    for (let x = 0; x < inner; x++) {
      const idx = base + x * innerStride;
      const oi = x * 4;
      data[idx] = tmp[oi];
      data[idx + 1] = tmp[oi + 1];
      data[idx + 2] = tmp[oi + 2];
      data[idx + 3] = tmp[oi + 3];
    }
  }
}

function jsBlurFill(
  ctx: CanvasRenderingContext2D,
  obj: EditorObject,
  info: RegionInfo,
): void {
  let img: ImageData;
  try {
    img = ctx.getImageData(info.x0, info.y0, info.rw, info.rh);
  } catch {
    return;
  }
  const passR = Math.max(1, Math.round(info.rDev / 3));
  for (let i = 0; i < 3; i++) {
    boxBlurPass(img.data, info.rw, info.rh, passR, true);
    boxBlurPass(img.data, info.rw, info.rh, passR, false);
  }
  const scratch = document.createElement("canvas");
  scratch.width = info.rw;
  scratch.height = info.rh;
  scratch.getContext("2d")?.putImageData(img, 0, 0);
  drawBlurBitmap(ctx, obj, scratch, info);
}

function sameRegion(a: RegionInfo | undefined, b: RegionInfo): boolean {
  return (
    !!a &&
    a.x0 === b.x0 &&
    a.y0 === b.y0 &&
    a.rw === b.rw &&
    a.rh === b.rh &&
    a.rDev === b.rDev
  );
}

function requestBlurBitmap(
  ctx: CanvasRenderingContext2D,
  obj: EditorObject,
  key: string,
  info: RegionInfo,
): void {
  const entry = cache.get(obj.id) || {};
  entry.pendingKey = key;
  entry.region = info;
  entry.lastRequest = Date.now();
  cache.set(obj.id, entry);

  const off = document.createElement("canvas");
  off.width = info.rw;
  off.height = info.rh;
  off.getContext("2d")?.drawImage(
    ctx.canvas,
    info.x0,
    info.y0,
    info.rw,
    info.rh,
    0,
    0,
    info.rw,
    info.rh,
  );
  const dataURL = off.toDataURL("image/jpeg", 0.9);

  window.meme
    .blurPng(dataURL, info.rDev)
    .then((result) => {
      const img = new Image();
      img.onload = () => {
        const current = cache.get(obj.id);
        if (!current || current.pendingKey !== key) return;
        const bitmap = document.createElement("canvas");
        bitmap.width = info.rw;
        bitmap.height = info.rh;
        bitmap.getContext("2d")?.drawImage(img, 0, 0);
        cache.set(obj.id, {
          key,
          bitmap,
          pendingKey: key,
          region: info,
          lastRequest: current.lastRequest,
        });
        redrawRequest?.();
      };
      img.onerror = () => {
        const current = cache.get(obj.id);
        if (!current || current.pendingKey !== key) return;
        cache.set(obj.id, { pendingKey: key, failedKey: key, region: info });
      };
      img.src = result;
    })
    .catch(() => {
      const e = cache.get(obj.id) || {};
      e.pendingKey = key;
      e.failedKey = key;
      cache.set(obj.id, e);
    });
}

export function renderBlurFill(
  ctx: CanvasRenderingContext2D,
  obj: EditorObject,
  docWidth: number,
): void {
  const info = blurRegionInfo(ctx, obj, docWidth);
  if (!info) return;

  const backend = typeof window !== "undefined" && window.meme && window.meme.blurPng;
  if (forceSync || !backend) {
    jsBlurFill(ctx, obj, info);
    return;
  }

  const key = `${contentRev}|${info.x0},${info.y0},${info.rw},${info.rh}|${info.rDev}`;
  const entry = cache.get(obj.id);
  if (entry && entry.key === key && entry.bitmap) {
    drawBlurBitmap(ctx, obj, entry.bitmap, info);
    return;
  }
  if (entry && entry.failedKey === key) {
    jsBlurFill(ctx, obj, info);
    return;
  }
  if (entry && entry.bitmap && sameRegion(entry.region, info)) {
    drawBlurBitmap(ctx, obj, entry.bitmap, info);
  }
  const lastRequest = entry ? entry.lastRequest || 0 : 0;
  if ((!entry || entry.pendingKey !== key) && Date.now() - lastRequest >= REQUEST_THROTTLE_MS) {
    requestBlurBitmap(ctx, obj, key, info);
  }
}
