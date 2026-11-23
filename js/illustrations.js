/**
 * Line illustrations for empty screens, the welcome screen and the camera
 * screens. Built with DOM calls; colours come from CSS classes so they follow
 * light and dark mode:
 *   line    outline strokes            surface  card and wall fills
 *   accent  brand colour fills         soft     pale brand fills
 *   glow    background shape           faint    secondary strokes
 *   ink     small solid details        spark    decorative sparkles
 */

const NS = 'http://www.w3.org/2000/svg';

/** Each part: [tag, classes, attributes]. */
const DRAWINGS = {
  // A conference badge on a lanyard.
  badge: [
    ['circle', 'glow', { cx: 120, cy: 86, r: 66 }],
    ['path', 'soft line', { d: 'M88 2l22 44h6L100 2z' }],
    ['path', 'soft line', { d: 'M152 2l-22 44h-6l16-44z' }],
    ['g', 'sway', {}, [
      ['rect', 'surface line', { x: 110, y: 40, width: 20, height: 14, rx: 4 }],
      ['rect', 'surface line', { x: 78, y: 52, width: 84, height: 100, rx: 14 }],
      ['rect', 'soft', { x: 108, y: 60, width: 24, height: 4, rx: 2 }],
      ['circle', 'soft line', { cx: 120, cy: 84, r: 13 }],
      ['circle', 'ink', { cx: 120, cy: 81, r: 4.5 }],
      ['path', 'ink', { d: 'M111.5 93.5c1.6-4.4 4.8-6.5 8.5-6.5s6.9 2.1 8.5 6.5a12.6 12.6 0 0 1-17 0z' }],
      ['path', 'faint', { d: 'M100 108h40' }],
      ['path', 'faint', { d: 'M107 116h26' }],
      ['rect', 'line', { x: 107, y: 124, width: 26, height: 22, rx: 3 }],
      ['rect', 'ink', { x: 110, y: 127, width: 6, height: 6, rx: 1 }],
      ['rect', 'ink', { x: 124, y: 127, width: 6, height: 6, rx: 1 }],
      ['rect', 'ink', { x: 110, y: 137, width: 6, height: 6, rx: 1 }],
      ['rect', 'accent', { x: 119, y: 134, width: 4, height: 4, rx: 0.8 }],
      ['rect', 'accent', { x: 125, y: 139, width: 4, height: 4, rx: 0.8 }]
    ]],
    ['path', 'spark', { d: 'M56 46v10M51 51h10' }],
    ['path', 'spark', { d: 'M186 64v8M182 68h8' }],
    ['circle', 'accent', { cx: 178, cy: 126, r: 3 }],
    ['circle', 'accent', { cx: 62, cy: 120, r: 2.5 }]
  ],

  // An exhibition stand: back wall, screen, counter and a roll-up banner.
  stand: [
    ['ellipse', 'glow', { cx: 120, cy: 146, rx: 104, ry: 9 }],
    ['rect', 'surface line', { x: 44, y: 20, width: 150, height: 116, rx: 7 }],
    ['path', 'accent line', { d: 'M51 20h136a7 7 0 0 1 7 7v15H44V27a7 7 0 0 1 7-7z' }],
    ['path', 'faint', { d: 'M96 31h46' }],
    ['circle', 'soft line', { cx: 76, cy: 70, r: 13 }],
    ['path', 'line', { d: 'M70 72.5c2.2-5.6 9.8-5.6 12 0' }],
    ['circle', 'ink', { cx: 76, cy: 66.5, r: 2.6 }],
    ['rect', 'soft line', { x: 108, y: 54, width: 66, height: 38, rx: 5 }],
    ['path', 'line', { d: 'M118 82v-8M128 82V68M138 82v-5M148 82V64M158 82v-10' }],
    ['rect', 'accent line', { x: 56, y: 96, width: 128, height: 9, rx: 3 }],
    ['rect', 'surface line', { x: 62, y: 105, width: 116, height: 31, rx: 3 }],
    ['path', 'faint', { d: 'M74 118h40M74 126h28' }],
    ['rect', 'soft line', { x: 150, y: 84, width: 11, height: 12, rx: 2 }],
    ['rect', 'surface line', { x: 163, y: 87, width: 9, height: 9, rx: 2 }],
    ['rect', 'surface line', { x: 202, y: 38, width: 26, height: 98, rx: 3 }],
    ['rect', 'accent', { x: 207, y: 46, width: 16, height: 16, rx: 3 }],
    ['path', 'faint', { d: 'M208 72h14M208 80h14M208 88h9' }],
    ['path', 'line', { d: 'M198 138h34' }],
    ['path', 'surface line', { d: 'M18 116h22l-3 22H21z' }],
    ['path', 'soft line', { d: 'M29 116c-9-6-11-16-6-24 6 4 8 14 6 24zM29 116c3-11 10-17 18-17-1 9-9 16-18 17zM29 116c-1-13 2-24 9-30 3 10-1 22-9 30z' }],
    ['path', 'spark', { d: 'M24 34v9M19.5 38.5h9' }]
  ],

  // A phone with a viewfinder around a QR code.
  camera: [
    ['circle', 'glow', { cx: 120, cy: 80, r: 70 }],
    ['rect', 'surface line', { x: 82, y: 8, width: 76, height: 144, rx: 16 }],
    ['rect', 'soft', { x: 107, y: 16, width: 26, height: 6, rx: 3 }],
    ['path', 'accent-line', { d: 'M96 62v-8a6 6 0 0 1 6-6h8M130 48h8a6 6 0 0 1 6 6v8M144 96v8a6 6 0 0 1-6 6h-8M110 110h-8a6 6 0 0 1-6-6v-8' }],
    ['rect', 'ink', { x: 106, y: 58, width: 10, height: 10, rx: 2 }],
    ['rect', 'ink', { x: 124, y: 58, width: 10, height: 10, rx: 2 }],
    ['rect', 'ink', { x: 106, y: 90, width: 10, height: 10, rx: 2 }],
    ['rect', 'accent', { x: 121, y: 75, width: 5, height: 5, rx: 1 }],
    ['rect', 'accent', { x: 128, y: 82, width: 5, height: 5, rx: 1 }],
    ['rect', 'accent', { x: 121, y: 89, width: 5, height: 5, rx: 1 }],
    ['rect', 'accent', { x: 129, y: 93, width: 5, height: 5, rx: 1 }],
    ['rect', 'accent', { x: 111, y: 77, width: 5, height: 5, rx: 1 }],
    ['path', 'faint', { d: 'M104 128h32' }],
    ['path', 'spark', { d: 'M56 40v10M51 45h10' }],
    ['path', 'spark', { d: 'M184 110v8M180 114h8' }],
    ['circle', 'accent', { cx: 184, cy: 44, r: 3 }]
  ],

  // Two phones passing leads to each other.
  exchange: [
    ['ellipse', 'glow', { cx: 120, cy: 80, rx: 104, ry: 64 }],
    ['rect', 'surface line', { x: 28, y: 22, width: 60, height: 116, rx: 13 }],
    ['rect', 'surface line', { x: 152, y: 22, width: 60, height: 116, rx: 13 }],
    ['rect', 'soft', { x: 48, y: 29, width: 20, height: 5, rx: 2.5 }],
    ['rect', 'soft', { x: 172, y: 29, width: 20, height: 5, rx: 2.5 }],
    ['rect', 'soft line', { x: 38, y: 46, width: 40, height: 14, rx: 4 }],
    ['rect', 'soft line', { x: 38, y: 66, width: 40, height: 14, rx: 4 }],
    ['rect', 'soft line', { x: 38, y: 86, width: 40, height: 14, rx: 4 }],
    ['rect', 'soft line', { x: 162, y: 46, width: 40, height: 14, rx: 4 }],
    ['rect', 'accent line', { x: 162, y: 66, width: 40, height: 14, rx: 4 }],
    ['path', 'line', { d: 'M98 62c12-12 32-12 44 0' }],
    ['path', 'line', { d: 'M136 54l6 8-9.5 2' }],
    ['path', 'line', { d: 'M142 98c-12 12-32 12-44 0' }],
    ['path', 'line', { d: 'M104 106l-6-8 9.5-2' }],
    ['rect', 'accent line', { x: 110, y: 70, width: 20, height: 20, rx: 5 }],
    ['path', 'surface-line', { d: 'M115 80.5l3.5 3.5 6.5-7' }],
    ['path', 'spark', { d: 'M120 22v9M115.5 26.5h9' }]
  ],

  // A small report with bars.
  report: [
    ['circle', 'glow', { cx: 120, cy: 82, r: 68 }],
    ['rect', 'surface line', { x: 54, y: 22, width: 132, height: 112, rx: 14 }],
    ['path', 'faint', { d: 'M70 40h44' }],
    ['rect', 'soft line', { x: 72, y: 86, width: 14, height: 32, rx: 3 }],
    ['rect', 'soft line', { x: 96, y: 70, width: 14, height: 48, rx: 3 }],
    ['rect', 'accent line', { x: 120, y: 56, width: 14, height: 62, rx: 3 }],
    ['rect', 'soft line', { x: 144, y: 78, width: 14, height: 40, rx: 3 }],
    ['path', 'line', { d: 'M66 118h108' }],
    ['path', 'spark', { d: 'M200 40v10M195 45h10' }],
    ['circle', 'accent', { cx: 40, cy: 112, r: 3 }]
  ]
};

function build(parent, parts) {
  for (const [tag, classes, attrs, children] of parts) {
    const node = document.createElementNS(NS, tag);
    if (classes) node.setAttribute('class', classes.split(' ').map((c) => `ill-${c}`).join(' '));
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (children) build(node, children);
    parent.append(node);
  }
}

/**
 * @param {keyof typeof DRAWINGS} name
 * @param {string} [className] extra class, e.g. 'small'
 */
export function illustration(name, className) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 160');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `illustration${className ? ` ${className}` : ''}`);
  build(svg, DRAWINGS[name] || []);
  return svg;
}
