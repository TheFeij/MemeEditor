export type Tool = "select" | "text" | "image" | "rect" | "ellipse" | "crop" | "brush";

export type MediaType = "image" | "video";

export type Align = "left" | "center" | "right";
export type Direction = "rtl" | "ltr";
export type ShapeMode = "fill" | "blur";
export type BrushMode = "draw" | "cover" | "blur";

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrushSettings {
  mode: BrushMode;
  color: string;
  size: number;
  blurRadius: number;
}

export interface TextPreset {
  id: string;
  name: string;
  fontFamily: string;
  maxFontSize: number;
  align: Align;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  outlineEnabled: boolean;
  direction?: Direction;
}

// A single editable item on the canvas. Kept intentionally loose (optional
// fields) so the ported imperative rendering/hit-testing code can operate on a
// shared shape, exactly like the original app did.
export interface EditorObject {
  id: string;
  type: "text" | "image" | "rect" | "ellipse" | "brush";
  x: number;
  y: number;
  rotation?: number;
  tStart?: number;
  tEnd?: number;

  // text
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  maxFontSize?: number;
  autoFit?: boolean;
  color?: string;
  outlineColor?: string;
  outlineWidth?: number;
  outlineEnabled?: boolean;
  align?: Align;
  direction?: Direction;
  scaleX?: number;
  scaleY?: number;

  // shapes (rect/ellipse)
  width?: number;
  height?: number;
  fill?: string;
  radius?: number;
  mode?: ShapeMode | BrushMode;
  blurRadius?: number;

  // image layers
  source?: CanvasImageSource | null;
  opacity?: number;

  // brush strokes
  points?: { x: number; y: number }[];
  size?: number;
}

export interface BaseImage {
  source: CanvasImageSource | null;
  width: number;
  height: number;
}

export interface DocSnapshot {
  mediaType: MediaType;
  baseImage: BaseImage;
  padding: Padding;
  background: string;
  objects: EditorObject[];
  selectedObjectId: string | null;
  brush: BrushSettings;
  currentColor: string;
  currentShapeFill: string;
  videoCrop: Rect | null;
  // History-coalescing metadata: consecutive commits that share a `key` within
  // the coalescing window are merged into a single undo step.
  key?: string;
  time?: number;
}

export interface EditorState {
  started: boolean;
  mediaType: MediaType;
  baseImage: BaseImage;
  padding: Padding;
  background: string;
  objects: EditorObject[];
  selectedObjectId: string | null;
  activeTool: Tool;
  brush: BrushSettings;
  currentColor: string;
  currentShapeFill: string;
  currentShapeMode: ShapeMode;
  currentShapeBlur: number;
  startCanvas: { width: number; height: number; background: string };
  zoom: number;
  textPresets: TextPreset[];
  defaultPresetId: string | null;
  logoDataURL: string | null;
  logoImage: HTMLImageElement | null;
  video: { duration: number; playing: boolean; muted: boolean; exportFps: number };
  showHiddenObjects: boolean;
  cropActive: boolean;
  cropRect: Rect | null;
  imageCrop: { objectId: string; rect: Rect | null } | null;
  // Non-destructive video crop: the region of the *original* video (source
  // pixels) that is shown. The video file is never re-encoded; it is only
  // cropped when the user saves.
  videoCrop: Rect | null;
  history: DocSnapshot[];
  historyIndex: number;
}

export interface UserFont {
  family: string;
  name: string;
  dataUrl: string;
}

export interface VideoExportLayer {
  image: string;
  start: number;
  end: number;
  blur: number;
}

export interface VideoExportOptions {
  sourcePath?: string;
  sourceData?: string;
  width: number;
  height: number;
  padLeft: number;
  padTop: number;
  background: string;
  fps: number;
  duration: number;
  filename: string;
  layers: VideoExportLayer[];
  // Source-pixel region to crop out before padding/overlays. Omitted or null
  // means the full frame is used.
  crop?: Rect | null;
}

export interface MemeApi {
  pickMedia(kind: "image" | "video"): Promise<string | null>;
  readMedia(filePath: string): Promise<string>;
  getPathForFile(file: File): string;
  saveImage(dataURL: string): Promise<string | null>;
  exportVideo(opts: VideoExportOptions): Promise<string | null>;
  blurPng(dataURL: string, radius: number): Promise<string>;
  listUserFonts(): Promise<UserFont[]>;
  ffmpegAvailable(): Promise<boolean>;
  loadPreferences(): Promise<string>;
  savePreferences(json: string): Promise<void>;
  configPath(): Promise<string>;
}

declare global {
  interface Window {
    meme: MemeApi;
  }
}
