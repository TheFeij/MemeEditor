import { computeDocumentSize, getRenderScale, type DocSize } from "./document";
import { drawGuides, drawSelection, renderObject, type GuideState } from "./object";
import { setBlurSync } from "./blur";
import { isObjectActiveAt } from "./video";
import type { BackgroundStyle, EditorObject, EditorState } from "../types";

export function getSelectedObject(state: EditorState): EditorObject | null {
  if (!state.selectedObjectId) return null;
  return state.objects.find((o) => o.id === state.selectedObjectId) ?? null;
}

// Draw the flat background colour, then the optional geometric line pattern on
// top of it. Objects and the base image are drawn afterwards, so the pattern is
// only visible in the padding (or on an empty canvas).
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  background: string,
  style: BackgroundStyle,
  width: number,
  height: number,
): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  if (style.mode !== "lines") return;
  drawBackgroundLines(ctx, style, width, height);
}

// A family of parallel lines across the document. `spacing` is the
// perpendicular distance between neighbouring lines, and the family is centred
// on the document so the result stays balanced at any size.
function drawLineFamily(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  angle: number,
  spacing: number,
): void {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const normX = -dirY;
  const normY = dirX;
  const diagonal = Math.hypot(width, height);
  const reach =
    (Math.abs(normX) * width + Math.abs(normY) * height) / 2 + spacing * 2;
  const count = Math.ceil(reach / spacing);
  for (let i = -count; i <= count; i++) {
    const offset = i * spacing;
    const cx = width / 2 + normX * offset;
    const cy = height / 2 + normY * offset;
    ctx.moveTo(cx - dirX * diagonal, cy - dirY * diagonal);
    ctx.lineTo(cx + dirX * diagonal, cy + dirY * diagonal);
  }
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  drawLineFamily(ctx, width, height, 0, spacing);
  drawLineFamily(ctx, width, height, Math.PI / 2, spacing);
}

function drawDiagonalLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  drawLineFamily(ctx, width, height, Math.PI / 4, spacing);
}

function drawCrosshatchLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  drawLineFamily(ctx, width, height, Math.PI / 4, spacing);
  drawLineFamily(ctx, width, height, -Math.PI / 4, spacing);
}

// Three equal-spaced line families at 60° to one another form a triangular
// lattice. Using shared edges keeps every line at a single opacity.
function drawTriangleLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  const altitude = spacing * 0.9;
  drawLineFamily(ctx, width, height, 0, altitude);
  drawLineFamily(ctx, width, height, Math.PI / 3, altitude);
  drawLineFamily(ctx, width, height, -Math.PI / 3, altitude);
}

// Pointy-top hexagons. Each hexagon contributes only its right side and its
// lower "V"; the missing sides are supplied by neighbouring cells, so shared
// edges are never stroked twice (which would make them brighter).
function drawHexagonLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
  isometric: boolean,
): void {
  const radius = Math.max(3, spacing * 0.55);
  const cellWidth = Math.sqrt(3) * radius;
  const rowStep = 1.5 * radius;
  const rows = Math.ceil(height / rowStep) + 4;
  const cols = Math.ceil(width / cellWidth) + 4;
  const spokeAngles = [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6];

  for (let row = -2; row <= rows; row++) {
    const cy = row * rowStep;
    const rowOffset = (row & 1) * (cellWidth / 2);
    for (let col = -2; col <= cols; col++) {
      const cx = col * cellWidth + rowOffset;

      // Right-hand vertical edge.
      ctx.moveTo(cx + cellWidth / 2, cy - radius / 2);
      ctx.lineTo(cx + cellWidth / 2, cy + radius / 2);

      // Lower V.
      ctx.moveTo(cx - cellWidth / 2, cy + radius / 2);
      ctx.lineTo(cx, cy + radius);
      ctx.lineTo(cx + cellWidth / 2, cy + radius / 2);

      if (isometric) {
        // Three spokes split the hexagon into rhombi, giving the classic
        // isometric-cube illusion.
        for (const angle of spokeAngles) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        }
      }
    }
  }
}

// Rows of compound sine waves. Amplitude is kept below half the row gap so
// neighbouring waves never overlap.
function drawWaveLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  const gap = Math.max(10, spacing * 1.2);
  const amplitude = spacing * 0.28;
  const period = spacing * 2.4;
  const step = Math.max(1.5, spacing / 14);
  let row = 0;
  for (let base = -gap; base <= height + gap; base += gap, row++) {
    const phase = row * 0.7;
    let first = true;
    for (let x = -step; x <= width + step; x += step) {
      const t = (x / period) * Math.PI * 2 + phase;
      const y =
        base + amplitude * Math.sin(t) + amplitude * 0.32 * Math.sin(t * 2 + 0.8);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
  }
}

// A fish-scale / scallop texture. Semicircles in each row start exactly at the
// low point of the row above, producing a continuous pattern without crossings.
function drawScaleLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  const radius = Math.max(4, spacing * 0.5);
  const rowStep = radius;
  const colStep = radius * 2;
  const rows = Math.ceil(height / rowStep) + 3;
  const cols = Math.ceil(width / colStep) + 3;

  for (let row = -1; row <= rows; row++) {
    const cy = row * rowStep;
    const rowOffset = (row & 1) * radius;
    for (let col = -1; col <= cols; col++) {
      const cx = col * colStep + rowOffset;
      ctx.moveTo(cx + radius, cy);
      ctx.arc(cx, cy, radius, 0, Math.PI);
    }
  }
}

// Hexagonally packed concentric rings.
function drawRingLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  const step = Math.max(8, spacing);
  const radius = step * 0.42;
  const rowStep = step * 0.866;
  const rows = Math.ceil(height / rowStep) + 3;
  const cols = Math.ceil(width / step) + 3;

  for (let row = -1; row <= rows; row++) {
    const cy = row * rowStep;
    const rowOffset = (row & 1) * (step / 2);
    for (let col = -1; col <= cols; col++) {
      const cx = col * step + rowOffset;
      ctx.moveTo(cx + radius, cy);
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      const inner = radius * 0.55;
      if (inner > 1.5) {
        ctx.moveTo(cx + inner, cy);
        ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      }
    }
  }
}

// Deterministic hash for Truchet tile orientation. The same cell always gets
// the same tile, so the pattern does not shimmer while the canvas redraws.
function truchetHash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Truchet tiles: each square gets two quarter-circle arcs in one of two
// orientations. The result is a maze-like texture of flowing lines.
function drawTruchetLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
): void {
  const size = Math.max(8, spacing);
  const radius = size / 2;
  const rows = Math.ceil(height / size) + 3;
  const cols = Math.ceil(width / size) + 3;

  for (let row = -1; row <= rows; row++) {
    for (let col = -1; col <= cols; col++) {
      const x = col * size;
      const y = row * size;
      if (truchetHash(col, row) < 0.5) {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI / 2);
        ctx.moveTo(x + radius, y + size);
        ctx.arc(x + size, y + size, radius, Math.PI, Math.PI * 1.5);
      } else {
        ctx.moveTo(x + size, y + radius);
        ctx.arc(x + size, y, radius, Math.PI / 2, Math.PI);
        ctx.moveTo(x, y + size - radius);
        ctx.arc(x, y + size, radius, Math.PI * 1.5, Math.PI * 2);
      }
    }
  }
}

export function drawBackgroundLines(
  ctx: CanvasRenderingContext2D,
  style: BackgroundStyle,
  width: number,
  height: number,
): void {
  const opacity = Math.max(0, Math.min(1, style.lineOpacity));
  if (opacity <= 0 || width <= 0 || height <= 0) return;
  const spacing = Math.max(2, style.spacing || 2);
  const lineWidth = Math.max(0.1, style.lineWidth || 1);

  ctx.save();
  ctx.strokeStyle = style.lineColor || "#ffffff";
  ctx.globalAlpha = opacity;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  switch (style.pattern) {
    case "grid":
      drawGridLines(ctx, width, height, spacing);
      break;
    case "crosshatch":
      drawCrosshatchLines(ctx, width, height, spacing);
      break;
    case "triangles":
      drawTriangleLines(ctx, width, height, spacing);
      break;
    case "hexagons":
      drawHexagonLines(ctx, width, height, spacing, false);
      break;
    case "isometric":
      drawHexagonLines(ctx, width, height, spacing, true);
      break;
    case "waves":
      drawWaveLines(ctx, width, height, spacing);
      break;
    case "scales":
      drawScaleLines(ctx, width, height, spacing);
      break;
    case "rings":
      drawRingLines(ctx, width, height, spacing);
      break;
    case "truchet":
      drawTruchetLines(ctx, width, height, spacing);
      break;
    case "diagonal":
    default:
      drawDiagonalLines(ctx, width, height, spacing);
      break;
  }

  ctx.stroke();
  ctx.restore();
}

// The pattern alone as a transparent PNG. Video export pads with the flat
// background colour in ffmpeg, so only the lines need to be overlaid; the base
// image area is cleared because the document draws the video on top of the
// pattern during preview.
export function renderBackgroundPatternPng(state: EditorState): string | null {
  const style = state.backgroundStyle;
  if (!style || style.mode !== "lines" || style.lineOpacity <= 0) return null;
  const size = computeDocumentSize(state.baseImage, state.padding);
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(size.width));
  off.height = Math.max(1, Math.round(size.height));
  const ctx = off.getContext("2d");
  if (!ctx) return null;
  drawBackgroundLines(ctx, style, off.width, off.height);
  if (state.baseImage.width > 0 && state.baseImage.height > 0) {
    ctx.clearRect(size.left, size.top, state.baseImage.width, state.baseImage.height);
  }
  return off.toDataURL("image/png");
}

// Draw the document (background + base image + objects) onto a 2D context.
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  size: DocSize,
  playhead = 0,
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  drawBackground(ctx, state.background, state.backgroundStyle, size.width, size.height);

  const img = state.baseImage;
  if (img.source && img.width && img.height) {
    try {
      const crop = state.mediaType === "video" ? state.videoCrop : null;
      if (crop) {
        // Non-destructive video crop: sample only the selected region of the
        // original frame and stretch it into the (cropped) document box.
        ctx.drawImage(
          img.source,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          size.left,
          size.top,
          img.width,
          img.height,
        );
      } else {
        ctx.drawImage(img.source, size.left, size.top, img.width, img.height);
      }
    } catch {
      /* the base source may not be ready yet */
    }
  }

  for (const obj of state.objects) {
    if (
      state.mediaType === "video" &&
      !state.showHiddenObjects &&
      !isObjectActiveAt(obj, playhead, state.mediaType)
    ) {
      continue;
    }
    renderObject(ctx, obj, size.width);
  }
}

export interface SceneOptions {
  size: DocSize;
  displayScale: number;
  selected: EditorObject | null;
  guideState: GuideState | null;
  playhead?: number;
}

// Full interactive scene: document plus editor-only overlays (guides and the
// selection box/handles).
export function renderScene(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  opts: SceneOptions,
): void {
  const playhead = opts.playhead ?? 0;
  renderDocument(ctx, state, opts.size, playhead);
  drawGuides(ctx, opts.guideState, opts.size, opts.displayScale);
  // Do not draw handles for an object that is hidden at the playhead, otherwise
  // a timed object would look like it is present outside its time window.
  let selected = opts.selected;
  if (
    selected &&
    state.mediaType === "video" &&
    !state.showHiddenObjects &&
    !isObjectActiveAt(selected, playhead, state.mediaType)
  ) {
    selected = null;
  }
  drawSelection(ctx, selected, opts.displayScale, opts.size.width);
}

// Render the full-resolution document to a PNG data URL for export/ffmpeg.
export function renderToPNG(state: EditorState): string {
  const size = computeDocumentSize(state.baseImage, state.padding);
  const scale = getRenderScale(size);
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(size.width * scale));
  off.height = Math.max(1, Math.round(size.height * scale));
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("Could not create export canvas");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  setBlurSync(true);
  try {
    renderDocument(ctx, state, size);
  } finally {
    setBlurSync(false);
  }
  return off.toDataURL("image/png");
}
