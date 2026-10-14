import { BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  configPath,
  lastSaveDir,
  loadPreferences,
  rememberSaveDir,
  savePreferences,
} from "./config";
import { blurPng } from "./blur";
import { ffmpegAvailable, exportVideo, type VideoExportOptions } from "./ffmpeg";
import { listUserFonts } from "./fonts";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i;

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".ogv": "video/ogg",
};

function sniffMime(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF") {
    const kind = buf.slice(8, 12).toString("ascii");
    if (kind === "WEBP") return "image/webp";
    if (kind === "AVI ") return "video/x-msvideo";
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  if (buf.length >= 12 && buf.slice(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3)
    return "video/webm";
  if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "OggS") return "video/ogg";
  return "application/octet-stream";
}

function resolveMime(filePath: string, buf: Buffer): string {
  const byExt = EXT_MIME[path.extname(filePath).toLowerCase()];
  if (byExt) return byExt;
  const sniffed = sniffMime(buf);
  return sniffed;
}

function isMedia(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/");
}

function ownerWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function writeDataURL(dataURL: string, filePath: string): Promise<void> {
  const comma = dataURL.indexOf(",");
  if (comma < 0) throw new Error("invalid image data");
  await fs.writeFile(filePath, Buffer.from(dataURL.slice(comma + 1), "base64"));
}

export function registerIpc(): void {
  ipcMain.handle("media:read", async (_event, filePath: string) => {
    const data = await fs.readFile(filePath);
    let mime = resolveMime(filePath, data);
    if (!isMedia(mime)) throw new Error("unsupported media type");
    return `data:${mime};base64,${data.toString("base64")}`;
  });

  ipcMain.handle("media:pick", async (event, kind: "image" | "video") => {
    const win = ownerWindow(event);
    const filters =
      kind === "video"
        ? [{ name: "Video", extensions: ["mp4", "webm", "mov", "mkv", "avi", "m4v", "ogv"] }]
        : [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"] }];
    const defaultDir = await lastSaveDir();
    const options: Electron.OpenDialogOptions = {
      title: kind === "video" ? "Open Video" : "Open Image",
      properties: ["openFile"],
      filters,
      defaultPath: defaultDir || undefined,
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("image:save", async (event, dataURL: string) => {
    const win = ownerWindow(event);
    const defaultDir = await lastSaveDir();
    const options: Electron.SaveDialogOptions = {
      title: "Save Image",
      defaultPath: path.join(defaultDir || "", "meme.png"),
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    let filePath = result.filePath;
    if (!filePath.toLowerCase().endsWith(".png")) filePath += ".png";
    await writeDataURL(dataURL, filePath);
    await rememberSaveDir(path.dirname(filePath));
    return filePath;
  });

  ipcMain.handle("video:export", async (event, opts: VideoExportOptions) => {
    const win = ownerWindow(event);
    const defaultDir = await lastSaveDir();
    const name = opts.filename || "meme.mp4";
    const options: Electron.SaveDialogOptions = {
      title: "Save Video",
      defaultPath: path.join(defaultDir || "", name),
      filters: [
        { name: "MP4 Video", extensions: ["mp4"] },
        { name: "WebM Video", extensions: ["webm"] },
      ],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    let outPath = result.filePath;
    const lower = outPath.toLowerCase();
    if (!lower.endsWith(".mp4") && !lower.endsWith(".webm")) outPath += ".mp4";
    await exportVideo(opts, outPath);
    await rememberSaveDir(path.dirname(outPath));
    return outPath;
  });

  ipcMain.handle("blur:png", async (_event, dataURL: string, radius: number) => {
    return blurPng(dataURL, radius);
  });

  ipcMain.handle("fonts:list", async () => listUserFonts());
  ipcMain.handle("ffmpeg:available", async () => ffmpegAvailable());
  ipcMain.handle("config:load", async () => loadPreferences());
  ipcMain.handle("config:save", async (_event, json: string) => {
    await savePreferences(json);
  });
  ipcMain.handle("config:path", async () => configPath());
}

export { IMAGE_EXT_RE, VIDEO_EXT_RE };
