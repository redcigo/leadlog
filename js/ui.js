/**
 * Shared interface building blocks: element helper, motion, press feedback,
 * toasts, the confirmation HUD, action sheets, modal sheets with drag to
 * dismiss, pushed pages with swipe back, and grouped-list rows.
 */

import { t } from './i18n.js';
import { icon, iconTile } from './icons.js';

/* ---------- DOM helper ---------- */

/**
 * Create an element. attrs: class, text, on<Event> handlers, value, checked
 * and any other attribute. Children can be nodes, strings or (nested) arrays.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'value') el.value = value;
      else if (key === 'checked') el.checked = Boolean(value);
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/* ---------- Motion ---------- */

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => reduceQuery.matches;

/**
 * A spring as a CSS linear() easing curve. bounce 0 settles without
 * overshooting; 0.2 overshoots a little, like iOS controls.
 */
function springCurve(bounce) {
  const zeta = 1 - bounce;
  const steps = 60;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    let x;
    if (zeta >= 1) {
      const w = 9;
      x = 1 - Math.exp(-w * tt) * (1 + w * tt);
    } else {
      const w = 6.4 / zeta;
      const wd = w * Math.sqrt(1 - zeta * zeta);
      x = 1 - Math.exp(-zeta * w * tt) * (Math.cos(wd * tt) + ((zeta * w) / wd) * Math.sin(wd * tt));
    }
    points.push(i === steps ? 1 : Math.round(x * 10000) / 10000);
  }
  return `linear(${points.join(', ')})`;
}

const supportsLinear = window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)');
export const SPRING = supportsLinear ? springCurve(0.22) : 'cubic-bezier(0.3, 1.25, 0.5, 1)';
const SPRING_SOFT = supportsLinear ? springCurve(0.08) : 'cubic-bezier(0.32, 0.72, 0, 1)';
export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Apply the spring curves to the style sheet's motion variables. */
export function installMotion() {
  document.documentElement.style.setProperty('--spring', SPRING);
  document.documentElement.style.setProperty('--spring-soft', SPRING_SOFT);
  installPressFeedback();
}

/**
 * Web Animations helper. With Reduce Motion on, only opacity changes are kept.
 * @returns {Promise<void>} resolves when finished (or immediately when skipped)
 */
export function animate(el, keyframes, options = {}) {
  if (!el || typeof el.animate !== 'function') return Promise.resolve();
  let frames = keyframes;
  let opts = { duration: 300, easing: EASE_IOS, ...options };
  if (reducedMotion()) {
    frames = keyframes.map((k) => ('opacity' in k ? { opacity: k.opacity } : {}));
    if (!frames.some((k) => 'opacity' in k)) return Promise.resolve();
    opts = { ...opts, duration: Math.min(opts.duration, 160), easing: 'ease', delay: 0 };
  }
  try {
    return el.animate(frames, opts).finished.then(() => {}, () => {});
  } catch {
    return Promise.resolve();
  }
}

/** Collapse an element's height to nothing, then run done(). */
export async function collapse(el, done) {
  if (el && el.isConnected) {
    const height = el.getBoundingClientRect().height;
    el.classList.add('collapsing');
    await animate(el, [
      { height: `${height}px`, opacity: 1, minHeight: '0px', paddingTop: getComputedStyle(el).paddingTop, paddingBottom: getComputedStyle(el).paddingBottom },
      { height: '0px', opacity: 0, minHeight: '0px', paddingTop: '0px', paddingBottom: '0px' }
    ], { duration: 280, easing: EASE_IOS, fill: 'forwards' });
  }
  if (done) await done();
}

/** Count a number up (or down) in an element. */
export function countUp(el, from, to) {
  if (from === to || reducedMotion()) { el.textContent = String(to); return; }
  const start = performance.now();
  const duration = Math.min(900, 380 + Math.abs(to - from) * 40);
  el.textContent = String(from);
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Press feedback ---------- */
/* iOS Safari doesn't apply :active reliably, so a class is set while a finger is down. */

const PRESSABLE = 'button, label.row, .row.tappable';

function installPressFeedback() {
  document.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    const target = event.target.closest(PRESSABLE);
    if (!target || target.disabled) return;
    const started = performance.now();
    if (target.classList.contains('glass')) {
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--px', `${event.clientX - rect.left}px`);
      target.style.setProperty('--py', `${event.clientY - rect.top}px`);
    }
    target.classList.add('pressed');
    const tabbar = target.closest('.tabbar');
    if (tabbar) tabbar.classList.add('pressing');
    const release = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      // Keep the pressed look long enough to be seen on a quick tap.
      setTimeout(() => {
        target.classList.remove('pressed');
        if (tabbar) tabbar.classList.remove('pressing');
      }, Math.max(0, 90 - (performance.now() - started)));
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }, { passive: true });
}

/* ---------- Toast and HUD ---------- */

let toastTimer = null;

/** Short message above the tab bar, with an optional action button. */
export function toast(message, action) {
  const el = document.getElementById('toast');
  const show = () => {
    el.textContent = '';
    el.append(h('span', { text: message }));
    if (action) el.append(h('button', { type: 'button', text: action.label, onClick: () => { hideToast(); action.run(); } }));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 5000 : 2400);
  };
  if (el.classList.contains('show')) { el.classList.remove('show'); setTimeout(show, 180); } else show();
}

export function hideToast() {
  document.getElementById('toast').classList.remove('show');
}

/** A short confirmation in the middle of the screen, with a check mark drawing itself. */
export function hud(message) {
  const el = h('div', { class: 'hud glass', role: 'status' }, icon('check'), h('span', { text: message }));
  document.body.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 900);
}

/* ---------- Background recede while sheets are open ---------- */

let openSheets = 0;
function recede(on) {
  openSheets = Math.max(0, openSheets + (on ? 1 : -1));
  if (on && openSheets === 1) {
    document.getElementById('screen').style.setProperty('--recede-origin', `${window.scrollY + window.innerHeight / 2}px`);
  }
  document.body.classList.toggle('receded', openSheets > 0);
}

/* ---------- Action sheet ---------- */

/**
 * iOS-style action sheet.
 * @param {{message?: string, actions: {label: string, destructive?: boolean, value: any}[]}} opts
 * @returns {Promise<any>} the chosen action's value, or null when cancelled
 */
export function actionSheet({ message, actions }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'sheet-backdrop over' });
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      sheet.classList.remove('open');
      backdrop.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { sheet.remove(); backdrop.remove(); }, 340);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const sheet = h('div', { class: 'action-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': message || t('common.choose') },
      h('div', { class: 'group' },
        message ? h('div', { class: 'message', text: message }) : null,
        actions.map((a) => h('button', { type: 'button', class: `row${a.destructive ? ' destructive' : ''}`, text: a.label, onClick: () => close(a.value) }))
      ),
      h('div', { class: 'group' },
        h('button', { type: 'button', class: 'row cancel', text: t('common.cancel'), onClick: () => close(null) })
      )
    );
    backdrop.addEventListener('click', () => close(null));
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop, sheet);
    requestAnimationFrame(() => requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); }));
    const first = sheet.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  });
}

/* ---------- Modal sheet ---------- */

/**
 * Modal sheet with a header (left button, title, right button). It can be
 * closed by dragging it down. When isDirty() is true, closing without saving
 * asks before discarding changes.
 * @returns {{close: () => void, body: HTMLElement, sheet: HTMLElement, setConfirmEnabled: (b: boolean) => void}}
 */
export function openSheet({ title, confirmLabel, onConfirm, onClose, content, isDirty }) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const confirmBtn = confirmLabel
    ? h('button', { type: 'button', class: 'pill-button confirm glass right', text: confirmLabel, onClick: () => onConfirm && onConfirm() })
    : null;
  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-header' },
      h('button', { type: 'button', class: 'pill-button glass left', text: confirmLabel ? t('common.cancel') : t('common.done'), onClick: () => requestClose() }),
      h('h2', { id: titleId, text: title }),
      confirmBtn
    ),
    body
  );
  if (content) append(body, [content]);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    sheet.style.removeProperty('transform');
    backdrop.style.removeProperty('opacity');
    sheet.classList.remove('open', 'dragging');
    sheet.classList.add('closing');
    backdrop.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    recede(false);
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 380);
    if (onClose) onClose();
  }

  async function requestClose() {
    if (isDirty && isDirty()) {
      const discard = await actionSheet({ message: t('common.discard.message'), actions: [{ label: t('common.discard'), destructive: true, value: true }] });
      if (!discard) return;
    }
    close();
  }

  function onKey(e) { if (e.key === 'Escape') requestClose(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', () => requestClose());

  /* Drag down to dismiss: from the header at any time, or from the content when it's scrolled to the top. */
  let drag = null;
  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || closed) return;
    const inHeader = Boolean(e.target.closest('.sheet-header, .sheet-grabber'));
    if (!inHeader && body.scrollTop > 0) return;
    const touch = e.touches[0];
    drag = { x0: touch.clientX, y0: touch.clientY, dy: 0, active: false, inHeader, samples: [{ y: touch.clientY, t: performance.now() }] };
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const touch = e.touches[0];
    const dy = touch.clientY - drag.y0;
    const dx = touch.clientX - drag.x0;
    if (!drag.active) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || (!drag.inHeader && body.scrollTop > 0)) { drag = null; return; }
      drag.active = true;
      sheet.classList.add('dragging');
      if (document.activeElement && body.contains(document.activeElement)) document.activeElement.blur();
    }
    e.preventDefault();
    drag.dy = Math.max(0, dy);
    drag.samples.push({ y: touch.clientY, t: performance.now() });
    if (drag.samples.length > 5) drag.samples.shift();
    sheet.style.transform = `translateY(${drag.dy}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - drag.dy / (sheet.offsetHeight * 0.9)));
  }, { passive: false });
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const velocity = (last.y - first.y) / Math.max(1, last.t - first.t);
    sheet.classList.remove('dragging');
    const dismiss = d.dy > Math.min(160, sheet.offsetHeight * 0.3) || velocity > 0.7;
    if (dismiss && !(isDirty && isDirty())) { close(); return; }
    sheet.style.removeProperty('transform');
    backdrop.style.removeProperty('opacity');
    if (dismiss) requestClose();
  };
  sheet.addEventListener('touchend', endDrag);
  sheet.addEventListener('touchcancel', endDrag);

  document.body.append(backdrop, sheet);
  recede(true);
  requestAnimationFrame(() => requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); }));
  return { close, requestClose, body, sheet, setConfirmEnabled: (b) => { if (confirmBtn) confirmBtn.disabled = !b; } };
}

/* ---------- Pushed pages ---------- */

const pages = [];

/**
 * Push a page over the current screen, as in iPhone Settings. It slides in
 * from the right and goes back with the back button or a swipe from the left edge.
 * @param {{title: string, render: (page: {body: HTMLElement, refresh: () => void}) => Node[], onPop?: () => void}} opts
 */
export function pushPage({ title, render, onPop }) {
  const scroll = h('div', { class: 'page-scroll' });
  const heading = h('h1', { text: title, tabindex: '-1' });
  const page = h('div', { class: 'page', role: 'region', 'aria-label': title },
    h('div', { class: 'page-nav' },
      h('button', { type: 'button', class: 'icon-button glass back', 'aria-label': t('common.back'), onClick: () => popPage() }, icon('chevronLeft')),
      heading),
    scroll);
  const entry = { page, onPop, refresh: () => { scroll.textContent = ''; append(scroll, render(entry)); }, body: scroll };
  entry.refresh();
  const covered = pages.length ? pages[pages.length - 1].page : null;
  pages.push(entry);
  document.body.append(page);
  coverUnderlying(covered, true);
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('in')));
  setTimeout(() => heading.focus({ preventScroll: true }), 450);
  installSwipeBack(entry);
  return entry;
}

function coverUnderlying(covered, on) {
  if (covered) {
    covered.style.transform = on ? 'translateX(-26%)' : '';
    covered.style.filter = on ? 'brightness(0.9)' : '';
  } else {
    document.getElementById('screen').classList.toggle('covered', on);
    document.getElementById('navbar').classList.toggle('covered', on);
  }
}

export function popPage({ instant = false } = {}) {
  const entry = pages.pop();
  if (!entry) return;
  const underneath = pages.length ? pages[pages.length - 1].page : null;
  entry.page.classList.remove('in', 'dragging');
  entry.page.style.removeProperty('transform');
  coverUnderlying(underneath, false);
  if (instant) entry.page.remove();
  else setTimeout(() => entry.page.remove(), 520);
  if (entry.onPop) entry.onPop();
}

export function popAllPages() {
  while (pages.length) popPage({ instant: true });
}

export const pageDepth = () => pages.length;

function installSwipeBack(entry) {
  const { page } = entry;
  let drag = null;
  page.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    if (e.touches.length !== 1 || touch.clientX > 28) return;
    drag = { x0: touch.clientX, y0: touch.clientY, dx: 0, active: false, samples: [{ x: touch.clientX, t: performance.now() }] };
  }, { passive: true });
  page.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const touch = e.touches[0];
    const dx = touch.clientX - drag.x0;
    const dy = touch.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      drag.active = true;
      page.classList.add('dragging');
    }
    e.preventDefault();
    drag.dx = Math.max(0, dx);
    drag.samples.push({ x: touch.clientX, t: performance.now() });
    if (drag.samples.length > 5) drag.samples.shift();
    page.style.transform = `translateX(${drag.dx}px)`;
  }, { passive: false });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const velocity = (last.x - first.x) / Math.max(1, last.t - first.t);
    page.classList.remove('dragging');
    if (d.dx > page.offsetWidth * 0.35 || velocity > 0.5) popPage();
    else page.style.removeProperty('transform');
  };
  page.addEventListener('touchend', end);
  page.addEventListener('touchcancel', end);
}

/* ---------- List building blocks ---------- */

export function section(header, rows, footer, className) {
  return h('section', { class: `section${className ? ` ${className}` : ''}` },
    header ? h('h2', { class: 'section-header', text: header }) : null,
    h('div', { class: 'group' }, rows),
    footer ? h('p', { class: 'section-footer', text: footer }) : null
  );
}

export function fieldRow(id, label, value, opts = {}) {
  return h('div', { class: `row field${opts.tile ? ' with-tile' : ''}` },
    opts.tile ? iconTile(opts.tile[0], opts.tile[1]) : null,
    h('label', { for: id, text: label }),
    h('input', {
      id, type: opts.type || 'text', value: value || '', placeholder: opts.placeholder || '',
      autocomplete: opts.autocomplete || 'off', autocapitalize: opts.autocapitalize || 'sentences',
      inputmode: opts.inputmode, spellcheck: 'false', enterkeyhint: opts.enterkeyhint || 'next',
      required: opts.required, 'aria-required': opts.required ? 'true' : null
    })
  );
}

/** A navigation row: optional icon tile, label, optional value, chevron. */
export function navRow({ tile, label, sub, value, onClick, className }) {
  return h('button', { type: 'button', class: `row${tile ? ' with-tile' : ''}${className ? ` ${className}` : ''}`, onClick },
    tile ? (tile instanceof Node ? tile : iconTile(tile[0], tile[1])) : null,
    h('span', { class: 'row-label' }, label, sub ? h('span', { class: 'row-sub', text: sub }) : null),
    value !== undefined && value !== null ? h('span', { class: 'row-value', text: value }) : null,
    icon('chevronRight', 'row-chevron'));
}

export function switchRow(id, label, checked) {
  return h('label', { class: 'row', for: id },
    h('span', { class: 'row-label', text: label }),
    h('input', { id, type: 'checkbox', role: 'switch', class: 'switch', checked })
  );
}

/** Rows with a check mark that toggle membership in a Set. */
export function checklist(options, selected, onChange) {
  const all = [...options];
  for (const value of selected) if (!all.includes(value)) all.push(value);
  return all.map((option) => {
    const row = h('button', { type: 'button', class: 'row', role: 'checkbox', 'aria-checked': String(selected.has(option)) },
      h('span', { class: 'row-label', text: option }), icon('check', 'check'));
    row.addEventListener('click', () => {
      if (selected.has(option)) selected.delete(option); else selected.add(option);
      row.setAttribute('aria-checked', String(selected.has(option)));
      if (onChange) onChange();
    });
    return row;
  });
}

/** Segmented control with a sliding thumb. */
export function segmented(options, current, onChange, label) {
  const thumb = h('span', { class: 'thumb', 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label }, thumb);
  wrap.style.setProperty('--n', String(options.length));
  const place = (index) => {
    thumb.classList.toggle('none', index < 0);
    wrap.style.setProperty('--i', String(Math.max(0, index)));
  };
  options.forEach((opt, index) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(opt.value === current), text: opt.label });
    b.addEventListener('click', () => {
      for (const other of wrap.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === b));
      place(index);
      onChange(opt.value);
    });
    wrap.append(b);
  });
  place(options.findIndex((o) => o.value === current));
  return wrap;
}
