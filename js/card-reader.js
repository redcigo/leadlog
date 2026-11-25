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
        for (const part of splitColumns(line)) if (part) lines.push(part);
      }
    }
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

/**
 * Cards often print two columns side by side (phone on the left, address on the
 * right). The reader returns them as one line; a wide gap between words splits them.
 */
function splitColumns(line) {
  const words = (line.words || []).filter((w) => w.text && w.text.trim());
  if (!words.length) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    return text ? [{ text, height: line.bbox.y1 - line.bbox.y0, top: line.bbox.y0, left: line.bbox.x0, confidence: line.confidence }] : [];
  }
  const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  const groups = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
    if (gap > height * 1.8) groups.push([]);
    groups[groups.length - 1].push(words[i]);
  }
  return groups.map((group) => {
    // Drop vertical bars and dots used as decoration ("|", "•").
    const text = group.map((w) => w.text).join(' ').replace(/^[|¦!Il•·*]\s+/, '').replace(/\s+[|¦•·*]$/, '').trim();
    if (!text || /^[|¦•·*]+$/.test(text)) return null;
    return {
      text,
      height,
      top: Math.min(...group.map((w) => w.bbox.y0)),
      left: group[0].bbox.x0,
      confidence: group.reduce((sum, w) => sum + w.confidence, 0) / group.length
    };
  });
}
