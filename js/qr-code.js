/**
 * Draws a QR code as an SVG element, using qrcode-generator (MIT, vendored).
 * Text is encoded as UTF-8 so names with accents survive.
 */

import { qrcode } from '../vendor/qrcode.mjs';

const NS = 'http://www.w3.org/2000/svg';

qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

/** @param {string} text @param {'L'|'M'|'Q'|'H'} [level] */
export function qrSvg(text, level = 'M') {
  const qr = qrcode(0, level);
  qr.addData(text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const margin = 2;
  const size = count + margin * 2;
  // One path: a horizontal run of dark modules becomes one rectangle.
  let d = '';
  for (let r = 0; r < count; r++) {
    let c = 0;
    while (c < count) {
      if (qr.isDark(r, c)) {
        const start = c;
        while (c < count && qr.isDark(r, c)) c++;
        d += `M${start + margin} ${r + margin}h${c - start}v1h${start - c}z`;
      } else c++;
    }
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#ffffff');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000000');
  svg.append(bg, path);
  return svg;
}
