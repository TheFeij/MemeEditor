import { MAX_HISTORY, COMMIT_COALESCE_MS, DEFAULT_VIDEO_FPS } from "../lib/constants";
import { cloneObject } from "../lib/object";
import type {
  BrushSettings,
  DocSnapshot,
  EditorObject,
  EditorState,
  Padding,
  Rect,
  ShapeMode,
  TextPreset,
  Tool,
} from "../types";
import { initialState } from "./defaults";

export type Action =
  | { type: "reset" }
  | { type: "startEmpty"; width: number; height: number; background: string }
  | {
      type: "setBaseImage";
      source: CanvasImageSource;
      width: number;
      height: number;
      mediaType: EditorState["mediaType"];
    }
  | { type: "setPadding"; padding: Partial<Padding> }
  | { type: "setBackground"; color: string }
  | { type: "setActiveTool"; tool: Tool }
  | { type: "setZoom"; zoom: number }
  | { type: "setStartCanvas"; patch: Partial<EditorState["startCanvas"]> }
  | { type: "setBrush"; patch: Partial<EditorState["brush"]> }
  | { type: "setCurrentShapeFill"; color: string }
  | { type: "setCurrentShapeMode"; mode: ShapeMode }
  | { type: "setCurrentShapeBlur"; radius: number }
  | { type: "setCurrentColor"; color: string }
  | { type: "setLogo"; dataURL: string | null; image: HTMLImageElement | null }
  | {
      type: "setVideo";
      source: HTMLVideoElement;
      width: number;
      height: number;
      duration: number;
    }
  | { type: "setVideoState"; patch: Partial<EditorState["video"]> }
  | { type: "setShowHidden"; value: boolean }
  | { type: "setCropActive"; active: boolean }
  | { type: "setCropRect"; rect: Rect | null }
  | { type: "setImageCrop"; value: { objectId: string; rect: Rect | null } | null }
  | {
      type: "setVideoCrop";
      crop: Rect | null;
      width: number;
      height: number;
      shiftX: number;
      shiftY: number;
    }
  | {
      type: "replaceBase";
      source: CanvasImageSource;
      width: number;
      height: number;
      shiftX: number;
      shiftY: number;
    }
  | { type: "addTextPreset"; preset: TextPreset }
  | { type: "updateTextPreset"; id: string; patch: Partial<TextPreset> }
  | { type: "removeTextPreset"; id: string }
  | { type: "setDefaultPreset"; id: string | null }
  | { type: "addObject"; object: EditorObject; select?: boolean }
  | { type: "updateObject"; id: string; patch: Partial<EditorObject> }
  | { type: "removeObject"; id: string }
  | { type: "selectObject"; id: string | null }
  | { type: "reorder"; id: string; direction: "forward" | "backward" }
  | { type: "commit"; key?: string }
  | { type: "undo" }
  | { type: "redo" }
  | {
      type: "loadPreferences";
      prefs: {
        background?: string;
        padding?: Partial<Padding>;
        brush?: Partial<EditorState["brush"]>;
        startCanvas?: Partial<EditorState["startCanvas"]>;
        textPresets?: TextPreset[];
        defaultPresetId?: string | null;
        logoDataURL?: string | null;
      };
    };

function snapshot(state: EditorState): DocSnapshot {
  return {
    mediaType: state.mediaType,
    baseImage: { ...state.baseImage },
    padding: { ...state.padding },
    background: state.background,
    objects: state.objects.map(cloneObject),
    selectedObjectId: state.selectedObjectId,
    brush: { ...state.brush },
    currentColor: state.currentColor,
    currentShapeFill: state.currentShapeFill,
    videoCrop: state.videoCrop ? { ...state.videoCrop } : null,
  };
}

// Snapshot the current document. When `key` is given and the previous commit
// used the same key recently, the entry is replaced instead of pushed so a
// burst of edits (typing, dragging a slider) becomes a single undo step.
function commit(state: EditorState, key?: string): EditorState {
  const history = state.history.slice(0, state.historyIndex + 1);
  const now = Date.now();
  const snap = snapshot(state);
  const top = history[history.length - 1];
  if (key && top && top.key === key && now - (top.time ?? 0) <= COMMIT_COALESCE_MS) {
    history[history.length - 1] = { ...snap, key, time: now };
    return { ...state, history, historyIndex: history.length - 1 };
  }
  history.push({ ...snap, key, time: now });
  if (history.length > MAX_HISTORY) history.shift();
  return { ...state, history, historyIndex: history.length - 1 };
}

function resetHistoryWith(state: EditorState): EditorState {
  return { ...state, history: [snapshot(state)], historyIndex: 0 };
}

function applySnapshot(state: EditorState, snap: DocSnapshot, index: number): EditorState {
  return {
    ...state,
    mediaType: snap.mediaType,
    baseImage: { ...snap.baseImage },
    padding: { ...snap.padding },
    background: snap.background,
    objects: snap.objects.map(cloneObject),
    selectedObjectId: snap.selectedObjectId,
    brush: { ...snap.brush },
    currentColor: snap.currentColor,
    currentShapeFill: snap.currentShapeFill,
    videoCrop: snap.videoCrop ? { ...snap.videoCrop } : null,
    historyIndex: index,
  };
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "reset":
      return {
        ...initialState,
        textPresets: state.textPresets,
        defaultPresetId: state.defaultPresetId,
        logoDataURL: state.logoDataURL,
        logoImage: state.logoImage,
        brush: state.brush,
        history: [],
        historyIndex: -1,
      };

    case "startEmpty": {
      const next: EditorState = {
        ...state,
        started: true,
        mediaType: "image",
        baseImage: { source: null, width: action.width, height: action.height },
        startCanvas: { ...state.startCanvas, width: action.width, height: action.height },
        background: action.background,
        objects: [],
        selectedObjectId: null,
        video: { ...state.video, duration: 0, playing: false },
        videoCrop: null,
      };
      return resetHistoryWith(next);
    }

    case "setBaseImage": {
      const next: EditorState = {
        ...state,
        started: true,
        mediaType: action.mediaType,
        baseImage: { source: action.source, width: action.width, height: action.height },
        objects: [],
        selectedObjectId: null,
        video: { ...state.video, duration: 0, playing: false },
        videoCrop: null,
      };
      return resetHistoryWith(next);
    }

    case "setVideo": {
      const next: EditorState = {
        ...state,
        started: true,
        mediaType: "video",
        baseImage: { source: action.source, width: action.width, height: action.height },
        video: {
          duration: action.duration,
          playing: false,
          muted: state.video.muted,
          exportFps: state.video.exportFps || DEFAULT_VIDEO_FPS,
        },
        objects: [],
        selectedObjectId: null,
        showHiddenObjects: true,
        videoCrop: null,
      };
      return resetHistoryWith(next);
    }

    case "setVideoState":
      return { ...state, video: { ...state.video, ...action.patch } };

    case "setShowHidden":
      return { ...state, showHiddenObjects: action.value };

    case "setCropActive":
      return {
        ...state,
        cropActive: action.active,
        cropRect: action.active ? state.cropRect : null,
      };

    case "setCropRect":
      return { ...state, cropRect: action.rect };

    case "setImageCrop":
      return { ...state, imageCrop: action.value };

    case "replaceBase":
      return {
        ...state,
        baseImage: { source: action.source, width: action.width, height: action.height },
        objects: state.objects.map((o) => ({
          ...o,
          x: o.x + action.shiftX,
          y: o.y + action.shiftY,
        })),
        cropActive: false,
        cropRect: null,
        imageCrop: null,
        videoCrop: null,
      };

    case "setVideoCrop":
      return {
        ...state,
        baseImage: { ...state.baseImage, width: action.width, height: action.height },
        videoCrop: action.crop,
        objects: state.objects.map((o) => ({
          ...o,
          x: o.x + action.shiftX,
          y: o.y + action.shiftY,
        })),
        cropActive: false,
        cropRect: null,
      };

    case "setPadding":
      return { ...state, padding: { ...state.padding, ...action.padding } };

    case "setBackground": {
      const next = { ...state, background: action.color };
      if (state.currentShapeFill === state.background || !state.currentShapeFill) {
        next.currentShapeFill = action.color;
      }
      return next;
    }

    case "setActiveTool":
      return { ...state, activeTool: action.tool };

    case "setZoom":
      return { ...state, zoom: action.zoom };

    case "setStartCanvas":
      return { ...state, startCanvas: { ...state.startCanvas, ...action.patch } };

    case "setBrush":
      return { ...state, brush: { ...state.brush, ...action.patch } };

    case "setCurrentShapeFill":
      return { ...state, currentShapeFill: action.color };

    case "setCurrentShapeMode":
      return { ...state, currentShapeMode: action.mode };

    case "setCurrentShapeBlur":
      return { ...state, currentShapeBlur: action.radius };

    case "setCurrentColor":
      return { ...state, currentColor: action.color };

    case "setLogo":
      return { ...state, logoDataURL: action.dataURL, logoImage: action.image };


    case "addTextPreset": {
      const textPresets = [...state.textPresets, action.preset];
      const defaultPresetId = state.defaultPresetId ?? action.preset.id;
      return { ...state, textPresets, defaultPresetId };
    }

    case "updateTextPreset":
      return {
        ...state,
        textPresets: state.textPresets.map((p) =>
          p.id === action.id ? { ...p, ...action.patch } : p,
        ),
      };

    case "removeTextPreset":
      return {
        ...state,
        textPresets: state.textPresets.filter((p) => p.id !== action.id),
        defaultPresetId: state.defaultPresetId === action.id ? null : state.defaultPresetId,
      };

    case "setDefaultPreset":
      return { ...state, defaultPresetId: action.id };

    case "addObject": {
      const objects = [...state.objects, action.object];
      return {
        ...state,
        objects,
        selectedObjectId: action.select === false ? state.selectedObjectId : action.object.id,
      };
    }

    case "updateObject":
      return {
        ...state,
        objects: state.objects.map((o) =>
          o.id === action.id ? { ...o, ...action.patch } : o,
        ),
      };

    case "removeObject":
      return {
        ...state,
        objects: state.objects.filter((o) => o.id !== action.id),
        selectedObjectId: state.selectedObjectId === action.id ? null : state.selectedObjectId,
      };

    case "selectObject":
      return { ...state, selectedObjectId: action.id };

    case "reorder": {
      const idx = state.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      const target = action.direction === "forward" ? idx + 1 : idx - 1;
      if (target < 0 || target >= state.objects.length) return state;
      const objects = [...state.objects];
      const [moved] = objects.splice(idx, 1);
      objects.splice(target, 0, moved);
      return { ...state, objects };
    }

    case "commit":
      return commit(state, action.key);

    case "undo": {
      if (state.historyIndex <= 0) return state;
      const index = state.historyIndex - 1;
      return applySnapshot(state, state.history[index], index);
    }

    case "redo": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const index = state.historyIndex + 1;
      return applySnapshot(state, state.history[index], index);
    }

    case "loadPreferences": {
      const p = action.prefs;
      return {
        ...state,
        background: p.background ?? state.background,
        padding: p.padding ? { ...state.padding, ...p.padding } : state.padding,
        brush: (p.brush ? { ...state.brush, ...p.brush } : state.brush) as BrushSettings,
        startCanvas: p.startCanvas ? { ...state.startCanvas, ...p.startCanvas } : state.startCanvas,
        textPresets: p.textPresets ?? state.textPresets,
        defaultPresetId: p.defaultPresetId ?? state.defaultPresetId,
        logoDataURL: p.logoDataURL ?? state.logoDataURL,
      };
    }

    default:
      return state;
  }
}

export { snapshot };
