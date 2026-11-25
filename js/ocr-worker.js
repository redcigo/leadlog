/**
 * Business card text recognition, in a background thread.
 * PaddleOCR PP-OCRv6 (small) models run with ONNX Runtime (WebAssembly), all on
 * the device. Two steps:
 *   1. detection finds every line of text and its outline (rotated rectangle)
 *   2. recognition reads each line, including Czech and other accented letters
 * Messages: {type: 'load'} → {type: 'loaded'}; {type: 'read', id, bitmap} → {type: 'lines', id, lines}.
 */

import * as ort from '../vendor/onnxruntime/ort.wasm.min.mjs';

const VENDOR = new URL('../vendor/', import.meta.url).href;
ort.env.wasm.wasmPaths = `${VENDOR}onnxruntime/`;
ort.env.wasm.numThreads = 1; // GitHub Pages can't enable shared memory, so one thread
ort.env.wasm.proxy = false;
ort.env.logLevel = 'error';

const DET_LIMIT = 960; // longest side for detection
const DET_THRESHOLD = 0.2;
const BOX_THRESHOLD = 0.45;
const UNCLIP = 1.4;
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 1600;

let models = null;

async function load() {
  if (!models) {
    models = (async () => {
      const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      const [det, rec, keys] = await Promise.all([
        ort.InferenceSession.create(`${VENDOR}paddleocr/det.onnx`, options),
        ort.InferenceSession.create(`${VENDOR}paddleocr/rec.onnx`, options),
        fetch(`${VENDOR}paddleocr/keys.json`).then((r) => r.json())
      ]);
      return { det, rec, chars: ['', ...keys, ' '] };
    })();
    models.catch(() => { models = null; });
  }
  return models;
}

/* ---------- Image helpers ---------- */

function canvas(width, height) {
  const c = new OffscreenCanvas(width, height);
  return { c, ctx: c.getContext('2d', { willReadFrequently: true }) };
}

/** Pixels as a float tensor in BGR channel order (as the models were trained). */
function toTensor(imageData, mean, std) {
  const { data, width, height } = imageData;
  const size = width * height;
  const out = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    out[i] = (b - mean[0]) / std[0];
    out[size + i] = (g - mean[1]) / std[1];
    out[2 * size + i] = (r - mean[2]) / std[2];
  }
  return new ort.Tensor('float32', out, [1, 3, height, width]);
}

/* ---------- Detection ---------- */

/** Convex hull (Andrew's monotone chain) of integer points. */
function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Smallest rotated rectangle around a hull: centre, width (along angle), height, angle. */
function minAreaRect(h) {
  if (h.length === 1) return { cx: h[0][0], cy: h[0][1], w: 1, h: 1, angle: 0 };
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const [x1, y1] = h[i];
    const [x2, y2] = h[(i + 1) % h.length];
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const [x, y] of h) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const u = (minU + maxU) / 2;
      const v = (minV + maxV) / 2;
      best = { area, cx: u * cos - v * sin, cy: u * sin + v * cos, w: maxU - minU, h: maxV - minV, angle };
    }
  }
  // Keep text lines horizontal-ish: width is the longer side.
  if (best.h > best.w) best = { ...best, w: best.h, h: best.w, angle: best.angle + Math.PI / 2 };
  // Normalise the angle to (-90°, 90°] so text isn't read upside down.
  while (best.angle > Math.PI / 2) best.angle -= Math.PI;
  while (best.angle <= -Math.PI / 2) best.angle += Math.PI;
  return best;
}

async function detect(bitmap, det) {
  const scale = Math.min(1, DET_LIMIT / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(32, Math.round((bitmap.width * scale) / 32) * 32);
  const height = Math.max(32, Math.round((bitmap.height * scale) / 32) * 32);
  const { ctx } = canvas(width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  const input = toTensor(ctx.getImageData(0, 0, width, height), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
  const output = await det.run({ [det.inputNames[0]]: input });
  const prob = output[det.outputNames[0]].data;

  // Connected regions above the threshold are text lines.
  const label = new Int32Array(width * height);
  const boxes = [];
  const stack = [];
  for (let start = 0; start < width * height; start++) {
    if (label[start] || prob[start] <= DET_THRESHOLD) continue;
    const points = [];
    let sum = 0;
    label[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const x = i % width;
      const y = (i - x) / width;
      points.push([x, y]);
      sum += prob[i];
      if (x > 0 && !label[i - 1] && prob[i - 1] > DET_THRESHOLD) { label[i - 1] = 1; stack.push(i - 1); }
      if (x < width - 1 && !label[i + 1] && prob[i + 1] > DET_THRESHOLD) { label[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !label[i - width] && prob[i - width] > DET_THRESHOLD) { label[i - width] = 1; stack.push(i - width); }
      if (y < height - 1 && !label[i + width] && prob[i + width] > DET_THRESHOLD) { label[i + width] = 1; stack.push(i + width); }
    }
    if (points.length < 9 || sum / points.length < BOX_THRESHOLD) continue;
    // Pixel corners, so a one-pixel-wide region still has an area.
    const corners = [];
    for (const [x, y] of points) corners.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
    const rect = minAreaRect(hull(corners));
    const grow = (rect.w * rect.h * UNCLIP) / Math.max(1, 2 * (rect.w + rect.h));
    const sx = bitmap.width / width;
    const sy = bitmap.height / height;
    const box = { cx: rect.cx * sx, cy: rect.cy * sy, w: (rect.w + 2 * grow) * sx, h: (rect.h + 2 * grow) * sy, angle: rect.angle };
    if (box.h < 6) continue;
    boxes.push(box);
  }
  return boxes;
}

/* ---------- Recognition ---------- */

/** Cut a rotated box out of the image, straightened. */
function cutOut(bitmap, box) {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const { c, ctx } = canvas(w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-box.angle);
  ctx.drawImage(bitmap, -box.cx, -box.cy);
  return c;
}

async function recognise(source, rec, chars) {
  const width = Math.min(REC_MAX_WIDTH, Math.max(16, Math.ceil((REC_HEIGHT * source.width) / source.height)));
  const { ctx } = canvas(width, REC_HEIGHT);
  ctx.drawImage(source, 0, 0, width, REC_HEIGHT);
  const input = toTensor(ctx.getImageData(0, 0, width, REC_HEIGHT), [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  const output = await rec.run({ [rec.inputNames[0]]: input });
  const tensor = output[rec.outputNames[0]];
  const [, steps, classes] = tensor.dims;
  const data = tensor.data;
  let text = '';
  let last = 0;
  let confidence = 0;
  let count = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestScore = -Infinity;
    const offset = t * classes;
    for (let k = 0; k < classes; k++) {
      if (data[offset + k] > bestScore) { bestScore = data[offset + k]; best = k; }
    }
    if (best !== 0 && best !== last) {
      text += chars[best] || '';
      confidence += bestScore;
      count++;
    }
    last = best;
  }
  return { text, confidence: count ? confidence / count : 0 };
}

async function read(bitmap) {
  const { det, rec, chars } = await load();
  const boxes = await detect(bitmap, det);
  const lines = [];
  for (const box of boxes) {
    const { text, confidence } = await recognise(cutOut(bitmap, box), rec, chars);
    const clean = text.trim();
    if (!clean) continue;
    lines.push({
      text: clean,
      height: box.h,
      top: box.cy - box.h / 2,
      left: box.cx - (box.w / 2) * Math.abs(Math.cos(box.angle)),
      confidence: Math.round(confidence * 100)
    });
  }
  // Reading order: top to bottom, then left to right within a row.
  lines.sort((a, b) => (Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2 ? a.left - b.left : a.top - b.top));
  return lines;
}

self.onmessage = async (event) => {
  const { type, id, bitmap } = event.data || {};
  try {
    if (type === 'load') {
      await load();
      self.postMessage({ type: 'loaded' });
    } else if (type === 'read') {
      const lines = await read(bitmap);
      if (bitmap.close) bitmap.close();
      self.postMessage({ type: 'lines', id, lines });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  }
};
