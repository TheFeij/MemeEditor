#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesDir = path.join(root, "resources");
const force = process.argv.includes("--force");

const BTBN = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";

const TARGETS = {
  "linux-x64": {
    url: process.env.FFMPEG_LINUX_URL || `${BTBN}/ffmpeg-master-latest-linux64-gpl.tar.xz`,
    kind: "tar.xz",
    binary: "ffmpeg",
  },
  "linux-arm64": {
    url: process.env.FFMPEG_LINUX_ARM64_URL || `${BTBN}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`,
    kind: "tar.xz",
    binary: "ffmpeg",
  },
  "win32-x64": {
    url: process.env.FFMPEG_WINDOWS_URL || `${BTBN}/ffmpeg-master-latest-win64-gpl.zip`,
    kind: "zip",
    binary: "ffmpeg.exe",
  },
  "win32-arm64": {
    url: process.env.FFMPEG_WINDOWS_ARM64_URL || `${BTBN}/ffmpeg-master-latest-winarm64-gpl.zip`,
    kind: "zip",
    binary: "ffmpeg.exe",
  },
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed (${res.status} ${res.statusText}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

async function extract(archive, dir) {
  await execFileAsync("tar", ["-xf", archive, "-C", dir]);
}

async function findBinary(dir, name) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return null;
}

async function main() {
  const target = TARGETS[`${process.platform}-${process.arch}`];
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const dest = path.join(resourcesDir, binaryName);

  if (!target) {
    console.warn(`[fetch-ffmpeg] no bundled build for ${process.platform}-${process.arch}; skipping`);
    return;
  }

  if (existsSync(dest) && !force) {
    if (process.platform !== "win32") await fs.chmod(dest, 0o755);
    console.log(`[fetch-ffmpeg] using existing resources/${binaryName} (pass --force to refresh)`);
    return;
  }

  await fs.mkdir(resourcesDir, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fetch-ffmpeg-"));
  try {
    const archive = path.join(tmp, `ffmpeg.${target.kind}`);
    console.log(`[fetch-ffmpeg] downloading ${target.url}`);
    await download(target.url, archive);
    console.log("[fetch-ffmpeg] extracting");
    await extract(archive, tmp);
    const found = await findBinary(tmp, target.binary);
    if (!found) throw new Error(`${target.binary} not found in archive`);
    await fs.copyFile(found, dest);
    if (process.platform !== "win32") await fs.chmod(dest, 0o755);
    console.log(`[fetch-ffmpeg] wrote resources/${binaryName}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[fetch-ffmpeg] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
