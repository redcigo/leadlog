/**
 * Line icons drawn for this app (24×24, stroke-based), built with DOM calls
 * so no markup strings are parsed at runtime.
 */

const CIRCLE = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';

const PATHS = {
  // Tab bar
  capture: ['M4 7V5a1 1 0 0 1 1-1h2', 'M17 4h2a1 1 0 0 1 1 1v2', 'M20 17v2a1 1 0 0 1-1 1h-2', 'M7 20H5a1 1 0 0 1-1-1v-2', 'M12 8v8', 'M8 12h8'],
  leads: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  report: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],

  // Actions
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 14h2', 'M14 18h2', 'M18 18h2v2', 'M20 16v0'],
  personAdd: ['M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M19 8v6', 'M16 11h6'],
  plus: ['M12 5v14', 'M5 12h14'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronLeft: ['M15 5l-7 7 7 7'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  checkCircle: [CIRCLE, 'M8 12.2l2.7 2.7L16 9.6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  camera: ['M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  share: ['M12 15V3', 'M8 7l4-4 4 4', 'M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8'],
  minusCircle: [CIRCLE, 'M8 12h8'],
  grip: ['M4 8h16', 'M4 12h16', 'M4 16h16'],
  image: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 16l4.5-4.5 4 4 2.5-2.5L20 18', 'M15.5 8.5h.01'],
  listImport: ['M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z', 'M14 3v5h5', 'M12 11v6', 'M9 14l3 3 3-3'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],

  // Settings
  send: ['M21 3L10 14', 'M21 3l-7 18-4-7-7-4z'],
  merge: ['M6 3v4c0 3.5 2.5 5.5 6 6.5', 'M18 3v4c0 3.5-2.5 5.5-6 6.5', 'M12 13.5V21', 'M8.5 17.5L12 21l3.5-3.5'],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6'],
  building: ['M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16', 'M15 10h3a1 1 0 0 1 1 1v10', 'M3 21h18', 'M9 8h2', 'M9 12h2', 'M9 16h2'],
  globe: [CIRCLE, 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'],
  calendar: ['M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  tag: ['M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z', 'M8 8h.01'],
  gradcap: ['M2 9l10-5 10 5-10 5z', 'M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5', 'M22 9v6'],
  checklist: ['M11 6h9', 'M11 12h9', 'M11 18h9', 'M3.5 6l1.5 1.5L7.5 5', 'M3.5 12l1.5 1.5 2.5-2.5', 'M3.5 18l1.5 1.5 2.5-2.5'],
  backup: ['M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9', 'M12 15V3', 'M8 7l4-4 4 4'],
  restore: ['M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5', 'M12 3v12', 'M8 11l4 4 4-4'],
  storage: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  info: [CIRCLE, 'M12 11v5', 'M12 7.6h.01'],
  doc: ['M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6']
};

const BOLD = new Set(['check', 'chevronRight', 'chevronDown', 'chevronLeft']);
const NS = 'http://www.w3.org/2000/svg';

/** @param {keyof typeof PATHS} name @param {string} [className] */
export function icon(name, className) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', BOLD.has(name) ? '2.4' : '1.9');
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

/**
 * A small rounded square with a white symbol, as in iPhone Settings.
 * @param {keyof typeof PATHS} name @param {string} colour one of the tile colour classes (green, blue, grey…)
 */
export function iconTile(name, colour) {
  const tile = document.createElement('span');
  tile.className = `icon-tile ${colour}`;
  tile.setAttribute('aria-hidden', 'true');
  tile.append(icon(name));
  return tile;
}
