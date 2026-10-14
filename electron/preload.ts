import { contextBridge, ipcRenderer, webUtils } from "electron";

// The single, typed bridge between the renderer and the Electron main process.
// Everything the editor needs from the OS (file dialogs, file reads, ffmpeg,
// the native blur, font discovery and preferences) goes through here.
const api = {
  pickMedia: (kind: "image" | "video"): Promise<string | null> =>
    ipcRenderer.invoke("media:pick", kind),
  readMedia: (filePath: string): Promise<string> => ipcRenderer.invoke("media:read", filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  saveImage: (dataURL: string): Promise<string | null> => ipcRenderer.invoke("image:save", dataURL),
  exportVideo: (opts: unknown): Promise<string | null> => ipcRenderer.invoke("video:export", opts),
  blurPng: (dataURL: string, radius: number): Promise<string> =>
    ipcRenderer.invoke("blur:png", dataURL, radius),
  listUserFonts: (): Promise<{ family: string; name: string; dataUrl: string }[]> =>
    ipcRenderer.invoke("fonts:list"),
  ffmpegAvailable: (): Promise<boolean> => ipcRenderer.invoke("ffmpeg:available"),
  loadPreferences: (): Promise<string> => ipcRenderer.invoke("config:load"),
  savePreferences: (json: string): Promise<void> => ipcRenderer.invoke("config:save", json),
  configPath: (): Promise<string> => ipcRenderer.invoke("config:path"),
};

contextBridge.exposeInMainWorld("meme", api);

export type MemeApi = typeof api;
