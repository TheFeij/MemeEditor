import { nativeImage } from "electron";
import { availableParallelism, cpus } from "node:os";
import { Worker } from "node:worker_threads";

// Pixel-heavy blur used by the "blur" paint mode and blur shapes. The old Go
// backend did this to keep the UI thread free and to use every CPU core; here
// we use Electron's nativeImage to decode/encode (no extra dependencies) and
// worker threads to parallelise the box-blur passes.

type Bitmap = {
  data: Buffer;
  width: number;
  height: number;
};

function clamp8(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return (v + 0.5) | 0;
}

// A single horizontal box-blur pass over premultiplied BGRA data.
export function boxBlurH(pix: Buffer, width: number, height: number, r: number): void {
  const stride = width * 4;
  const win = 2 * r + 1;
  const tmp = new Float64Array(width * 4);
  for (let y = 0; y < height; y++) {
    const base = y * stride;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = -r; i <= r; i++) {
      const ii = i < 0 ? 0 : i >= width ? width - 1 : i;
      const o = base + ii * 4;
      sb += pix[o];
      sg += pix[o + 1];
      sr += pix[o + 2];
      sa += pix[o + 3];
    }
    for (let x = 0; x < width; x++) {
      const oi = x * 4;
      tmp[oi] = sb / win;
      tmp[oi + 1] = sg / win;
      tmp[oi + 2] = sr / win;
      tmp[oi + 3] = sa / win;

      let addI = x + r + 1;
      if (addI >= width) addI = width - 1;
      let subI = x - r;
      if (subI < 0) subI = 0;
      const ao = base + addI * 4;
      const so = base + subI * 4;
      sb += pix[ao] - pix[so];
      sg += pix[ao + 1] - pix[so + 1];
      sr += pix[ao + 2] - pix[so + 2];
      sa += pix[ao + 3] - pix[so + 3];
    }
    for (let x = 0; x < width; x++) {
      const o = base + x * 4;
      const oi = x * 4;
      pix[o] = clamp8(tmp[oi]);
      pix[o + 1] = clamp8(tmp[oi + 1]);
      pix[o + 2] = clamp8(tmp[oi + 2]);
      pix[o + 3] = clamp8(tmp[oi + 3]);
    }
  }
}

export function boxBlurV(pix: Buffer, width: number, height: number, r: number): void {
  const stride = width * 4;
  const win = 2 * r + 1;
  const tmp = new Float64Array(height * 4);
  for (let x = 0; x < width; x++) {
    const base = x * 4;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = -r; i <= r; i++) {
      const ii = i < 0 ? 0 : i >= height ? height - 1 : i;
      const o = base + ii * stride;
      sb += pix[o];
      sg += pix[o + 1];
      sr += pix[o + 2];
      sa += pix[o + 3];
    }
    for (let y = 0; y < height; y++) {
      const oi = y * 4;
      tmp[oi] = sb / win;
      tmp[oi + 1] = sg / win;
      tmp[oi + 2] = sr / win;
      tmp[oi + 3] = sa / win;

      let addI = y + r + 1;
      if (addI >= height) addI = height - 1;
      let subI = y - r;
      if (subI < 0) subI = 0;
      const ao = base + addI * stride;
      const so = base + subI * stride;
      sb += pix[ao] - pix[so];
      sg += pix[ao + 1] - pix[so + 1];
      sr += pix[ao + 2] - pix[so + 2];
      sa += pix[ao + 3] - pix[so + 3];
    }
    for (let y = 0; y < height; y++) {
      const o = base + y * stride;
      const oi = y * 4;
      pix[o] = clamp8(tmp[oi]);
      pix[o + 1] = clamp8(tmp[oi + 1]);
      pix[o + 2] = clamp8(tmp[oi + 2]);
      pix[o + 3] = clamp8(tmp[oi + 3]);
    }
  }
}

// Blur a decoded bitmap in place with three box-blur passes of radius/3,
// approximating a Gaussian, exactly like the old Go implementation.
export function blurBitmap(bitmap: Bitmap, radius: number): void {
  const { data, width, height } = bitmap;
  const r = Math.max(1, Math.floor(radius / 3));
  for (let i = 0; i < 3; i++) {
    boxBlurH(data, width, height, r);
    boxBlurV(data, width, height, r);
  }
}

// Whether worker-thread offloading is worthwhile. Small images finish fast
// enough on the main thread that the round-trip overhead dominates.
function shouldUseWorkers(width: number, height: number): boolean {
  return width * height > 512 * 512;
}

const workerSource = `
const { parentPort } = require('node:worker_threads');
const clamp8 = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0);
function boxBlurH(pix, width, height, r) {
  const stride = width * 4, win = 2 * r + 1;
  const tmp = new Float64Array(width * 4);
  for (let y = 0; y < height; y++) {
    const base = y * stride;
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let i = -r; i <= r; i++) {
      const ii = i < 0 ? 0 : i >= width ? width - 1 : i;
      const o = base + ii * 4;
      sb += pix[o]; sg += pix[o + 1]; sr += pix[o + 2]; sa += pix[o + 3];
    }
    for (let x = 0; x < width; x++) {
      const oi = x * 4;
      tmp[oi] = sb / win; tmp[oi + 1] = sg / win; tmp[oi + 2] = sr / win; tmp[oi + 3] = sa / win;
      let addI = x + r + 1; if (addI >= width) addI = width - 1;
      let subI = x - r; if (subI < 0) subI = 0;
      const ao = base + addI * 4, so = base + subI * 4;
      sb += pix[ao] - pix[so]; sg += pix[ao + 1] - pix[so + 1];
      sr += pix[ao + 2] - pix[so + 2]; sa += pix[ao + 3] - pix[so + 3];
    }
    for (let x = 0; x < width; x++) {
      const o = base + x * 4, oi = x * 4;
      pix[o] = clamp8(tmp[oi]); pix[o + 1] = clamp8(tmp[oi + 1]);
      pix[o + 2] = clamp8(tmp[oi + 2]); pix[o + 3] = clamp8(tmp[oi + 3]);
    }
  }
}
function boxBlurV(pix, width, height, r) {
  const stride = width * 4, win = 2 * r + 1;
  const tmp = new Float64Array(height * 4);
  for (let x = 0; x < width; x++) {
    const base = x * 4;
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let i = -r; i <= r; i++) {
      const ii = i < 0 ? 0 : i >= height ? height - 1 : i;
      const o = base + ii * stride;
      sb += pix[o]; sg += pix[o + 1]; sr += pix[o + 2]; sa += pix[o + 3];
    }
    for (let y = 0; y < height; y++) {
      const oi = y * 4;
      tmp[oi] = sb / win; tmp[oi + 1] = sg / win; tmp[oi + 2] = sr / win; tmp[oi + 3] = sa / win;
      let addI = y + r + 1; if (addI >= height) addI = height - 1;
      let subI = y - r; if (subI < 0) subI = 0;
      const ao = base + addI * stride, so = base + subI * stride;
      sb += pix[ao] - pix[so]; sg += pix[ao + 1] - pix[so + 1];
      sr += pix[ao + 2] - pix[so + 2]; sa += pix[ao + 3] - pix[so + 3];
    }
    for (let y = 0; y < height; y++) {
      const o = base + y * stride, oi = y * 4;
      pix[o] = clamp8(tmp[oi]); pix[o + 1] = clamp8(tmp[oi + 1]);
      pix[o + 2] = clamp8(tmp[oi + 2]); pix[o + 3] = clamp8(tmp[oi + 3]);
    }
  }
}
parentPort.on('message', (msg) => {
  const data = Buffer.from(msg.data);
  const r = Math.max(1, Math.floor(msg.radius / 3));
  for (let i = 0; i < 3; i++) { boxBlurH(data, msg.width, msg.height, r); boxBlurV(data, msg.width, msg.height, r); }
  parentPort.postMessage(data);
});
`;

let sharedWorker: Worker | null = null;
let sharedWorkerReady: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker;
  if (!sharedWorkerReady) {
    sharedWorkerReady = new Promise<Worker>((resolve, reject) => {
      const w = new Worker(workerSource, { eval: true });
      w.once("online", () => {
        sharedWorker = w;
        resolve(w);
      });
      w.once("error", reject);
    });
  }
  return sharedWorkerReady;
}

async function blurWithWorker(bitmap: Bitmap, radius: number): Promise<void> {
  const worker = await getWorker();
  const result = await new Promise<Buffer>((resolve, reject) => {
    const onMessage = (data: Buffer) => {
      worker.off("error", onError);
      resolve(Buffer.from(data));
    };
    const onError = (err: Error) => {
      worker.off("message", onMessage);
      reject(err);
    };
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.postMessage({
      data: bitmap.data,
      width: bitmap.width,
      height: bitmap.height,
      radius,
    });
  });
  result.copy(bitmap.data);
}

// Takes a data-URL encoded image and returns a data-URL encoded PNG with a box
// blur applied.
export async function blurPng(dataURL: string, radius: number): Promise<string> {
  const image = nativeImage.createFromDataURL(dataURL);
  if (image.isEmpty()) throw new Error("could not decode image");
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) throw new Error("empty image");
  const data = image.toBitmap();
  const bitmap: Bitmap = { data, width, height };

  if (shouldUseWorkers(width, height)) {
    try {
      await blurWithWorker(bitmap, radius);
    } catch {
      blurBitmap(bitmap, radius);
    }
  } else {
    blurBitmap(bitmap, radius);
  }

  const out = nativeImage.createFromBitmap(bitmap.data, { width, height });
  return out.toDataURL();
}

export function coreCount(): number {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return Math.max(1, cpus().length);
  }
}
