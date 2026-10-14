import bundledFontsJson from "../assets/fonts/fonts.json";
import { DEFAULT_FONT } from "./constants";
import type { UserFont } from "../types";

// Bundled faces are resolved to hashed asset URLs by Vite at build time; the
// drop-in user fonts arrive from the main process as data URLs. Both are then
// registered with the CSS Font Loading API so canvas text can use them.

interface BundledFont {
  family: string;
  file: string;
  url: string;
}

const bundledUrls = import.meta.glob(
  "../assets/fonts/**/*.{ttf,otf,woff,woff2}",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

function resolveUrl(file: string): string | null {
  const suffix = "/" + file;
  for (const key of Object.keys(bundledUrls)) {
    if (key.endsWith(suffix)) return bundledUrls[key];
  }
  return null;
}

export const BUNDLED_FONTS: BundledFont[] = bundledFontsJson
  .map((entry) => {
    const url = resolveUrl(entry.file);
    return url ? { family: entry.family, file: entry.file, url } : null;
  })
  .filter((f): f is BundledFont => f !== null);

let cachedFamilies: string[] = [];

export function availableFontFamilies(): string[] {
  return cachedFamilies;
}

function faceFor(family: string, url: string): FontFace | null {
  try {
    return new FontFace(family, `url("${url}")`);
  } catch {
    return null;
  }
}

export async function installFonts(): Promise<string[]> {
  const faces: FontFace[] = [];

  for (const f of BUNDLED_FONTS) {
    const face = faceFor(f.family, f.url);
    if (face) faces.push(face);
  }

  let userFonts: UserFont[] = [];
  try {
    userFonts = await window.meme.listUserFonts();
  } catch {
    userFonts = [];
  }
  for (const u of userFonts) {
    if (!u.family || !u.dataUrl) continue;
    const face = faceFor(u.family, u.dataUrl);
    if (face) faces.push(face);
  }

  const families = new Set<string>();
  await Promise.all(
    faces.map(async (face) => {
      try {
        await face.load();
        document.fonts.add(face);
        families.add(face.family);
      } catch {
        /* skip faces the platform cannot decode */
      }
    }),
  );

  try {
    await document.fonts.ready;
  } catch {
    /* not critical */
  }

  const list = Array.from(families);
  list.sort((a, b) => a.localeCompare(b));
  const preferred = list.indexOf(DEFAULT_FONT);
  if (preferred > 0) {
    list.splice(preferred, 1);
    list.unshift(DEFAULT_FONT);
  }
  cachedFamilies = list;
  return list;
}
