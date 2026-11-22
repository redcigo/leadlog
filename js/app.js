/**
 * LeadLog: capture leads at exhibitions and career fairs.
 * All data stays on the device (IndexedDB). The app makes no network requests
 * of its own; the service worker only serves the app's own files.
 */

import * as store from './db.js';
import { t, setLanguage, language, LANGUAGES } from './i18n.js';
import { icon } from './icons.js';
import { parseContact } from './contact-parser.js';
import { CameraScanner, decodeImageFile, compressPhoto } from './scanner.js';
import { buildXlsx, buildCsv, shareFile, fileSafe } from './export.js';

export const APP_VERSION = '1.0.0';

/* ---------- Defaults (neutral; edit them in Settings) ---------- */

const DEFAULT_OPTIONS = {
  en: {
    business: ['Products', 'Services', 'Partnership', 'Becoming a supplier', 'Careers'],
    career: ['Internship', 'Part-time job', 'Full-time job', 'Thesis topic', 'Summer job'],
    followups: ['Reach out by email', 'Send information', 'Arrange a meeting', 'Call back', 'Pass to a colleague']
  },
  cs: {
    business: ['Produkty', 'Služby', 'Spolupráce', 'Stát se dodavatelem', 'Kariéra'],
    career: ['Stáž', 'Brigáda', 'Plný úvazek', 'Téma závěrečné práce', 'Letní brigáda'],
    followups: ['Napsat e-mail', 'Poslat informace', 'Domluvit schůzku', 'Zavolat zpět', 'Předat kolegovi']
  }
};

/* ---------- State ---------- */

const state = {
  settings: { language: 'auto', company: '', options: null },
  shows: [],
  showId: null,
  leads: [],
  photoUrls: new Map(),
  tab: 'capture',
  leadFilter: 'all',
  search: ''
};

const $root = document.getElementById('screen');
const $navbar = document.getElementById('navbar');
const $navTitle = document.getElementById('nav-title');
const $tabbar = document.getElementById('tabbar');

/* ---------- DOM helper ---------- */

/**
 * Create an element. attrs: class, text, on<Event> handlers, dataset via data-*,
 * aria-* and any other attribute. Children can be nodes, strings or arrays.
 */
function h(tag, attrs, ...children) {
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
function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/* ---------- Formatting ---------- */

const locale = () => (language() === 'cs' ? 'cs-CZ' : 'en-GB');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const fmtDayLong = (iso) => new Date(iso).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayKey = () => dayKey(new Date().toISOString());
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/* ---------- Shared UI: toast, action sheet, sheet ---------- */

let toastTimer = null;
function toast(message, action) {
  const el = document.getElementById('toast');
  el.textContent = '';
  el.append(h('span', { text: message }));
  if (action) {
    el.append(h('button', { type: 'button', text: action.label, onClick: () => { hideToast(); action.run(); } }));
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2200);
}
function hideToast() { document.getElementById('toast').classList.remove('show'); }

/**
 * iOS-style action sheet.
 * @param {{message?: string, actions: {label: string, destructive?: boolean, value: any}[]}} opts
 * @returns {Promise<any>} the chosen action's value, or null when cancelled
 */
function actionSheet({ message, actions }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'sheet-backdrop over' });
    const close = (value) => {
      sheet.classList.remove('open');
      backdrop.classList.remove('open');
      setTimeout(() => { sheet.remove(); backdrop.remove(); }, 300);
      resolve(value);
    };
    const sheet = h('div', { class: 'action-sheet', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'group glass' },
        message ? h('div', { class: 'message', text: message }) : null,
        actions.map((a) => h('button', { type: 'button', class: `row${a.destructive ? ' destructive' : ''}`, text: a.label, onClick: () => close(a.value) }))
      ),
      h('div', { class: 'group glass' },
        h('button', { type: 'button', class: 'row cancel', text: t('common.cancel'), onClick: () => close(null) })
      )
    );
    backdrop.addEventListener('click', () => close(null));
    document.body.append(backdrop, sheet);
    requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); });
  });
}

/**
 * Modal sheet with a header (left button, title, right button).
 * @returns {{close: () => void, body: HTMLElement, setConfirmEnabled: (b: boolean) => void}}
 */
function openSheet({ title, confirmLabel, onConfirm, onClose, content }) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const confirmBtn = confirmLabel
    ? h('button', { type: 'button', class: 'pill-button confirm glass right', text: confirmLabel, onClick: () => onConfirm && onConfirm() })
    : null;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grabber' }),
    h('div', { class: 'sheet-header' },
      h('button', { type: 'button', class: 'pill-button glass left', text: confirmLabel ? t('common.cancel') : t('common.done'), onClick: () => close() }),
      h('h2', { text: title }),
      confirmBtn
    ),
    body
  );
  if (content) append(body, [content]);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 340);
    if (onClose) onClose();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);
  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); });
  return { close, body, setConfirmEnabled: (b) => { if (confirmBtn) confirmBtn.disabled = !b; } };
}

/* ---------- List building blocks ---------- */

function section(header, rows, footer) {
  return h('section', { class: 'section' },
    header ? h('h2', { class: 'section-header', text: header }) : null,
    h('div', { class: 'group' }, rows),
    footer ? h('p', { class: 'section-footer', text: footer }) : null
  );
}

function fieldRow(id, label, value, opts = {}) {
  return h('div', { class: 'row field' },
    h('label', { for: id, text: label }),
    h('input', {
      id, type: opts.type || 'text', value: value || '', placeholder: opts.placeholder || '',
      autocomplete: opts.autocomplete || 'off', autocapitalize: opts.autocapitalize || 'sentences',
      inputmode: opts.inputmode, spellcheck: 'false', enterkeyhint: 'next'
    })
  );
}

function switchRow(id, label, checked) {
  return h('label', { class: 'row', for: id },
    h('span', { class: 'row-label', text: label }),
    h('input', { id, type: 'checkbox', role: 'switch', class: 'switch', checked })
  );
}

/** Rows with a checkmark that toggle membership in a Set. */
function checklist(options, selected) {
  const all = [...options];
  for (const value of selected) if (!all.includes(value)) all.push(value);
  return all.map((option) => {
    const row = h('button', { type: 'button', class: 'row', role: 'checkbox', 'aria-checked': String(selected.has(option)) },
      h('span', { class: 'row-label', text: option }), icon('check', 'check'));
    row.addEventListener('click', () => {
      if (selected.has(option)) selected.delete(option); else selected.add(option);
      row.setAttribute('aria-checked', String(selected.has(option)));
    });
    return row;
  });
}

function segmented(options, current, onChange, label) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const opt of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(opt.value === current), text: opt.label });
    b.addEventListener('click', () => {
      for (const other of wrap.children) other.setAttribute('aria-pressed', String(other === b));
      onChange(opt.value);
    });
    wrap.append(b);
  }
  return wrap;
}

/* ---------- Data access ---------- */

const currentShow = () => state.shows.find((s) => s.id === state.showId) || null;
const showLeads = () => state.leads.filter((l) => l.showId === state.showId)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const options = () => state.settings.options;

async function loadAll() {
  const [shows, leads, settings] = await Promise.all([
    store.getAll('shows'), store.getAll('leads'), store.getAll('settings')
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  state.settings.language = map.language || 'auto';
  setLanguage(state.settings.language);
  state.settings.company = map.company || '';
  state.settings.options = map.options || structuredClone(DEFAULT_OPTIONS[language()]);
  if (!map.options) await store.setSetting('options', state.settings.options);
  state.shows = shows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.leads = leads;
  const last = map.currentShow;
  state.showId = state.shows.some((s) => s.id === last) ? last : (state.shows.at(-1)?.id || null);
}

async function selectShow(id) {
  state.showId = id;
  await store.setSetting('currentShow', id);
  render();
}

async function photoUrl(photoId) {
  if (!photoId) return null;
  if (state.photoUrls.has(photoId)) return state.photoUrls.get(photoId);
  const record = await store.get('photos', photoId);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  state.photoUrls.set(photoId, url);
  return url;
}

/* ---------- Shows ---------- */

function openShowEditor(show) {
  const draft = { name: show?.name || '', type: show?.type || 'business' };
  const nameInput = h('input', {
    id: 'show-name', type: 'text', value: draft.name, placeholder: t('show.name.placeholder'),
    autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done'
  });
  const content = [
    section(null, [h('div', { class: 'row field' }, h('label', { for: 'show-name', text: t('show.name') }), nameInput)]),
    section(t('show.type'), [h('div', { class: 'row segment-row' },
      segmented([
        { value: 'business', label: t('show.type.business') },
        { value: 'career', label: t('show.type.career') }
      ], draft.type, (v) => { draft.type = v; }, t('show.type')))])
  ];
  if (show) {
    content.push(section(null, [h('button', {
      type: 'button', class: 'row destructive', text: t('show.delete'),
      onClick: async () => {
        const count = state.leads.filter((l) => l.showId === show.id).length;
        const ok = await actionSheet({ message: t('show.delete.confirm', { name: show.name, count }), actions: [{ label: t('common.delete'), destructive: true, value: true }] });
        if (!ok) return;
        await store.removeShow(show.id);
        state.shows = state.shows.filter((s) => s.id !== show.id);
        state.leads = state.leads.filter((l) => l.showId !== show.id);
        if (state.showId === show.id) await selectShow(state.shows.at(-1)?.id || null);
        sheet.close();
        render();
      }
    })]));
  }
  const save = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const record = show ? { ...show, name, type: draft.type } : { id: store.newId(), name, type: draft.type, createdAt: new Date().toISOString() };
    await store.put('shows', record);
    state.shows = show ? state.shows.map((s) => (s.id === show.id ? record : s)) : [...state.shows, record];
    sheet.close();
    if (!show) await selectShow(record.id); else render();
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const sheet = openSheet({ title: show ? t('show.edit') : t('show.new'), confirmLabel: t('common.save'), onConfirm: save, content });
  setTimeout(() => nameInput.focus(), 350);
}

async function openShowPicker() {
  const choice = await actionSheet({
    actions: [
      ...state.shows.slice().reverse().map((s) => ({ label: s.name + (s.id === state.showId ? ' ✓' : ''), value: s.id })),
      { label: t('show.new'), value: '__new' }
    ]
  });
  if (choice === '__new') openShowEditor(null);
  else if (choice) selectShow(choice);
}

/* ---------- Lead editor ---------- */

function openLeadEditor(lead, prefill) {
  const show = currentShow();
  if (!show) return;
  const isNew = !lead;
  const type = lead ? (state.shows.find((s) => s.id === lead.showId)?.type || show.type) : show.type;
  const data = lead ? structuredClone(lead) : {
    id: store.newId(), showId: show.id, priority: 'warm', interests: [], followups: [],
    consent: false, followedUp: false, ...prefill
  };
  const interests = new Set(data.interests || []);
  const followups = new Set(data.followups || []);
  let priority = data.priority || 'warm';
  let photoId = data.photoId || null;
  let newPhotoBlob = null;
  let removePhoto = false;

  const fields = type === 'career'
    ? [
      ['name', t('lead.name'), { autocapitalize: 'words' }],
      ['school', t('lead.school'), { autocapitalize: 'words' }],
      ['field', t('lead.field')],
      ['year', t('lead.year')],
      ['email', t('lead.email'), { type: 'email', inputmode: 'email', autocapitalize: 'none' }],
      ['phone', t('lead.phone'), { type: 'tel', inputmode: 'tel' }],
      ['linkedin', t('lead.linkedin'), { type: 'url', inputmode: 'url', autocapitalize: 'none' }]
    ]
    : [
      ['name', t('lead.name'), { autocapitalize: 'words' }],
      ['company', t('lead.company'), { autocapitalize: 'words' }],
      ['jobTitle', t('lead.jobTitle')],
      ['country', t('lead.country'), { autocapitalize: 'words' }],
      ['email', t('lead.email'), { type: 'email', inputmode: 'email', autocapitalize: 'none' }],
      ['phone', t('lead.phone'), { type: 'tel', inputmode: 'tel' }]
    ];

  const errorEl = h('p', { class: 'error', role: 'alert', hidden: true });
  const photoRowHost = h('div');
  const photoInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!file) return;
    try { newPhotoBlob = await compressPhoto(file); removePhoto = false; renderPhoto(); } catch { /* unreadable image */ }
  });

  async function renderPhoto() {
    photoRowHost.textContent = '';
    let url = null;
    if (newPhotoBlob) url = URL.createObjectURL(newPhotoBlob);
    else if (photoId && !removePhoto) url = await photoUrl(photoId);
    const rows = [];
    if (url) {
      rows.push(h('button', { type: 'button', class: 'row', onClick: () => viewPhoto(url) },
        h('img', { class: 'photo-thumb', src: url, alt: '' }),
        h('span', { class: 'row-label', text: t('lead.photo') }),
        icon('chevronRight', 'row-chevron')));
      rows.push(h('button', { type: 'button', class: 'row action', text: t('lead.photo.replace'), onClick: () => photoInput.click() }));
      rows.push(h('button', { type: 'button', class: 'row destructive-text', text: t('lead.photo.remove'), onClick: () => { newPhotoBlob = null; removePhoto = true; renderPhoto(); } }));
    } else {
      rows.push(h('button', { type: 'button', class: 'row action', onClick: () => photoInput.click() },
        icon('camera', 'row-chevron'), h('span', { class: 'row-label', text: t('lead.photo.add') })));
    }
    photoRowHost.append(section(t('lead.photo'), rows, t('lead.photo.footer')));
  }

  const content = [];
  if (isNew) {
    content.push(section(null, [h('button', {
      type: 'button', class: 'row action',
      onClick: () => { sheet.close(); openScanner(); }
    }, icon('qr', 'row-chevron'), h('span', { class: 'row-label', text: t('capture.scan') }))]));
  }
  content.push(section(type === 'career' ? t('lead.section.student') : t('lead.section.contact'),
    fields.map(([key, label, opts]) => fieldRow(`lead-${key}`, label, data[key], opts))));
  content.push(errorEl);
  content.push(section(type === 'career' ? t('lead.interests.career') : t('lead.interests.business'),
    checklist(type === 'career' ? options().career : options().business, interests)));
  content.push(section(t('lead.followups'), checklist(options().followups, followups)));
  content.push(section(t('lead.priority'), [h('div', { class: 'row segment-row' },
    segmented([
      { value: 'hot', label: t('lead.priority.hot') },
      { value: 'warm', label: t('lead.priority.warm') },
      { value: 'cold', label: t('lead.priority.cold') }
    ], priority, (v) => { priority = v; }, t('lead.priority')))]));
  content.push(section(t('lead.notes'), [h('div', { class: 'row textarea' },
    h('textarea', { id: 'lead-notes', 'aria-label': t('lead.notes'), placeholder: t('lead.notes.placeholder'), text: data.notes || '' }))]));

  const statusRows = [];
  statusRows.push(switchRow('lead-consent', t('lead.consent'), data.consent));
  if (!isNew) statusRows.push(switchRow('lead-followed', t('lead.followedUp'), data.followedUp));
  const company = state.settings.company.trim();
  content.push(section(null, statusRows, company ? t('lead.consent.footer.company', { company }) : t('lead.consent.footer.generic')));

  content.push(photoRowHost, photoInput);

  // Show the raw code only for badges that carry an ID instead of contact details.
  if (data.badgeCode && !data.badgeHasDetails) {
    content.push(section(t('lead.badge'), [h('div', { class: 'row' }, h('span', { class: 'row-label', text: data.badgeCode }))],
      t('lead.badge.footer')));
  }
  if (!isNew) {
    content.push(h('p', { class: 'section-footer centered', text: t('lead.added', { date: `${fmtDate(data.createdAt)} ${fmtTime(data.createdAt)}` }) }));
    content.push(section(null, [h('button', {
      type: 'button', class: 'row destructive', text: t('lead.delete'),
      onClick: async () => {
        const ok = await actionSheet({ message: t('lead.delete.confirm'), actions: [{ label: t('lead.delete'), destructive: true, value: true }] });
        if (!ok) return;
        await store.remove('leads', data.id);
        if (data.photoId) await store.remove('photos', data.photoId);
        state.leads = state.leads.filter((l) => l.id !== data.id);
        sheet.close();
        toast(t('lead.deleted'));
        render();
      }
    })]));
  }

  const save = async () => {
    const value = (id) => (document.getElementById(id)?.value || '').trim();
    for (const [key] of fields) data[key] = value(`lead-${key}`);
    data.notes = value('lead-notes');
    if (!(data.name || data.company || data.school || data.email || data.phone)) {
      errorEl.textContent = t('lead.required'); errorEl.hidden = false;
      document.getElementById('lead-name').focus();
      return;
    }
    if (data.email && !isEmail(data.email)) {
      errorEl.textContent = t('lead.emailInvalid'); errorEl.hidden = false;
      document.getElementById('lead-email').focus();
      return;
    }
    errorEl.hidden = true;
    data.interests = [...interests];
    data.followups = [...followups];
    data.priority = priority;
    data.consent = document.getElementById('lead-consent').checked;
    if (!isNew) data.followedUp = document.getElementById('lead-followed').checked;
    const now = new Date().toISOString();
    data.updatedAt = now;
    if (isNew) data.createdAt = now;

    const writes = [];
    if (newPhotoBlob) {
      if (photoId) await store.remove('photos', photoId);
      photoId = store.newId();
      writes.push({ store: 'photos', value: { id: photoId, blob: newPhotoBlob } });
    } else if (removePhoto && photoId) {
      await store.remove('photos', photoId);
      photoId = null;
    }
    data.photoId = photoId;
    writes.push({ store: 'leads', value: data });
    await store.putMany(writes);
    state.leads = isNew ? [...state.leads, data] : state.leads.map((l) => (l.id === data.id ? data : l));
    if (isNew) store.requestPersistence();
    sheet.close();
    toast(isNew ? t('lead.saved') : t('lead.updated'));
    render();
  };

  const sheet = openSheet({ title: isNew ? t('lead.new') : t('lead.edit'), confirmLabel: t('common.save'), onConfirm: save, content });
  renderPhoto();
}

function viewPhoto(url) {
  const close = () => view.remove();
  const view = h('div', { class: 'photo-view', role: 'dialog', 'aria-modal': 'true', onClick: close },
    h('img', { src: url, alt: '' }),
    h('button', { type: 'button', class: 'icon-button glass close', 'aria-label': t('common.close'), onClick: close }, icon('close')));
  document.body.append(view);
}

/* ---------- Scanner ---------- */

function openScanner() {
  if (!currentShow()) return;
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const hint = h('p', { class: 'hint', text: t('scan.hint') });
  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const overlay = h('div', { class: 'scanner', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('scan.title') },
    video,
    h('div', { class: 'frame', 'aria-hidden': 'true' }),
    h('div', { class: 'top' },
      h('h2', { text: t('scan.title') }),
      h('button', { type: 'button', class: 'icon-button glass', 'aria-label': t('common.close'), onClick: () => close() }, icon('close'))),
    h('div', { class: 'bottom' },
      hint,
      h('button', { type: 'button', class: 'button glass', onClick: () => fileInput.click() }, icon('camera'), t('scan.photo')),
      fileInput)
  );
  const scanner = new CameraScanner(video, (text) => { close(); handleCode(text); });
  function close() { scanner.stop(); overlay.remove(); }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const text = await decodeImageFile(file);
    if (text) { close(); handleCode(text); } else hint.textContent = t('scan.notFound');
  });
  document.body.append(overlay);
  scanner.start().then((result) => {
    if (result === 'denied') hint.textContent = t('scan.denied');
    else if (result === 'unavailable') hint.textContent = t('scan.noCamera');
  });
}

function handleCode(text) {
  const code = String(text).trim().slice(0, 4000);
  const existing = showLeads().find((l) => l.badgeCode === code);
  if (existing) {
    toast(t('scan.duplicate', { time: fmtTime(existing.createdAt) }));
    openLeadEditor(existing);
    return;
  }
  if (navigator.vibrate) navigator.vibrate(20);
  const parsed = parseContact(code);
  const show = currentShow();
  const prefill = { badgeCode: code, badgeHasDetails: parsed.hasDetails };
  const f = parsed.fields;
  for (const key of ['name', 'email', 'phone', 'linkedin']) if (f[key]) prefill[key] = f[key];
  if (show.type === 'career') {
    if (f.company) prefill.school = f.company;
  } else {
    if (f.company) prefill.company = f.company;
    if (f.jobTitle) prefill.jobTitle = f.jobTitle;
    if (f.country) prefill.country = f.country;
  }
  if (!parsed.hasDetails) toast(t('scan.idOnly'));
  openLeadEditor(null, prefill);
}

/* ---------- Screens ---------- */

function emptyShows() {
  return h('div', { class: 'empty' },
    h('h2', { text: t('show.none.title') }),
    h('p', { text: t('show.none.body') }),
    h('button', { type: 'button', class: 'button prominent', onClick: () => openShowEditor(null) }, icon('plus'), t('show.new')));
}

function showTitle() {
  const show = currentShow();
  return h('button', { type: 'button', class: 'title-button', 'aria-label': t('show.switch'), onClick: openShowPicker },
    h('h1', { class: 'large-title', text: show.name }), icon('chevronDown', 'chevron'));
}

function leadRow(lead) {
  const showType = state.shows.find((s) => s.id === lead.showId)?.type;
  const primary = lead.name || lead.company || lead.school || lead.email || lead.phone;
  const secondary = [lead.name ? (showType === 'career' ? lead.school : lead.company) : '', showType === 'career' ? lead.field : lead.jobTitle]
    .filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'row lead-row', onClick: () => openLeadEditor(lead) },
    h('span', { class: `dot ${lead.priority || 'warm'}`, 'aria-label': t(`lead.priority.${lead.priority || 'warm'}`) }),
    h('span', { class: 'row-label' }, primary, secondary ? h('span', { class: 'row-sub', text: secondary }) : null),
    lead.followedUp ? icon('checkCircle', 'done') : null,
    h('span', { class: 'time', text: fmtTime(lead.createdAt) }),
    icon('chevronRight', 'row-chevron'));
}

function captureScreen() {
  const show = currentShow();
  if (!show) return [h('h1', { class: 'large-title', text: t('app.name') }), emptyShows()];
  const today = todayKey();
  const leadsToday = showLeads().filter((l) => dayKey(l.createdAt) === today);
  const recent = showLeads().slice(0, 5);
  return [
    showTitle(),
    h('p', { class: 'subtitle', text: `${show.type === 'career' ? t('show.type.career') : t('show.type.business')} · ${fmtDayLong(new Date().toISOString())}` }),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'value', text: leadsToday.length }), h('span', { class: 'label', text: t('capture.leadsToday') })),
      h('div', { class: 'stat' }, h('span', { class: 'value', text: showLeads().length }), h('span', { class: 'label', text: t('capture.leadsTotal') }))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'button prominent', onClick: openScanner }, icon('qr'), t('capture.scan')),
      h('button', { type: 'button', class: 'button', onClick: () => openLeadEditor(null) }, icon('personAdd'), t('capture.newLead'))),
    recent.length
      ? section(t('capture.recent'), recent.map(leadRow))
      : section(t('capture.recent'), [h('div', { class: 'row' }, h('span', { class: 'row-label muted', text: t('capture.recent.empty') }))])
  ];
}

function leadsScreen() {
  const show = currentShow();
  if (!show) return [h('h1', { class: 'large-title', text: t('tab.leads') }), emptyShows()];
  const all = showLeads();
  const q = state.search.trim().toLowerCase();
  let list = all;
  if (state.leadFilter === 'hot') list = list.filter((l) => l.priority === 'hot');
  if (state.leadFilter === 'todo') list = list.filter((l) => !l.followedUp);
  if (q) {
    list = list.filter((l) => [l.name, l.company, l.school, l.field, l.jobTitle, l.country, l.email, l.notes, ...(l.interests || [])]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  const searchInput = h('input', { type: 'search', placeholder: t('leads.search'), 'aria-label': t('leads.search'), value: state.search, enterkeyhint: 'search' });
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    const pos = searchInput.selectionStart;
    render();
    const again = $root.querySelector('input[type=search]');
    again.focus();
    try { again.setSelectionRange(pos, pos); } catch { /* not supported for search inputs everywhere */ }
  });

  const out = [
    h('h1', { class: 'large-title', text: t('tab.leads') }),
    h('p', { class: 'subtitle', text: show.name }),
    h('div', { class: 'search' }, icon('search'), searchInput),
    h('div', { class: 'filter' }, segmented([
      { value: 'all', label: t('leads.filter.all') },
      { value: 'hot', label: t('leads.filter.hot') },
      { value: 'todo', label: t('leads.filter.todo') }
    ], state.leadFilter, (v) => { state.leadFilter = v; render(); }, t('tab.leads')))
  ];
  if (!all.length) {
    out.push(h('div', { class: 'empty' }, h('h2', { text: t('leads.empty') }), h('p', { text: t('leads.empty.body') })));
    return out;
  }
  if (!list.length) {
    out.push(h('div', { class: 'empty' }, h('h2', { text: t('leads.noMatch') })));
    return out;
  }
  const byDay = new Map();
  for (const lead of list) {
    const key = dayKey(lead.createdAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(lead);
  }
  for (const [key, leads] of byDay) {
    const header = key === todayKey() ? t('common.today') : fmtDayLong(leads[0].createdAt);
    out.push(section(`${header} · ${leads.length}`, leads.map(leadRow)));
  }
  return out;
}

function bars(items, empty) {
  if (!items.length) return h('div', { class: 'group chart' }, h('p', { class: 'chart-empty', text: empty }));
  const max = Math.max(...items.map((i) => i.total));
  return h('div', { class: 'group chart' }, h('div', { class: 'bar-list' }, items.map((item) => {
    const track = h('div', { class: 'bar-track', 'aria-hidden': 'true' });
    for (const part of item.parts || [{ value: item.total, cls: 'a' }]) {
      const seg = h('span', { class: part.cls });
      seg.style.width = `${max ? (part.value / max) * 100 : 0}%`;
      track.append(seg);
    }
    return h('div', { class: 'bar-item' },
      h('span', { class: 'name', title: item.label, text: item.label }), track, h('span', { class: 'count', text: item.total }));
  })));
}

function tally(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([label, total]) => ({ label, total }));
}

function hourBuckets(leads) {
  const days = new Set(leads.map((l) => dayKey(l.createdAt)));
  const multiDay = days.size > 1;
  const buckets = new Map();
  const add = (iso) => {
    const d = new Date(iso);
    const sort = `${dayKey(iso)} ${String(d.getHours()).padStart(2, '0')}`;
    const label = `${multiDay ? `${fmtDate(iso)} ` : ''}${String(d.getHours()).padStart(2, '0')}:00`;
    const b = buckets.get(sort) || { label, sort, leads: 0 };
    b.leads++;
    buckets.set(sort, b);
  };
  leads.forEach((l) => add(l.createdAt));
  return [...buckets.values()].sort((a, b) => a.sort.localeCompare(b.sort));
}

function reportScreen() {
  const show = currentShow();
  if (!show) return [h('h1', { class: 'large-title', text: t('tab.report') }), emptyShows()];
  const leads = showLeads();
  const hot = leads.filter((l) => l.priority === 'hot').length;
  const todo = leads.filter((l) => !l.followedUp).length;
  const career = show.type === 'career';
  const metric = (value, label) => h('div', { class: 'stat' }, h('span', { class: 'value', text: value }), h('span', { class: 'label', text: label }));
  const consented = leads.filter((l) => l.consent).length;
  const hours = hourBuckets(leads).map((b) => ({ label: b.label, total: b.leads }));

  return [
    h('h1', { class: 'large-title', text: t('tab.report') }),
    h('p', { class: 'subtitle', text: show.name }),
    h('div', { class: 'metric-grid' },
      metric(leads.length, t('report.leads')),
      metric(hot, t('report.hot')),
      metric(consented, t('report.consent')),
      metric(todo, t('report.todo'))),
    h('div', { class: 'spacer' }),
    h('section', { class: 'section' },
      h('h2', { class: 'section-header', text: t('report.byHour') }),
      bars(hours, t('report.nothing'))),
    h('section', { class: 'section' },
      h('h2', { class: 'section-header', text: career ? t('report.interests.career') : t('report.interests.business') }),
      bars(tally(leads.flatMap((l) => l.interests || [])), t('report.nothing'))),
    h('section', { class: 'section' },
      h('h2', { class: 'section-header', text: career ? t('report.schools') : t('report.countries') }),
      bars(tally(leads.map((l) => (career ? l.school : l.country)?.trim())).slice(0, 12), t('report.nothing'))),
    section(t('report.export'), [
      h('button', { type: 'button', class: 'row action', onClick: () => exportShow('xlsx') }, icon('share', 'row-chevron'), h('span', { class: 'row-label', text: t('report.export.xlsx') })),
      h('button', { type: 'button', class: 'row action', onClick: () => exportShow('csv') }, icon('share', 'row-chevron'), h('span', { class: 'row-label', text: t('report.export.csv') }))
    ], t('report.export.footer'))
  ];
}

/* ---------- Settings ---------- */

function optionEditor(listKey, title) {
  const list = options()[listKey];
  const rows = list.map((value, index) => h('div', { class: 'row' },
    h('button', {
      type: 'button', class: 'mini-button remove', 'aria-label': `${t('common.delete')} ${value}`,
      onClick: async () => { list.splice(index, 1); await store.setSetting('options', options()); render(); }
    }, icon('minusCircle')),
    h('span', { class: 'row-label', text: value })));
  const input = h('input', { type: 'text', placeholder: t('settings.options.add'), 'aria-label': `${title}: ${t('settings.options.add')}`, enterkeyhint: 'done', autocomplete: 'off' });
  const add = async () => {
    const value = input.value.trim();
    if (!value || list.includes(value)) { input.value = ''; return; }
    list.push(value);
    await store.setSetting('options', options());
    render();
    const again = document.querySelector(`[data-option-input="${listKey}"]`);
    if (again) again.focus();
  };
  input.dataset.optionInput = listKey;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  rows.push(h('div', { class: 'row field' },
    h('button', { type: 'button', class: 'mini-button add', 'aria-label': t('common.add'), onClick: add }, icon('plus')),
    input));
  return section(title, rows);
}

function settingsScreen() {
  const languageRows = LANGUAGES.map((lang) => {
    const row = h('button', { type: 'button', class: 'row', role: 'radio', 'aria-checked': String(state.settings.language === lang.code) },
      h('span', { class: 'row-label', text: lang.label || t(lang.labelKey) }), icon('check', 'check'));
    row.addEventListener('click', async () => {
      state.settings.language = lang.code;
      await store.setSetting('language', lang.code);
      setLanguage(lang.code);
      renderTabbar();
      render();
    });
    return row;
  });

  const companyInput = h('input', { id: 'set-company', type: 'text', value: state.settings.company, placeholder: t('settings.company.placeholder'), autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done' });
  companyInput.addEventListener('change', async () => {
    state.settings.company = companyInput.value.trim();
    await store.setSetting('company', state.settings.company);
  });

  const showRows = state.shows.slice().reverse().map((s) => h('button', { type: 'button', class: 'row', onClick: () => openShowEditor(s) },
    h('span', { class: 'row-label' }, s.name, h('span', { class: 'row-sub', text: s.type === 'career' ? t('show.type.career') : t('show.type.business') })),
    s.id === state.showId ? icon('check', 'check visible') : null,
    icon('chevronRight', 'row-chevron')));
  showRows.push(h('button', { type: 'button', class: 'row action', onClick: () => openShowEditor(null) }, icon('plus', 'row-chevron'), h('span', { class: 'row-label', text: t('settings.addShow') })));

  const storageValue = h('span', { class: 'row-value', text: '…' });
  store.isPersisted().then((p) => { storageValue.textContent = p ? t('settings.storage.persisted') : t('settings.storage.temporary'); });

  const restoreInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files && restoreInput.files[0];
    restoreInput.value = '';
    if (file) await restoreBackup(file);
  });

  return [
    h('h1', { class: 'large-title', text: t('tab.settings') }),
    h('div', { class: 'spacer' }),
    section(t('settings.language'), languageRows),
    section(t('settings.general'), [h('div', { class: 'row field' }, h('label', { for: 'set-company', text: t('settings.company') }), companyInput)], t('settings.company.footer')),
    section(t('settings.shows'), showRows),
    optionEditor('business', t('settings.options.business')),
    optionEditor('career', t('settings.options.career')),
    h('div', null, optionEditor('followups', t('settings.options.followups'))),
    h('p', { class: 'section-footer options-note', text: t('settings.options.footer') }),
    section(t('settings.data'), [
      h('button', { type: 'button', class: 'row action', onClick: backupAll }, h('span', { class: 'row-label', text: t('settings.backup') })),
      h('button', { type: 'button', class: 'row action', onClick: () => restoreInput.click() }, h('span', { class: 'row-label', text: t('settings.restore') })),
      h('div', { class: 'row' }, h('span', { class: 'row-label', text: t('settings.storage') }), storageValue),
      restoreInput
    ], t('settings.data.footer')),
    section(t('settings.about'), [
      h('div', { class: 'row' }, h('span', { class: 'row-label', text: t('settings.version') }), h('span', { class: 'row-value', text: APP_VERSION })),
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, t('settings.licenses'), h('span', { class: 'row-sub', text: t('settings.licenses.body') })))
    ])
  ];
}

/* ---------- Export, backup, restore ---------- */

/** The badge code is exported only when the badge held an ID rather than contact details. */
const badgeId = (lead) => (lead.badgeCode && !lead.badgeHasDetails ? lead.badgeCode : '');

function leadTable(show, leads) {
  const yes = (b) => (b ? t('export.yes') : t('export.no'));
  const career = show.type === 'career';
  const columns = career
    ? [['export.date', 11], ['export.time', 7], ['lead.name', 22], ['lead.school', 24], ['lead.field', 20], ['lead.year', 12], ['lead.email', 26], ['lead.phone', 16], ['lead.linkedin', 28], ['lead.interests.career', 28], ['lead.followups', 26], ['lead.priority', 9], ['lead.notes', 40], ['lead.consent', 12], ['lead.followedUp', 11], ['lead.badge', 20]]
    : [['export.date', 11], ['export.time', 7], ['lead.name', 22], ['lead.company', 24], ['lead.jobTitle', 20], ['lead.country', 14], ['lead.email', 26], ['lead.phone', 16], ['lead.interests.business', 28], ['lead.followups', 26], ['lead.priority', 9], ['lead.notes', 40], ['lead.consent', 12], ['lead.followedUp', 11], ['lead.badge', 20]];
  const rows = leads.slice().reverse().map((l) => {
    const common = [dayKey(l.createdAt), fmtTime(l.createdAt), l.name || ''];
    const priority = t(`lead.priority.${l.priority || 'warm'}`);
    return career
      ? [...common, l.school || '', l.field || '', l.year || '', l.email || '', l.phone || '', l.linkedin || '', (l.interests || []).join(', '), (l.followups || []).join(', '), priority, l.notes || '', yes(l.consent), yes(l.followedUp), badgeId(l)]
      : [...common, l.company || '', l.jobTitle || '', l.country || '', l.email || '', l.phone || '', (l.interests || []).join(', '), (l.followups || []).join(', '), priority, l.notes || '', yes(l.consent), yes(l.followedUp), badgeId(l)];
  });
  return { header: columns.map(([key]) => t(key)), widths: columns.map(([, w]) => w), rows };
}

async function exportShow(format) {
  const show = currentShow();
  if (!show) return;
  const { header, widths, rows } = leadTable(show, showLeads());
  const name = `${fileSafe(show.name)}-leads`;
  if (format === 'csv') {
    await shareFile(buildCsv([header, ...rows]), `${name}.csv`);
    return;
  }
  const hours = hourBuckets(showLeads()).map((b) => [b.sort.replace(/ (\d\d)$/, ' $1:00'), b.leads]);
  const blob = buildXlsx([
    { name: t('export.sheet.leads'), rows: [header, ...rows], widths },
    { name: t('export.sheet.hours'), rows: [[t('export.hour'), t('report.leads')], ...hours], widths: [18, 10] }
  ]);
  await shareFile(blob, `${name}.xlsx`);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function backupAll() {
  const [shows, leads, settings, photos] = await Promise.all([
    store.getAll('shows'), store.getAll('leads'), store.getAll('settings'), store.getAll('photos')
  ]);
  const encodedPhotos = [];
  for (const p of photos) encodedPhotos.push({ id: p.id, type: p.blob.type, data: await blobToBase64(p.blob) });
  const backup = { app: 'leadlog', format: 1, exportedAt: new Date().toISOString(), shows, leads, settings, photos: encodedPhotos };
  const stamp = new Date().toISOString().slice(0, 10);
  await shareFile(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `LeadLog-backup-${stamp}.json`);
}

async function restoreBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    backup = null;
  }
  if (!backup || backup.app !== 'leadlog' || !Array.isArray(backup.leads) || !Array.isArray(backup.shows)) {
    toast(t('settings.restoreFailed'));
    return;
  }
  const isRecord = (r) => r && typeof r === 'object' && typeof r.id === 'string';
  const writes = [];
  backup.shows.filter(isRecord).forEach((value) => writes.push({ store: 'shows', value }));
  backup.leads.filter(isRecord).forEach((value) => writes.push({ store: 'leads', value }));
  (backup.settings || []).filter((s) => s && typeof s.key === 'string').forEach((value) => writes.push({ store: 'settings', value }));
  for (const p of (backup.photos || []).filter(isRecord)) {
    try {
      const bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0));
      writes.push({ store: 'photos', value: { id: p.id, blob: new Blob([bytes], { type: p.type || 'image/jpeg' }) } });
    } catch { /* skip a damaged photo */ }
  }
  await store.putMany(writes);
  await loadAll();
  renderTabbar();
  render();
  toast(t('settings.restored', { leads: backup.leads.length }));
}

/* ---------- Tab bar and rendering ---------- */

const TABS = [
  { id: 'capture', icon: 'capture' },
  { id: 'leads', icon: 'leads' },
  { id: 'report', icon: 'report' },
  { id: 'settings', icon: 'settings' }
];

function renderTabbar() {
  $tabbar.textContent = '';
  for (const tab of TABS) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === tab.id), 'aria-controls': 'screen' },
      icon(tab.icon), h('span', { text: t(`tab.${tab.id}`) }));
    b.addEventListener('click', () => {
      if (state.tab === tab.id) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      state.tab = tab.id;
      renderTabbar();
      render();
      window.scrollTo(0, 0);
    });
    $tabbar.append(b);
  }
}

function render() {
  const screens = { capture: captureScreen, leads: leadsScreen, report: reportScreen, settings: settingsScreen };
  const children = screens[state.tab]();
  $root.textContent = '';
  append($root, children);
  const show = currentShow();
  $navTitle.textContent = state.tab === 'capture' ? (show ? show.name : t('app.name')) : t(`tab.${state.tab}`);
  document.title = t('app.name');
  updateNavbar();
}

function updateNavbar() {
  $navbar.classList.toggle('scrolled', window.scrollY > 36);
}

/* ---------- Service worker and updates ---------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    const offerUpdate = (worker) => {
      toast(t('update.available'), { label: t('update.reload'), run: () => worker.postMessage({ type: 'SKIP_WAITING' }) });
    };
    if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
  }).catch(() => { /* the app still works without offline support */ });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/* ---------- Start ---------- */

async function start() {
  try {
    await loadAll();
  } catch (err) {
    $root.textContent = '';
    $root.append(h('div', { class: 'empty' }, h('h2', { text: 'Storage unavailable' }),
      h('p', { text: 'This browser blocked local storage, so leads can’t be saved. Open the app from the Home Screen or turn off private browsing.' })));
    console.error(err);
    return;
  }
  renderTabbar();
  render();
  window.addEventListener('scroll', updateNavbar, { passive: true });
  registerServiceWorker();
}

start();
