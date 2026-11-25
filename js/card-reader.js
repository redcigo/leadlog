/**
 * Reads the text on a business card photo, on the device.
 * Uses PaddleOCR models with ONNX Runtime (vendored in vendor/), run in a
 * background thread (ocr-worker.js); nothing is sent anywhere.
 * The engine is loaded the first time it's needed and then kept for the session.
 */

let worker = null;
let ready = null;
let active = 0;
let nextId = 1;
const pending = new Map();

function startWorker() {
  worker = new Worker(new URL('./ocr-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'loaded') return;
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.type === 'lines') job.resolve(data.lines);
    else job.reject(new Error(data.message || 'Card reading failed'));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    const error = new Error(event.message || 'Card reader stopped');
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    stopWorker();
  };
}

function stopWorker() {
  if (worker) worker.terminate();
  worker = null;
  ready = null;
}

/** Start (or reuse) the text recognition engine. onProgress gets {status, progress}. */
export function loadReader(onProgress) {
  if (!ready) {
    if (!worker) startWorker();
    if (onProgress) onProgress({ status: 'loading', progress: 0 });
    ready = new Promise((resolve, reject) => {
      const id = 0;
      const onMessage = ({ data }) => {
        if (data.type === 'loaded') { worker.removeEventListener('message', onMessage); resolve(); }
        else if (data.type === 'error' && data.id === id) { worker.removeEventListener('message', onMessage); reject(new Error(data.message)); }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'load', id });
    });
    ready.then(() => { if (onProgress) onProgress({ status: 'ready', progress: 1 }); }, () => stopWorker());
  }
  return ready;
}

/** Stop the engine to free memory (unless it is reading); it starts again on the next use. */
export function closeReader() {
  if (!active) stopWorker();
}

/**
 * Recognise the text lines on an image (canvas, image bitmap, blob).
 * @returns {Promise<{text: string, height: number, top: number, left: number, confidence: number}[]>}
 */
export async function readLines(image) {
  active++;
  try {
    await loadReader();
    const bitmap = await createImageBitmap(image);
    const id = nextId++;
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'read', id, bitmap }, [bitmap]);
    });
  } finally {
    active--;
  }
}
