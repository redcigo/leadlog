/* Decodes QR codes off the main thread so the camera preview stays smooth. */
/* global jsQR */
'use strict';

importScripts('../vendor/jsqr.js');

/**
 * QR codes store text as bytes, usually UTF-8, but the QR default is ISO-8859-1.
 * jsQR returns an empty string when the bytes aren't valid UTF-8, so decode
 * the raw bytes ourselves: UTF-8 first, then ISO-8859-1.
 */
function textFrom(code) {
  const bytes = Uint8Array.from(code.binaryData || []);
  if (!bytes.length) return code.data || null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
}

self.onmessage = (event) => {
  const { id, width, height, buffer, thorough } = event.data;
  let text = null;
  let corners = null;
  try {
    const pixels = new Uint8ClampedArray(buffer);
    const code = jsQR(pixels, width, height, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' });
    if (code) {
      text = textFrom(code);
      const l = code.location;
      corners = [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner].map((p) => ({ x: p.x, y: p.y }));
    }
  } catch {
    text = null;
  }
  self.postMessage({ id, text: text || null, corners: text ? corners : null });
};
