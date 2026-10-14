import { app } from "electron";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Video memes are exported in a single ffmpeg pass: the original clip is
// decoded and encoded once while every overlay (text, shape, sticker, brush
// stroke) is supplied as a full-size PNG with a time window, added with
// `overlay ... enable='between(t,start,end)'`. This is dramatically faster and
// more reliable than capturing one frame at a time from the renderer.
//
// "Background blur" objects cannot be baked into a static PNG (they blur the
// moving frame beneath them), so they are exported as a black/white mask: the
// frame is box-blurred and composited back through the mask.

export interface VideoExportLayer {
  image: string; // full-canvas PNG data URL (overlay) or mask
  start: number;
  end: number;
  blur: number; // > 0 => background-blur mask, value is radius
}

export type VideoCodec = "h264" | "h265" | "vp9" | "av1";
export type VideoHardware = "software" | "nvidia" | "intel" | "amd" | "apple";

export interface VideoExportOptions {
  sourcePath?: string; // preferred: original file
  sourceData?: string; // fallback: data URL
  width: number;
  height: number;
  padLeft: number;
  padTop: number;
  background: string;
  fps: number;
  duration: number;
  filename: string;
  layers: VideoExportLayer[];
  // Non-destructive crop: the source-pixel region to keep. The original file is
  // never modified; cropping happens here, during the export encode.
  crop?: { x: number; y: number; width: number; height: number } | null;
  // Encoding choices. Default to H.264 / software when omitted.
  codec?: VideoCodec;
  hardware?: VideoHardware;
  // Final output size (after scaling the composed frame). Omitted keeps the
  // document resolution.
  outWidth?: number;
  outHeight?: number;
}

// Container implied by the codec: VP9 and AV1 go in WebM, everything else MP4.
export function containerForCodec(codec: VideoCodec = "h264"): "mp4" | "webm" {
  return codec === "vp9" || codec === "av1" ? "webm" : "mp4";
}

// Encoder names per codec/hardware. `null` means the combination is not
// supported and the exporter falls back to the software encoder.
const ENCODERS: Record<VideoCodec, Record<VideoHardware, string | null>> = {
  h264: {
    software: "libx264",
    nvidia: "h264_nvenc",
    intel: "h264_qsv",
    amd: "h264_amf",
    apple: "h264_videotoolbox",
  },
  h265: {
    software: "libx265",
    nvidia: "hevc_nvenc",
    intel: "hevc_qsv",
    amd: "hevc_amf",
    apple: "hevc_videotoolbox",
  },
  vp9: { software: "libvpx-vp9", nvidia: null, intel: null, amd: null, apple: null },
  av1: {
    software: "libsvtav1",
    nvidia: "av1_nvenc",
    intel: "av1_qsv",
    amd: "av1_amf",
    apple: null,
  },
};

const SOFTWARE_FALLBACK: Record<VideoCodec, string[]> = {
  h264: ["libx264", "mpeg4"],
  h265: ["libx265"],
  vp9: ["libvpx-vp9"],
  av1: ["libsvtav1", "libaom-av1"],
};

// Look for a bundled ffmpeg first (shipped under resources/), then fall back to
// whatever is on the PATH.
export function findFfmpeg(): string | null {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require("node:fs") as typeof import("node:fs");
  const candidates: string[] = [];
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, exe));
  candidates.push(path.join(app.getAppPath(), "resources", exe));
  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return exe; // rely on PATH resolution
}

export async function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return resolve(false);
    const child = spawn(ffmpeg, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function decodeDataURL(dataURL: string): Buffer {
  const comma = dataURL.indexOf(",");
  if (comma < 0) throw new Error("invalid data URL");
  return Buffer.from(dataURL.slice(comma + 1), "base64");
}

function normalizeFFColor(color: string): string | null {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return "0x" + c.slice(1);
  if (/^0x[0-9a-fA-F]{6}$/.test(c)) return c;
  return null;
}

function extFromHeader(header: string): string {
  if (header.includes("video/mp4")) return ".mp4";
  if (header.includes("video/webm")) return ".webm";
  if (header.includes("video/quicktime")) return ".mov";
  if (header.includes("video/x-matroska")) return ".mkv";
  if (header.includes("video/x-msvideo")) return ".avi";
  return ".bin";
}

// Compose the pad + overlay + blur graph. Overlay inputs start at index 1
// (index 0 is the source video).
export function buildFilter(
  width: number,
  height: number,
  padX: number,
  padY: number,
  color: string,
  layers: VideoExportLayer[],
  crop?: VideoExportOptions["crop"],
  outWidth?: number,
  outHeight?: number,
): string {
  if (padX < 0) padX = 0;
  if (padY < 0) padY = 0;
  let base = "[0:v]";
  if (crop && crop.width >= 1 && crop.height >= 1) {
    const cx = Math.max(0, Math.round(crop.x));
    const cy = Math.max(0, Math.round(crop.y));
    const cw = Math.max(1, Math.round(crop.width));
    const ch = Math.max(1, Math.round(crop.height));
    base += `crop=${cw}:${ch}:${cx}:${cy},`;
  }
  base += `pad=${width}:${height}:${padX}:${padY}:color=${color}[base]`;
  const parts: string[] = [base];
  let prev = "base";
  layers.forEach((layer, i) => {
    const idx = i + 1;
    const label = `v${idx}`;
    const start = layer.start;
    let end = layer.end;
    if (end <= start) end = start + 0.001;
    if (layer.blur > 0) {
      let r = layer.blur;
      const maxR = Math.max(1, Math.floor((Math.min(width, height) - 1) / 2));
      if (r > maxR) r = maxR;
      const a = label + "a";
      const b = label + "b";
      const bl = label + "bl";
      const m = label + "m";
      parts.push(
        `[${prev}]split[${a}][${b}]`,
        `[${b}]boxblur=luma_radius=${r}:luma_power=2:chroma_radius=${r}:chroma_power=2[${bl}]`,
        `[${bl}][${idx}:v]alphamerge[${m}]`,
        `[${a}][${m}]overlay=0:0:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${label}]`,
      );
    } else {
      parts.push(
        `[${prev}][${idx}:v]overlay=0:0:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${label}]`,
      );
    }
    prev = label;
  });
  let tail = `[${prev}]crop=trunc(iw/2)*2:trunc(ih/2)*2`;
  if (outWidth && outHeight && (outWidth !== width || outHeight !== height)) {
    tail += `,scale=${outWidth}:${outHeight}`;
  }
  tail += `,format=yuv420p[vout]`;
  parts.push(tail);
  return parts.join(";");
}

async function ffmpegHasEncoder(ffmpeg: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-encoders"]);
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(out.includes(name)));
  });
}

// Pick the encoder for the requested codec/hardware, falling back to the
// software encoder when the GPU one is unavailable in this ffmpeg build.
async function resolveEncoder(
  ffmpeg: string,
  codec: VideoCodec,
  hardware: VideoHardware,
): Promise<string> {
  const table = ENCODERS[codec] ?? ENCODERS.h264;
  const requested = table[hardware] ?? table.software;
  if (requested && (await ffmpegHasEncoder(ffmpeg, requested))) return requested;
  for (const name of SOFTWARE_FALLBACK[codec] ?? SOFTWARE_FALLBACK.h264) {
    if (await ffmpegHasEncoder(ffmpeg, name)) return name;
  }
  throw new Error(`No usable ${codec} encoder found in this ffmpeg build`);
}

// Encoder-specific quality/speed flags, kept deliberately conservative so an
// unsupported option cannot make the whole export fail.
function encoderArgs(encoder: string): string[] {
  switch (encoder) {
    case "libx264":
      return ["-preset", "veryfast", "-crf", "20"];
    case "libx265":
      return ["-preset", "veryfast", "-crf", "23"];
    case "libvpx-vp9":
      return ["-crf", "32", "-b:v", "0", "-row-mt", "1"];
    case "libsvtav1":
      return ["-preset", "8", "-crf", "30"];
    case "libaom-av1":
      return ["-crf", "30", "-b:v", "0", "-row-mt", "1"];
    case "h264_nvenc":
    case "hevc_nvenc":
      return ["-preset", "p5", "-cq", "23", "-b:v", "0"];
    case "av1_nvenc":
      return ["-preset", "p5", "-cq", "30", "-b:v", "0"];
    case "h264_qsv":
    case "hevc_qsv":
    case "av1_qsv":
      return ["-global_quality", "23"];
    case "h264_amf":
    case "hevc_amf":
    case "av1_amf":
      return ["-quality", "quality", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23"];
    case "h264_videotoolbox":
    case "hevc_videotoolbox":
      return ["-b:v", "8M"];
    case "mpeg4":
      return ["-q:v", "3"];
    default:
      return [];
  }
}

function isHevc(encoder: string): boolean {
  return encoder.startsWith("hevc_") || encoder === "libx265";
}

async function resolveAudioArgs(ffmpeg: string, container: "mp4" | "webm"): Promise<string[]> {
  if (container === "webm") {
    if (await ffmpegHasEncoder(ffmpeg, "libopus")) return ["-c:a", "libopus", "-b:a", "160k"];
    if (await ffmpegHasEncoder(ffmpeg, "libvorbis")) return ["-c:a", "libvorbis", "-q:a", "5"];
    return ["-c:a", "libopus", "-b:a", "160k"];
  }
  return ["-c:a", "aac", "-b:a", "192k"];
}

function run(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args);
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const msg = stderr.trim();
        reject(new Error(msg ? msg.slice(-800) : `ffmpeg exited with code ${code}`));
      }
    });
  });
}

export async function exportVideo(opts: VideoExportOptions, outPath: string): Promise<void> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg was not found");
  if (opts.width < 1 || opts.height < 1) throw new Error("invalid output size");

  const fps = opts.fps > 0 ? opts.fps : 30;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "meme-video-"));

  try {
    let srcPath = opts.sourcePath && opts.sourcePath.trim() ? opts.sourcePath : "";
    if (srcPath) {
      try {
        const stat = await fs.stat(srcPath);
        if (!stat.isFile()) srcPath = "";
      } catch {
        srcPath = "";
      }
    }
    if (!srcPath) {
      if (!opts.sourceData || !opts.sourceData.startsWith("data:")) {
        throw new Error("no source video");
      }
      const header = opts.sourceData.slice(0, opts.sourceData.indexOf(","));
      let ext = extFromHeader(header);
      if (ext === ".bin") ext = ".mp4";
      srcPath = path.join(tmpDir, "source" + ext);
      await fs.writeFile(srcPath, decodeDataURL(opts.sourceData));
    }

    const layerPaths: string[] = [];
    for (let i = 0; i < opts.layers.length; i++) {
      const layer = opts.layers[i];
      if (!layer.image.startsWith("data:")) throw new Error("invalid layer image");
      const p = path.join(tmpDir, `layer-${String(i).padStart(4, "0")}.png`);
      await fs.writeFile(p, decodeDataURL(layer.image));
      layerPaths.push(p);
    }

    const codec = opts.codec ?? "h264";
    const hardware = opts.hardware ?? "software";
    const container = containerForCodec(codec);
    const encoder = await resolveEncoder(ffmpeg, codec, hardware);

    const color = normalizeFFColor(opts.background) ?? "black";
    const filter = buildFilter(
      opts.width,
      opts.height,
      opts.padLeft,
      opts.padTop,
      color,
      opts.layers,
      opts.crop,
      opts.outWidth,
      opts.outHeight,
    );
    const audioArgs = await resolveAudioArgs(ffmpeg, container);

    const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-i", srcPath];
    for (const p of layerPaths) {
      args.push("-loop", "1", "-framerate", String(fps), "-i", p);
    }
    args.push("-filter_complex", filter, "-map", "[vout]", "-map", "0:a:0?");
    args.push("-c:v", encoder, ...encoderArgs(encoder));
    if (isHevc(encoder) && container === "mp4") args.push("-tag:v", "hvc1");
    args.push("-pix_fmt", "yuv420p", ...audioArgs);
    if (opts.duration > 0) args.push("-t", opts.duration.toFixed(3));
    if (container === "mp4") args.push("-movflags", "+faststart");
    args.push(outPath);

    try {
      await run(ffmpeg, args);
    } catch (err) {
      await fs.rm(outPath, { force: true });
      throw err;
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
