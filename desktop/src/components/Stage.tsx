import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor } from "../state/EditorContext";
import { computeDocumentSize, computeFitScale, getRenderScale } from "../lib/document";
import { getSelectedObject, renderScene } from "../lib/render";
import {
  computeResize,
  computeSnappedPosition,
  createShapeObject,
  createTextObject,
  getDefaultPreset,
  getEffectiveFontSize,
  getObjectBounds,
  getObjectCenter,
  hitHandle,
  hitRotateHandle,
  hitTest,
  normalizeAngle,
  rotatePoint,
  snapshotResize,
  type GuideState,
  type ResizeSnapshot,
} from "../lib/object";
import { CURSORS, DEFAULT_RECT_RADIUS } from "../lib/constants";
import { bumpContentRev, contentSignature, pruneBlurCache, setBlurRedraw } from "../lib/blur";
import { defaultTimingPatch, isObjectActiveAt, isVideoFile } from "../lib/video";
import type { EditorObject, EditorState } from "../types";

const HANDLE_CURSORS: Record<string, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

type Interaction =
  | { kind: "create"; id: string; start: { x: number; y: number } }
  | { kind: "drag"; id: string; dx: number; dy: number; moved: boolean }
  | {
      kind: "resize";
      id: string;
      handle: string;
      bounds: { x: number; y: number; width: number; height: number };
      original: Partial<ResizeSnapshot>;
    }
  | {
      kind: "rotate";
      id: string;
      center: { x: number; y: number };
      startAngle: number;
      startRotation: number;
    }
  | { kind: "brush"; id: string }
  | { kind: "crop"; start: { x: number; y: number } }
  | { kind: "imageCrop"; start: { x: number; y: number } };

function rectBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

// Editor-only crop overlay: dims everything outside the crop rectangle and
// draws a rule-of-thirds grid inside it.
function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  st: EditorState,
  size: { width: number; height: number },
  displayScale: number,
): void {
  if (!st.cropActive || !st.baseImage.source) return;
  const u = 1 / (displayScale > 0 ? displayScale : 1);
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  const c = st.cropRect;
  if (!c) {
    ctx.fillRect(0, 0, size.width, size.height);
  } else {
    ctx.fillRect(0, 0, size.width, c.y);
    ctx.fillRect(0, c.y, c.x, c.height);
    ctx.fillRect(c.x + c.width, c.y, size.width - (c.x + c.width), c.height);
    ctx.fillRect(0, c.y + c.height, size.width, size.height - (c.y + c.height));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      const gx = c.x + (c.width * i) / 3;
      ctx.moveTo(gx, c.y);
      ctx.lineTo(gx, c.y + c.height);
      const gy = c.y + (c.height * i) / 3;
      ctx.moveTo(c.x, gy);
      ctx.lineTo(c.x + c.width, gy);
    }
    ctx.stroke();
    ctx.strokeStyle = "#4f74ff";
    ctx.lineWidth = 1.5 * u;
    ctx.strokeRect(c.x, c.y, c.width, c.height);
  }
  ctx.restore();
}

// Editor-only overlay for cropping an image layer, drawn in the object's
// local (unrotated) frame so it lines up with rotated images.
function drawImageCropOverlay(
  ctx: CanvasRenderingContext2D,
  st: EditorState,
  displayScale: number,
): void {
  const ic = st.imageCrop;
  if (!ic) return;
  const target = st.objects.find((o) => o.id === ic.objectId);
  if (!target) return;
  const docWidth = computeDocumentSize(st.baseImage, st.padding).width;
  const b = getObjectBounds(target, docWidth);
  const u = 1 / (displayScale > 0 ? displayScale : 1);
  ctx.save();
  if (target.rotation) {
    const c = getObjectCenter(target, docWidth);
    ctx.translate(c.x, c.y);
    ctx.rotate((target.rotation * Math.PI) / 180);
    ctx.translate(-c.x, -c.y);
  }
  const r = ic.rect;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.width, b.height);
  if (r && r.width > 0 && r.height > 0) {
    ctx.rect(r.x, r.y, r.width, r.height);
    ctx.fill("evenodd");
  } else {
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1 * u;
  ctx.setLineDash([5 * u, 4 * u]);
  ctx.strokeRect(b.x, b.y, b.width, b.height);
  ctx.setLineDash([]);
  if (r && r.width >= 1 && r.height >= 1) {
    ctx.strokeStyle = "#4f74ff";
    ctx.lineWidth = 1.5 * u;
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  }
  ctx.restore();
}

export function Stage() {
  const {
    state,
    dispatch,
    commit,
    fontsRevision,
    openImageDialog,
    openImageFile,
    addImageLayerFile,
    openVideoFile,
    subscribeVideo,
    getPlayhead,
    exporting,
    exportProgress,
    eyedropperActive,
    applyEyedropper,
    stopEyedropper,
    placeLogo,
    changeLogo,
  } = useEditor();
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const guideStateRef = useRef<GuideState | null>(null);
  const displayScaleRef = useRef(1);
  const stateRef = useRef(state);
  stateRef.current = state;
  const contentSigRef = useRef("");
  const [dragOver, setDragOver] = useState(false);

  const currentObject = useCallback((id: string): EditorObject | undefined => {
    return stateRef.current.objects.find((o) => o.id === id);
  }, []);

  const visibleObjects = useCallback((st: typeof state): EditorObject[] => {
    if (st.mediaType !== "video" || st.showHiddenObjects) return st.objects;
    const t = getPlayhead();
    return st.objects.filter((o) => isObjectActiveAt(o, t, st.mediaType));
  }, [getPlayhead]);

  const timingPatch = useCallback(
    (st: typeof state): Partial<EditorObject> =>
      defaultTimingPatch(st.mediaType, getPlayhead(), st.video.duration) ?? {},
    [getPlayhead],
  );

  const render = useCallback(() => {
    const st = stateRef.current;
    const canvas = canvasRef.current;
    const stageEl = stageRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !stageEl || !ctx) return;

    const size = computeDocumentSize(st.baseImage, st.padding);
    const fit = computeFitScale(stageEl.clientWidth, stageEl.clientHeight, size.width, size.height);
    const displayScale = fit * st.zoom;
    displayScaleRef.current = displayScale;
    const renderScale = getRenderScale(size);

    const w = Math.max(1, Math.round(size.width * renderScale));
    const h = Math.max(1, Math.round(size.height * renderScale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = Math.max(1, Math.round(size.width * displayScale)) + "px";
    canvas.style.height = Math.max(1, Math.round(size.height * displayScale)) + "px";

    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    pruneBlurCache(st.objects);
    const sig = contentSignature(st);
    if (sig !== contentSigRef.current) {
      contentSigRef.current = sig;
      bumpContentRev();
    }
    renderScene(ctx, st, {
      size,
      displayScale,
      selected: getSelectedObject(st),
      guideState: guideStateRef.current,
      playhead: getPlayhead(),
    });
    drawCropOverlay(ctx, st, size, displayScale);
    drawImageCropOverlay(ctx, st, displayScale);
  }, [getPlayhead]);

  useLayoutEffect(() => {
    render();
  }, [render, state, fontsRevision]);

  useEffect(() => {
    setBlurRedraw(render);
    return () => setBlurRedraw(null);
  }, [render]);

  useEffect(
    () =>
      subscribeVideo(() => {
        bumpContentRev();
        render();
      }),
    [subscribeVideo, render],
  );

  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const observer = new ResizeObserver(() => render());
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    const isCrop = state.activeTool === "crop" && !!state.baseImage.source;
    if (isCrop && !state.cropActive) dispatch({ type: "setCropActive", active: true });
    else if (!isCrop && state.cropActive) dispatch({ type: "setCropActive", active: false });
  }, [state.activeTool, state.mediaType, state.baseImage.source, state.cropActive, dispatch]);

  const getDocPoint = (event: React.PointerEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const size = computeDocumentSize(stateRef.current.baseImage, stateRef.current.padding);
    const scaleX = size.width / rect.width;
    const scaleY = size.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const updateHoverCursor = (event: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = stateRef.current;
    if (eyedropperActive) {
      canvas.style.cursor = "crosshair";
      return;
    }
    if (st.activeTool !== "select") {
      canvas.style.cursor = CURSORS[st.activeTool] || "default";
      return;
    }
    const p = getDocPoint(event);
    const size = computeDocumentSize(st.baseImage, st.padding);
    const selected = getSelectedObject(st);
    if (selected) {
      if (hitRotateHandle(selected, p, displayScaleRef.current, size.width)) {
        canvas.style.cursor = "grab";
        return;
      }
      const handle = hitHandle(selected, p, displayScaleRef.current, size.width);
      if (handle) {
        canvas.style.cursor = HANDLE_CURSORS[handle] || "default";
        return;
      }
    }
    canvas.style.cursor = hitTest(visibleObjects(st), p, size.width) ? "move" : "default";
  };

  const sampleColorAt = (p: { x: number; y: number }): string | null => {
    const canvas = canvasRef.current;
    const st = stateRef.current;
    if (!canvas) return null;
    const size = computeDocumentSize(st.baseImage, st.padding);
    const renderScale = getRenderScale(size);
    const pw = Math.max(1, Math.round(size.width * renderScale));
    const ph = Math.max(1, Math.round(size.height * renderScale));
    const px = Math.max(0, Math.min(pw - 1, Math.floor(p.x * renderScale)));
    const py = Math.max(0, Math.min(ph - 1, Math.floor(p.y * renderScale)));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      const d = ctx.getImageData(px, py, 1, 1).data;
      return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    } catch {
      return null;
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const st = stateRef.current;
    if (!st.started) return;
    const canvas = canvasRef.current;
    const size = computeDocumentSize(st.baseImage, st.padding);
    const p = getDocPoint(event);
    const tool = st.activeTool;
    guideStateRef.current = null;

    if (eyedropperActive) {
      const hex = sampleColorAt(p);
      if (hex) applyEyedropper(hex);
      else stopEyedropper();
      return;
    }

    if (st.imageCrop) {
      dispatch({ type: "setImageCrop", value: { objectId: st.imageCrop.objectId, rect: null } });
      interactionRef.current = { kind: "imageCrop", start: p };
      try {
        canvas?.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    if (st.cropActive) {
      dispatch({ type: "setCropRect", rect: null });
      interactionRef.current = { kind: "crop", start: p };
      try {
        canvas?.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      canvas?.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }

    if (tool === "brush") {
      const stroke: EditorObject = {
        id: `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
        type: "brush",
        x: p.x,
        y: p.y,
        points: [{ x: p.x, y: p.y }],
        color: st.brush.color,
        size: st.brush.size,
        mode: st.brush.mode,
        blurRadius: st.brush.blurRadius,
        ...timingPatch(st),
      };
      dispatch({ type: "addObject", object: stroke });
      interactionRef.current = { kind: "brush", id: stroke.id };
      return;
    }

    if (tool === "text") {
      const obj = { ...createTextObject(p.x, p.y, getDefaultPreset(st)), ...timingPatch(st) };
      dispatch({ type: "addObject", object: obj });
      dispatch({ type: "setActiveTool", tool: "select" });
      dispatch({ type: "commit" });
      return;
    }

    if (tool === "rect" || tool === "ellipse") {
      const obj = {
        ...createShapeObject(
          tool,
          p.x,
          p.y,
          st.currentShapeFill,
          DEFAULT_RECT_RADIUS,
          st.currentShapeMode,
          st.currentShapeBlur,
        ),
        ...timingPatch(st),
      };
      dispatch({ type: "addObject", object: obj });
      interactionRef.current = { kind: "create", id: obj.id, start: p };
      return;
    }

    // Select tool.
    const selected = getSelectedObject(st);
    if (selected) {
      if (hitRotateHandle(selected, p, displayScaleRef.current, size.width)) {
        const c = getObjectCenter(selected, size.width);
        interactionRef.current = {
          kind: "rotate",
          id: selected.id,
          center: c,
          startAngle: (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI,
          startRotation: selected.rotation || 0,
        };
        return;
      }
      const handle = hitHandle(selected, p, displayScaleRef.current, size.width);
      if (handle) {
        if (selected.type === "text" && selected.autoFit) {
          dispatch({
            type: "updateObject",
            id: selected.id,
            patch: {
              fontSize: getEffectiveFontSize(selected, size.width),
              autoFit: false,
              scaleY: 1,
            },
          });
        }
        interactionRef.current = {
          kind: "resize",
          id: selected.id,
          handle,
          bounds: getObjectBounds(selected, size.width),
          original: snapshotResize(selected, size.width),
        };
        return;
      }
    }

    const hit = hitTest(visibleObjects(st), p, size.width);
    if (hit) {
      dispatch({ type: "selectObject", id: hit.id });
      interactionRef.current = {
        kind: "drag",
        id: hit.id,
        dx: p.x - hit.x,
        dy: p.y - hit.y,
        moved: false,
      };
    } else {
      dispatch({ type: "selectObject", id: null });
      interactionRef.current = null;
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const inter = interactionRef.current;
    if (!inter) {
      updateHoverCursor(event);
      return;
    }
    const st = stateRef.current;
    const size = computeDocumentSize(st.baseImage, st.padding);
    const p = getDocPoint(event);

    if (inter.kind === "crop") {
      dispatch({ type: "setCropRect", rect: rectBetween(inter.start, p) });
      return;
    }

    if (inter.kind === "imageCrop") {
      const ic = st.imageCrop;
      if (ic) {
        dispatch({ type: "setImageCrop", value: { objectId: ic.objectId, rect: rectBetween(inter.start, p) } });
      }
      return;
    }

    if (inter.kind === "brush") {
      const obj = currentObject(inter.id);
      if (obj) {
        dispatch({
          type: "updateObject",
          id: inter.id,
          patch: { points: [...(obj.points || []), { x: p.x, y: p.y }] },
        });
      }
      return;
    }

    if (inter.kind === "create") {
      dispatch({
        type: "updateObject",
        id: inter.id,
        patch: {
          x: Math.min(inter.start.x, p.x),
          y: Math.min(inter.start.y, p.y),
          width: Math.abs(p.x - inter.start.x),
          height: Math.abs(p.y - inter.start.y),
        },
      });
      return;
    }

    if (inter.kind === "drag") {
      const obj = currentObject(inter.id);
      if (!obj) return;
      const imageRect = {
        x: size.left,
        y: size.top,
        width: st.baseImage.width,
        height: st.baseImage.height,
      };
      const snap = computeSnappedPosition(
        obj,
        p.x - inter.dx,
        p.y - inter.dy,
        imageRect,
        displayScaleRef.current,
        size.width,
      );
      guideStateRef.current = { allV: snap.allV, allH: snap.allH, v: snap.v, h: snap.h };
      inter.moved = true;
      dispatch({ type: "updateObject", id: inter.id, patch: { x: snap.x, y: snap.y } });
      return;
    }

    if (inter.kind === "rotate") {
      const c = inter.center;
      const ang = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
      let rot = inter.startRotation + (ang - inter.startAngle);
      if (event.shiftKey) rot = Math.round(rot / 15) * 15;
      dispatch({ type: "updateObject", id: inter.id, patch: { rotation: normalizeAngle(rot) } });
      return;
    }

    if (inter.kind === "resize") {
      const obj = currentObject(inter.id);
      if (!obj) return;
      let pp = p;
      const rot = obj.rotation || 0;
      if (rot) {
        const c = {
          x: inter.bounds.x + inter.bounds.width / 2,
          y: inter.bounds.y + inter.bounds.height / 2,
        };
        pp = rotatePoint(p, c, -rot);
      }
      dispatch({
        type: "updateObject",
        id: inter.id,
        patch: computeResize(obj, inter.handle, inter.bounds, inter.original, pp),
      });
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const inter = interactionRef.current;
    if (!inter) return;
    const canvas = canvasRef.current;
    try {
      canvas?.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    if (inter.kind === "create") {
      const obj = currentObject(inter.id);
      if (obj) {
        const patch: Partial<EditorObject> = {};
        if ((obj.width ?? 0) < 2) patch.width = Math.max(obj.width ?? 0, 160);
        if ((obj.height ?? 0) < 2) patch.height = Math.max(obj.height ?? 0, 120);
        if (Object.keys(patch).length) {
          dispatch({ type: "updateObject", id: inter.id, patch });
        }
      }
      commit();
      dispatch({ type: "setActiveTool", tool: "select" });
    } else if (inter.kind === "drag") {
      if (inter.moved) commit();
    } else if (inter.kind === "resize" || inter.kind === "rotate" || inter.kind === "brush") {
      commit();
    }

    interactionRef.current = null;
    guideStateRef.current = null;
    render();
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const st = stateRef.current;
    if (st.activeTool !== "select") return;
    const size = computeDocumentSize(st.baseImage, st.padding);
    const p = getDocPoint(event);
    const hit = hitTest(visibleObjects(st), p, size.width);
    if (hit && hit.type === "text") {
      dispatch({ type: "selectObject", id: hit.id });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (isVideoFile(file)) {
        void openVideoFile(file);
        return;
      }
      if (file.type.startsWith("image/")) {
        if (stateRef.current.baseImage.source) void addImageLayerFile(file);
        else void openImageFile(file);
        return;
      }
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          if (stateRef.current.baseImage.source) void addImageLayerFile(file);
          else void openImageFile(file);
          return;
        }
      }
    }
  };

  useEffect(() => {
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openImageFile, addImageLayerFile]);

  const zoomBy = (factor: number) => {
    dispatch({ type: "setZoom", zoom: Math.max(0.1, Math.min(8, state.zoom * factor)) });
  };

  return (
    <section
      className="stage"
      id="stage"
      ref={stageRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <canvas
        id="canvas"
        ref={canvasRef}
        width={800}
        height={600}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />

      <div className={`empty-state${state.started ? " hidden" : ""}`} id="empty-state">
        <div className="empty-inner">
          <div className="empty-icon">🖼️</div>
          <h2>Drop an image or video here</h2>
          <p>
            or paste from clipboard, or{" "}
            <button id="empty-open" className="link-btn" type="button" onClick={() => void openImageDialog()}>
              open a file
            </button>
            .
          </p>
        </div>
      </div>

      <div className={`drop-overlay${dragOver ? "" : " hidden"}`} id="drop-overlay">
        <div className="drop-inner">Drop image or video to add</div>
      </div>

      <div className={`logo-controls${state.started ? "" : " hidden"}`} id="logo-controls">
        <button
          id="logo-place"
          className="zoom-btn logo-btn"
          type="button"
          title="Add the saved logo to the canvas"
          onClick={placeLogo}
        >
          Logo
        </button>
        <button
          id="logo-change"
          className="zoom-btn logo-btn"
          type="button"
          title="Choose the logo image"
          onClick={changeLogo}
        >
          Change logo
        </button>
      </div>

      <div className="zoom-controls" id="zoom-controls">
        <button id="zoom-out" className="zoom-btn" type="button" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <span id="zoom-label" className="zoom-label">
          {Math.round(state.zoom * 100)}%
        </span>
        <button id="zoom-in" className="zoom-btn" type="button" title="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button
          id="zoom-fit"
          className="zoom-btn zoom-fit"
          type="button"
          title="Fit to screen"
          onClick={() => dispatch({ type: "setZoom", zoom: 1 })}
        >
          Fit
        </button>
      </div>

      <div
        className={`export-progress${exporting ? "" : " hidden"}${
          exporting && exportProgress == null ? " indeterminate" : ""
        }`}
        id="export-progress"
      >
        <div className="export-progress-inner">
          <div className="export-progress-label" id="export-progress-label">
            Exporting video…
          </div>
          <div className="export-progress-track">
            <div
              className="export-progress-fill"
              id="export-progress-fill"
              style={
                exportProgress == null
                  ? undefined
                  : { width: `${Math.round(exportProgress * 100)}%` }
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
