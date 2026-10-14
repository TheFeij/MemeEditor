import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

// Preferences (text presets, colours, brush settings, logo, last save folder)
// are stored as a small JSON file in the per-user data directory. This is the
// idiomatic Electron location and is always writable, unlike the portable
// "next to the executable" scheme the old Wails backend used.

const CONFIG_FILE = "MemeEditor.config.json";

interface AppConfig {
  lastSaveDir?: string;
  preferences?: unknown;
}

let resolvedPath: string | null = null;

export function configPath(): string {
  if (!resolvedPath) {
    resolvedPath = path.join(app.getPath("userData"), CONFIG_FILE);
  }
  return resolvedPath;
}

async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as AppConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeConfig(cfg: AppConfig): Promise<void> {
  const file = configPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function loadPreferences(): Promise<string> {
  const cfg = await readConfig();
  return cfg.preferences === undefined ? "{}" : JSON.stringify(cfg.preferences);
}

export async function savePreferences(preferences: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(preferences);
  } catch {
    throw new Error("invalid preferences JSON");
  }
  const cfg = await readConfig();
  cfg.preferences = parsed;
  await writeConfig(cfg);
}

export async function lastSaveDir(): Promise<string> {
  const cfg = await readConfig();
  return typeof cfg.lastSaveDir === "string" ? cfg.lastSaveDir : "";
}

export async function rememberSaveDir(dir: string): Promise<void> {
  const cfg = await readConfig();
  cfg.lastSaveDir = dir;
  await writeConfig(cfg);
}
