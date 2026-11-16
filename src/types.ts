export type Tool = "select" | "text" | "image" | "rect" | "ellipse" | "crop" | "brush";

export type MediaType = "image" | "video";

export type Align = "left" | "center" | "right";
export type Direction = "rtl" | "ltr";
export type ShapeMode = "fill" | "blur";
export type BrushMode = "draw" | "cover" | "blur";
export type BackgroundMode = "solid" | "lines";
export type BackgroundPattern =
  | "diagonal"
  | "grid"
  | "crosshatch"
  | "triangles"
  | "hexagons"
  | "isometric"
  | "waves"
  | "scales"
  | "rings"
  | "truchet";

// Decorative pattern drawn over the background colour. Only the `lines` mode
// paints geometry; `solid` leaves the flat colour untouched.
export interface BackgroundStyle {
  mode: BackgroundMode;
  pattern: BackgroundPattern;
  lineColor: string;
  lineOpacity: number;
  spacing: number;
  lineWidth: number;
}

// Video export knobs. `resolution` scales the composed frame (never upscales);
// `codec` selects the encoder family and container; `hardware` picks a GPU
// encoder where the chosen codec supports one.
export type VideoResolution = "original" | "1080p" | "720p" | "480p" | "360p";
export type VideoCodec = "h264" | "h265" | "vp9" | "av1";
export type VideoHardware = "software" | "nvidia" | "intel" | "amd" | "apple";

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
  // Multiplier applied to the font size to get the distance between lines.
  lineSpacing: number;
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
  // Multiplier applied to the font size to get the distance between lines.
  lineSpacing?: number;
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

// A music clip on the video timeline. `start`/`end` are timeline positions while
// `audioStart` is the offset into the source audio that plays at `start`. The
// clip can be shorter than the source (right-trim) or start later in the source
// (left-trim), which is what lets a long song be cut to fit.
export interface MusicTrack {
  name: string;
  path: string | null;
  dataUrl: string;
  duration: number;
  start: number;
  end: number;
  audioStart: number;
}

export interface DocSnapshot {
  mediaType: MediaType;
  baseImage: BaseImage;
  padding: Padding;
  background: string;
  backgroundStyle: BackgroundStyle;
  objects: EditorObject[];
  selectedObjectId: string | null;
  brush: BrushSettings;
  currentColor: string;
  currentShapeFill: string;
  videoCrop: Rect | null;
  music: MusicTrack | null;
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
  backgroundStyle: BackgroundStyle;
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
  video: {
    duration: number;
    playing: boolean;
    muted: boolean;
    exportFps: number;
    resolution: VideoResolution;
    codec: VideoCodec;
    hardware: VideoHardware;
  };
  showHiddenObjects: boolean;
  cropActive: boolean;
  cropRect: Rect | null;
  imageCrop: { objectId: string; rect: Rect | null } | null;
  // Non-destructive video crop: the region of the *original* video (source
  // pixels) that is shown. The video file is never re-encoded; it is only
  // cropped when the user saves.
  videoCrop: Rect | null;
  // Optional music track. When its end is past the video duration the whole
  // timeline (and the exported file) grows to fit it; the video freezes on its
  // last frame while the music keeps playing.
  music: MusicTrack | null;
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

export interface VideoExportMusic {
  sourcePath?: string;
  sourceData?: string;
  // Timeline placement and the offset into the source audio.
  start: number;
  end: number;
  audioStart: number;
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
  // Encoding choices. Default to H.264 / software when omitted.
  codec?: VideoCodec;
  hardware?: VideoHardware;
  // Final output size (after scaling the composed frame). Omitted keeps the
  // document resolution.
  outWidth?: number;
  outHeight?: number;
  // Include the original video's audio. Defaults to true.
  originalAudio?: boolean;
  // Custom music mixed over the video. Its end may extend the export past the
  // source video's length.
  music?: VideoExportMusic | null;
}

export interface MemeApi {
  pickMedia(kind: "image" | "video" | "audio"): Promise<string | null>;
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
