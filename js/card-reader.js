/**
 * Reads the text on a business card photo, on the device.
 * Uses Tesseract (vendored in vendor/tesseract); nothing is sent anywhere.
 * The engine is loaded the first time it's needed and then kept for the session.
 */

const base = new URL('../vendor/tesseract/', import.meta.url).href;
let enginePromise = null;
let active = 0;

/** Start (or reuse) the text recognition engine. */
export function loadReader(onProgress, { langs = ['ces', 'eng'], psm = '3' } = {}) {
  if (!enginePromise) {
    enginePromise = import('../vendor/tesseract/tesseract.esm.min.js')
      .then(({ default: Tesseract }) => Tesseract.createWorker(langs, 1, {
        workerPath: `${base}worker.min.js`,
        corePath: `${base}core/`,
        langPath: `${base}lang`,
        workerBlobURL: false,
        gzip: true,
        cacheMethod: 'none',
        logger: (m) => { if (onProgress) onProgress(m); }
      }).then(async (worker) => {
        await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1', user_defined_dpi: '300' });
        return { worker, Tesseract };
      }));
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

/** Stop the engine to free memory (unless it is reading); it starts again on the next use. */
export async function closeReader() {
  if (active) return;
  const engine = enginePromise;
  enginePromise = null;
  if (engine) {
    try { (await engine).worker.terminate(); } catch { /* already gone */ }
  }
}

/**
 * Recognise the text lines on an image (canvas, image bitmap, blob).
 * @returns {Promise<{text: string, height: number, top: number, left: number, confidence: number}[]>}
 */
export async function readLines(image) {
  active++;
  let data;
  try {
    const { worker } = await loadReader();
    ({ data } = await worker.recognize(image, {}, { blocks: true, text: true }));
  } finally {
    active--;
  }
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = line.text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const words = line.words || [];
        const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
        lines.push({
          text,
          height: heights.length ? heights[Math.floor(heights.length / 2)] : line.bbox.y1 - line.bbox.y0,
          top: line.bbox.y0,
          left: line.bbox.x0,
          confidence: line.confidence
        });
      }
    }
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}
