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
        resolve(event.data);
      }
    };
  }
  return worker;
}

/** Decode one frame of pixels. Resolves to {text, corners} (text is null when nothing was found). */
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

/** Draw a source into a canvas no larger than maxSide and return its pixels and scale. */
function pixelsFrom(source, sourceWidth, sourceHeight, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  pixels.scale = scale;
  return pixels;
}

/**
 * Live camera scanner bound to a <video> element.
 * Usage: const s = new CameraScanner(video, onCode); await s.start(); s.stop();
 * When a code is found the preview freezes on that frame (so the app can show
 * where the code was) and onCode receives the text and the code's corners in
 * video pixels. Call stop() afterwards to release the camera.
 */
export class CameraScanner {
  /** @param {HTMLVideoElement} video @param {(text: string, corners: {x:number,y:number}[]|null) => void} onCode */
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.running = false;
    this.busy = false;
  }

  /** @returns {Promise<'ok'|'denied'|'unavailable'>} 'denied' means the camera permission was refused. */
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
      const scale = frame.scale;
      decode(frame, false).then(({ text, corners }) => {
        this.busy = false;
        if (text && this.running) {
          this.running = false;
          try { video.pause(); } catch { /* keep going without the freeze */ }
          this.onCode(text, corners ? corners.map((p) => ({ x: p.x / scale, y: p.y / scale })) : null);
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
    const { text } = await decode(pixelsFrom(bitmap, bitmap.width, bitmap.height, side), true);
    if (text) { bitmap.close && bitmap.close(); return text; }
  }
  bitmap.close && bitmap.close();
  return null;
}

/**
 * Downscale a photo for storage: JPEG, longest side maxSide px.
 * With keepTransparency, PNG and other transparent images stay PNG (for logos).
 */
export async function compressPhoto(file, { maxSide = 1600, keepTransparency = false } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const png = keepTransparency && /png|webp|gif|svg/i.test(file.type || '');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process photo'))), png ? 'image/png' : 'image/jpeg', 0.82);
  });
}

/**
 * The camera permission state, where the browser reports it.
 * @returns {Promise<PermissionStatus|null>} null when the browser can't tell (the system asks when the camera starts)
 */
export async function cameraPermission() {
  try {
    if (navigator.permissions && navigator.permissions.query) return await navigator.permissions.query({ name: 'camera' });
  } catch { /* 'camera' isn't a known permission name in this browser */ }
  return null;
}
