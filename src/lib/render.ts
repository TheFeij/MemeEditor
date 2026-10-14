import { computeDocumentSize, getRenderScale, type DocSize } from "./document";
import { drawGuides, drawSelection, renderObject, type GuideState } from "./object";
import { setBlurSync } from "./blur";
import { isObjectActiveAt } from "./video";
import type { EditorObject, EditorState } from "../types";

export function getSelectedObject(state: EditorState): EditorObject | null {
  if (!state.selectedObjectId) return null;
  return state.objects.find((o) => o.id === state.selectedObjectId) ?? null;
}

// Draw the document (background + base image + objects) onto a 2D context.
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  size: DocSize,
  playhead = 0,
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = state.background;
  ctx.fillRect(0, 0, size.width, size.height);

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
