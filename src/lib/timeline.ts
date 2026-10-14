import type { EditorObject } from "../types";

// Magnetic timeline snapping: clip edges pull toward the timeline bounds and
// every other clip's edges, mirroring the canvas alignment guides.
export const TIMELINE_SNAP_PX = 8;

export interface EdgeSnap {
  value: number;
  guide: number | null;
}

export function timelineSnapTargets(
  duration: number,
  objects: EditorObject[],
  excludeId: string,
): number[] {
  const targets: number[] = [0, duration];
  for (const o of objects) {
    if (o.id === excludeId) continue;
    if (o.tStart != null) targets.push(o.tStart);
    if (o.tEnd != null) targets.push(o.tEnd);
  }
  return targets;
}

// Snap a single edge value to the nearest target within `threshold`.
export function snapValue(value: number, targets: number[], threshold: number): EdgeSnap {
  let best = Infinity;
  let guide: number | null = null;
  for (const g of targets) {
    const d = g - value;
    if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) {
      best = d;
      guide = g;
    }
  }
  return { value: value + (Number.isFinite(best) ? best : 0), guide };
}

// Snap a clip being moved (its length is preserved) — whichever edge (start or
// end) is closest to a target wins.
export function snapMove(
  rawStart: number,
  length: number,
  targets: number[],
  threshold: number,
): EdgeSnap {
  const startSnap = snapValue(rawStart, targets, threshold);
  const endSnap = snapValue(rawStart + length, targets, threshold);
  const startDist = startSnap.guide != null ? Math.abs(startSnap.value - rawStart) : Infinity;
  const endDist = endSnap.guide != null ? Math.abs(endSnap.value - (rawStart + length)) : Infinity;
  if (startSnap.guide != null && startDist <= endDist) return startSnap;
  if (endSnap.guide != null) return { value: endSnap.value - length, guide: endSnap.guide };
  return { value: rawStart, guide: null };
}
