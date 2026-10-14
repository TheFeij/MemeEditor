import {
  DEFAULT_CANVAS,
  MAX_RENDER_SCALE,
  RENDER_TARGET,
} from "./constants";
import type { BaseImage, Padding } from "../types";

export interface DocSize {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function computeDocumentSize(baseImage: BaseImage, padding: Padding): DocSize {
  const { width: iw, height: ih } = baseImage;
  if (!iw || !ih) {
    return { width: DEFAULT_CANVAS.width, height: DEFAULT_CANVAS.height, left: 0, top: 0 };
  }
  const left = Math.round((iw * padding.left) / 100);
  const right = Math.round((iw * padding.right) / 100);
  const top = Math.round((ih * padding.top) / 100);
  const bottom = Math.round((ih * padding.bottom) / 100);
  return {
    width: Math.max(1, iw + left + right),
    height: Math.max(1, ih + top + bottom),
    left,
    top,
  };
}

export function getRenderScale(size: DocSize): number {
  const longSide = Math.max(size.width, size.height);
  if (longSide <= 0) return 1;
  if (longSide >= RENDER_TARGET) return 1;
  return Math.min(MAX_RENDER_SCALE, Math.ceil(RENDER_TARGET / longSide));
}

export function computeFitScale(
  stageWidth: number,
  stageHeight: number,
  width: number,
  height: number,
): number {
  const availW = stageWidth - 48;
  const availH = stageHeight - 48;
  if (availW <= 0 || availH <= 0) return 1;
  return Math.min(availW / width, availH / height, 1);
}
