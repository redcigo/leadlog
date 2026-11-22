/**
 * Line icons drawn for this app (24×24, stroke-based), built with DOM calls
 * so no markup strings are parsed at runtime.
 */

const PATHS = {
  capture: ['M4 7V5a1 1 0 0 1 1-1h2', 'M17 4h2a1 1 0 0 1 1 1v2', 'M20 17v2a1 1 0 0 1-1 1h-2', 'M7 20H5a1 1 0 0 1-1-1v-2', 'M12 8v8', 'M8 12h8'],
  leads: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  report: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 14h2', 'M14 18h2', 'M18 18h2v2', 'M20 16v0'],
  personAdd: ['M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M19 8v6', 'M16 11h6'],
  plus: ['M12 5v14', 'M5 12h14'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  checkCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12.2l2.7 2.7L16 9.6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  camera: ['M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  share: ['M12 15V3', 'M8 7l4-4 4 4', 'M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8'],
  minusCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12h8']
};

const NS = 'http://www.w3.org/2000/svg';

/** @param {keyof typeof PATHS} name */
export function icon(name, className) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'check' || name === 'chevronRight' || name === 'chevronDown' ? '2.4' : '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  for (const d of PATHS[name] || []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
