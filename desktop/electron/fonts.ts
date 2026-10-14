import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface UserFont {
  family: string;
  name: string;
  dataUrl: string;
}

const FONT_EXT_RE = /\.(ttf|otf|woff2?|eot)$/i;

function fontMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".eot":
      return "application/vnd.ms-fontobject";
    default:
      return "application/octet-stream";
  }
}

function deriveFontFamily(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
  return base.split(/\s+/).filter(Boolean).join(" ");
}

// Drop-in font folders, in priority order: a "fonts" folder shipped alongside
// the app's resources, then one in the working directory (handy in dev).
function userFontDirs(): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    dirs.push(p);
  };
  if (app.isPackaged) {
    add(path.join(process.resourcesPath, "fonts"));
  }
  add(path.join(process.cwd(), "fonts"));
  return dirs;
}

export async function listUserFonts(): Promise<UserFont[]> {
  const out: UserFont[] = [];
  const seen = new Set<string>();
  for (const dir of userFontDirs()) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!FONT_EXT_RE.test(name)) continue;
      const family = deriveFontFamily(name);
      if (!family) continue;
      const key = family.toLowerCase();
      if (seen.has(key)) continue;
      try {
        const data = await fs.readFile(path.join(dir, name));
        seen.add(key);
        out.push({
          family,
          name,
          dataUrl: `data:${fontMime(path.extname(name))};base64,${data.toString("base64")}`,
        });
      } catch {
        /* skip unreadable font */
      }
    }
  }
  return out;
}
