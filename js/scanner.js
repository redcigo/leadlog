/**
 * Camera QR scanning. Safari on iPhone has no built-in barcode detector for
 * web apps, so frames are decoded with jsQR in a Web Worker.
 */

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./qr-worker.js', import.meta.url));
    worker.onmessage = (event) => {
      const resolve = pending.get(event.data.id);
      if (resolve) {
        pending.delete(event.data.id);
        resolve(event.data.text);
      }
    };
  }
  return worker;
}

/** Decode one frame of pixels. Resolves to the text or null. */
function decode(imageData, thorough) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage(
      { id, width: imageData.width, height: imageData.height, buffer: imageData.data.buffer, thorough },
      [imageData.data.buffer]
    );
  });
}

/** Draw a source into a canvas no larger than maxSide and return its pixels. */
function pixelsFrom(source, sourceWidth, sourceHeight, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Live camera scanner bound to a <video> element.
 * Usage: const s = new CameraScanner(video, onCode); await s.start(); s.stop();
 */
export class CameraScanner {
  /** @param {HTMLVideoElement} video @param {(text: string) => void} onCode */
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.running = false;
    this.busy = false;
  }

  /** @returns {Promise<'ok'|'denied'|'unavailable'>} */
  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'unavailable';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch (err) {
      return err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'unavailable';
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    try { await this.video.play(); } catch { /* autoplay can need a tap on some devices */ }
    this.running = true;
    this.loop();
    return 'ok';
  }

  loop() {
    if (!this.running) return;
    const video = this.video;
    if (!this.busy && video.readyState >= 2 && video.videoWidth) {
      this.busy = true;
      const frame = pixelsFrom(video, video.videoWidth, video.videoHeight, 720);
      decode(frame, false).then((text) => {
        this.busy = false;
        if (text && this.running) {
          this.stop();
          this.onCode(text);
        }
      });
    }
    requestAnimationFrame(() => this.loop());
  }

  stop() {
    this.running = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }
}

/** Decode a QR code from a photo file. Resolves to the text or null. */
export async function decodeImageFile(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  // Try a sharp large version first, then a smaller one (helps with noisy photos).
  for (const side of [1600, 900]) {
    const text = await decode(pixelsFrom(bitmap, bitmap.width, bitmap.height, side), true);
    if (text) { bitmap.close && bitmap.close(); return text; }
  }
  bitmap.close && bitmap.close();
  return null;
}

/** Downscale a photo for storage: JPEG, longest side 1600 px. */
export async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process photo'))), 'image/jpeg', 0.82);
  });
}
