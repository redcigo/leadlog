/**
 * LeadLog: capture leads at exhibitions and career fairs.
 * All data stays on the device (IndexedDB). The app makes no network requests
 * of its own; the service worker only serves the app's own files.
 */

import * as store from './db.js';
import { t, setLanguage, language, LANGUAGES } from './i18n.js';
import { icon, iconTile } from './icons.js';
import { illustration } from './illustrations.js';
import { parseContact } from './contact-parser.js';
import { CameraScanner, decodeImageFile, compressPhoto, cameraPermission } from './scanner.js';
import { buildXlsx, buildCsv, shareFile, fileSafe } from './export.js';
import {
  h, append, installMotion, animate, collapse, countUp, reducedMotion, toast, hud, actionSheet, openSheet,
  pushPage, popAllPages, section, fieldRow, navRow, switchRow, checklist, segmented, EASE_IOS
} from './ui.js';
import { buildShowFile, readShowFile, planMerge, encodeLeadQr, decodeLeadQr, sameShow, LEAD_QR_PREFIX } from './sharing.js';
import { readTable, detectColumns, buildEntries, findEntry, fillFromEntry } from './roster.js';

export const APP_VERSION = '1.2.0';

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

/** Pause on the green "found" frame before the lead form opens. */
const SCAN_CONFIRM_MS = 700;

/* ---------- State ---------- */

const state = {
  settings: { language: 'auto', userName: '', company: '', options: null, cameraAllowed: false },
  shows: [],
  showId: null,
  leads: [],
  rosters: new Map(),
  photoUrls: new Map(),
  tab: 'capture',
  leadFilter: 'all',
  search: '',
  shown: {},
  flashId: null,
  animateBars: false
};

const $root = document.getElementById('screen');
const $navbar = document.getElementById('navbar');
const $navTitle = document.getElementById('nav-title');
const $tabbar = document.getElementById('tabbar');

/* ---------- Formatting ---------- */

const locale = () => (language() === 'cs' ? 'cs-CZ' : 'en-GB');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const fmtDayLong = (iso) => new Date(iso).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
const fmtNumber = (n) => n.toLocaleString(locale());
function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayKey = () => dayKey(new Date().toISOString());
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/* ---------- Data access ---------- */

const currentShow = () => state.shows.find((s) => s.id === state.showId) || null;
const showById = (id) => state.shows.find((s) => s.id === id) || null;
const leadsOf = (showId) => state.leads.filter((l) => l.showId === showId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const showLeads = () => leadsOf(state.showId);
const options = () => state.settings.options;
const me = () => state.settings.userName;
/** A lead that only has a badge ID and no name yet. */
const isIdOnly = (l) => l.badgeCode && !l.badgeHasDetails && !l.name;

async function loadAll() {
  const [shows, leads, settings, rosters] = await Promise.all([
    store.getAll('shows'), store.getAll('leads'), store.getAll('settings'), store.getAll('rosters')
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  state.settings.language = map.language || 'auto';
  setLanguage(state.settings.language);
  state.settings.userName = map.userName || '';
  state.settings.company = map.company || '';
  state.settings.cameraAllowed = Boolean(map.cameraAllowed);
  state.settings.options = map.options || structuredClone(DEFAULT_OPTIONS[language()]);
  if (!map.options) await store.setSetting('options', state.settings.options);
  state.shows = shows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.leads = leads;
  state.rosters = new Map(rosters.map((r) => [r.showId, r]));
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

function forgetPhoto(photoId) {
  const url = state.photoUrls.get(photoId);
  if (url) URL.revokeObjectURL(url);
  state.photoUrls.delete(photoId);
}

/** An <img> whose source is filled in once the photo has been read from storage. */
function storedImage(photoId, className, alt = '') {
  const img = h('img', { class: className, alt });
  photoUrl(photoId).then((url) => { if (url) img.src = url; else img.remove(); });
  return img;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data, type) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: type || 'image/jpeg' });
}

async function encodePhotos(ids) {
  const out = [];
  for (const id of ids) {
    const p = await store.get('photos', id);
    if (p) out.push({ id: p.id, type: p.blob.type, data: await blobToBase64(p.blob) });
  }
  return out;
}

/** Share a file; if the browser wants a fresh tap first, offer one in a toast. */
async function deliverFile(blob, filename) {
  const result = await shareFile(blob, filename);
  if (result === 'blocked') toast(t('share.ready'), { label: t('share.share'), run: () => shareFile(blob, filename) });
  return result;
}

/** A hidden file input. onFile receives the chosen file. */
function fileInput(accept, onFile, capture) {
  const input = h('input', { type: 'file', accept, capture, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) onFile(file);
  });
  return input;
}

function emptyState(drawing, title, body, button) {
  return h('div', { class: 'empty' },
    illustration(drawing),
    h('h2', { text: title }),
    body ? h('p', { text: body }) : null,
    button || null);
}

/* ---------- Welcome (first launch) ---------- */

function showWelcome() {
  return new Promise((resolve) => {
    let lang = state.settings.language === 'auto' ? language() : state.settings.language;
    const values = { name: '', company: state.settings.company };
    const root = h('div', { class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title' });
    let first = true;

    const draw = () => {
      setLanguage(lang);
      const nameRow = fieldRow('welcome-name', t('welcome.name'), values.name, { autocomplete: 'name', autocapitalize: 'words', placeholder: t('welcome.required'), required: true });
      const companyRow = fieldRow('welcome-company', t('settings.company'), values.company, { autocomplete: 'organization', autocapitalize: 'words', placeholder: t('welcome.optional'), enterkeyhint: 'done' });
      const nameInput = nameRow.querySelector('input');
      const companyInput = companyRow.querySelector('input');
      const go = h('button', { type: 'button', class: 'button prominent', text: t('welcome.continue'), disabled: !values.name.trim(), onClick: finish });
      nameInput.addEventListener('input', () => { values.name = nameInput.value; go.disabled = !values.name.trim(); });
      companyInput.addEventListener('input', () => { values.company = companyInput.value; });
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); companyInput.focus(); } });
      companyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!go.disabled) finish(); } });

      root.textContent = '';
      root.className = `welcome${first ? ' stagger' : ''}`;
      append(root, [
        h('div', { class: 'hero' }, illustration('stand'), h('h1', { id: 'welcome-title', text: t('welcome.title') }), h('p', { text: t('welcome.body') })),
        section(t('welcome.you'), [nameRow, companyRow], t('welcome.name.footer')),
        section(t('settings.language'), [h('div', { class: 'row segment-row' },
          segmented(LANGUAGES.filter((l) => l.code !== 'auto').map((l) => ({ value: l.code, label: l.label })), lang, (v) => { lang = v; first = false; draw(); }, t('settings.language')))]),
        h('div', { class: 'continue' }, go)
      ]);
    };

    async function finish() {
      const name = values.name.trim();
      if (!name) return;
      state.settings.userName = name;
      state.settings.company = values.company.trim();
      state.settings.language = lang;
      await Promise.all([store.setSetting('userName', name), store.setSetting('company', state.settings.company), store.setSetting('language', lang)]);
      // Leads saved before names existed (version 1.0) were all captured on this phone.
      const unnamed = state.leads.filter((l) => !l.capturedBy).map((l) => ({ ...l, capturedBy: name }));
      if (unnamed.length) {
        await store.putMany(unnamed.map((value) => ({ store: 'leads', value })));
        const byId = new Map(unnamed.map((l) => [l.id, l]));
        state.leads = state.leads.map((l) => byId.get(l.id) || l);
      }
      setLanguage(lang);
      renderTabbar();
      render();
      root.classList.add('leaving');
      setTimeout(() => { root.remove(); document.documentElement.classList.remove('locked'); resolve(); }, reducedMotion() ? 50 : 450);
    }

    draw();
    document.body.append(root);
    // The app underneath must not scroll while the welcome screen covers it.
    document.documentElement.classList.add('locked');
  });
}

/* ---------- Shows ---------- */

function openShowEditor(show) {
  const draft = { name: show?.name || '', type: show?.type || 'business' };
  let dirty = false;
  let logoBlob = null;
  let removeLogo = false;

  const nameInput = h('input', {
    id: 'show-name', type: 'text', value: draft.name, placeholder: t('show.name.placeholder'),
    autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done'
  });

  const logoHost = h('div');
  const logoInput = fileInput('image/*', async (file) => {
    try { logoBlob = await compressPhoto(file, { maxSide: 600, keepTransparency: true }); removeLogo = false; dirty = true; drawLogo(); } catch { toast(t('photo.unreadable')); }
  });
  async function drawLogo() {
    logoHost.textContent = '';
    let url = null;
    if (logoBlob) url = URL.createObjectURL(logoBlob);
    else if (show?.logoId && !removeLogo) url = await photoUrl(show.logoId);
    const rows = url
      ? [
        h('div', { class: 'row' }, h('img', { class: 'photo-thumb logo', src: url, alt: '' }), h('span', { class: 'row-label', text: t('show.logo.current') })),
        h('button', { type: 'button', class: 'row action', text: t('show.logo.replace'), onClick: () => logoInput.click() }),
        h('button', { type: 'button', class: 'row destructive-text', text: t('show.logo.remove'), onClick: () => { logoBlob = null; removeLogo = true; dirty = true; drawLogo(); } })
      ]
      : [h('button', { type: 'button', class: 'row action', onClick: () => logoInput.click() }, icon('image', 'row-chevron'), h('span', { class: 'row-label', text: t('show.logo.add') }))];
    logoHost.append(section(t('show.logo'), rows, t('show.logo.footer')));
  }

  const content = [
    section(null, [h('div', { class: 'row field' }, h('label', { for: 'show-name', text: t('show.name') }), nameInput)]),
    section(t('show.type'), [h('div', { class: 'row segment-row' },
      segmented([
        { value: 'business', label: t('show.type.business') },
        { value: 'career', label: t('show.type.career') }
      ], draft.type, (v) => { draft.type = v; dirty = true; }, t('show.type')))]),
    logoHost,
    logoInput
  ];

  if (show) {
    content.push(rosterSection(show));
    content.push(section(null, [h('button', {
      type: 'button', class: 'row destructive', text: t('show.delete'),
      onClick: async () => {
        const count = leadsOf(show.id).length;
        const ok = await actionSheet({ message: t('show.delete.confirm', { name: show.name, count }), actions: [{ label: t('common.delete'), destructive: true, value: true }] });
        if (!ok) return;
        await store.removeShow(show.id);
        state.shows = state.shows.filter((s) => s.id !== show.id);
        state.leads = state.leads.filter((l) => l.showId !== show.id);
        state.rosters.delete(show.id);
        sheet.close();
        if (state.showId === show.id) await selectShow(state.shows.at(-1)?.id || null); else render();
      }
    })]));
  }

  const save = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); animate(nameInput.closest('.group'), [{ transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 300 }); return; }
    const record = show ? { ...show, name, type: draft.type } : { id: store.newId(), name, type: draft.type, createdAt: new Date().toISOString() };
    const writes = [];
    if (logoBlob) {
      if (record.logoId) { await store.remove('photos', record.logoId); forgetPhoto(record.logoId); }
      record.logoId = store.newId();
      writes.push({ store: 'photos', value: { id: record.logoId, blob: logoBlob } });
    } else if (removeLogo && record.logoId) {
      await store.remove('photos', record.logoId);
      forgetPhoto(record.logoId);
      delete record.logoId;
    }
    writes.push({ store: 'shows', value: record });
    await store.putMany(writes);
    state.shows = show ? state.shows.map((s) => (s.id === show.id ? record : s)) : [...state.shows, record];
    sheet.close();
    if (!show) await selectShow(record.id); else render();
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  nameInput.addEventListener('input', () => { dirty = true; });
  const sheet = openSheet({ title: show ? t('show.edit') : t('show.new'), confirmLabel: t('common.save'), onConfirm: save, content, isDirty: () => dirty });
  drawLogo();
  if (!show) setTimeout(() => nameInput.focus(), 450);
}

/** The organiser's lead list for a show: import, re-import, remove. */
function rosterSection(show) {
  const host = h('div');
  const input = fileInput('.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', async (file) => {
    if (await importRoster(show, file)) draw();
  });
  function draw() {
    host.textContent = '';
    const roster = state.rosters.get(show.id);
    const rows = roster
      ? [
        h('div', { class: 'row' }, h('span', { class: 'row-label' }, t('roster.loaded', { count: fmtNumber(roster.entries.length) }),
          h('span', { class: 'row-sub', text: `${roster.fileName} · ${fmtDate(roster.importedAt)}` }))),
        h('button', { type: 'button', class: 'row action', onClick: () => input.click() }, icon('listImport', 'row-chevron'), h('span', { class: 'row-label', text: t('roster.reimport') })),
        h('button', {
          type: 'button', class: 'row destructive-text', text: t('roster.remove'),
          onClick: async () => {
            const ok = await actionSheet({ message: t('roster.remove.confirm'), actions: [{ label: t('roster.remove'), destructive: true, value: true }] });
            if (!ok) return;
            await store.remove('rosters', show.id);
            state.rosters.delete(show.id);
            draw();
          }
        })
      ]
      : [h('button', { type: 'button', class: 'row action', onClick: () => input.click() }, icon('listImport', 'row-chevron'), h('span', { class: 'row-label', text: t('roster.import') }))];
    host.append(section(t('roster.title'), rows, t('roster.footer')), input);
  }
  draw();
  return host;
}

/** Read the organiser's list, store the useful columns and fill in badge-only leads. */
async function importRoster(show, file) {
  let rows;
  try {
    rows = await readTable(file);
  } catch (err) {
    toast(err && err.message === 'old-excel' ? t('roster.oldExcel') : t('roster.unreadable'));
    return false;
  }
  if (rows.length < 2) { toast(t('roster.empty')); return false; }
  const idOnly = leadsOf(show.id).filter((l) => l.badgeCode && !l.badgeHasDetails);
  const detected = detectColumns(rows, idOnly.map((l) => l.badgeCode));
  if (detected.columns.code === undefined) {
    const choice = await actionSheet({
      message: t('roster.whichColumn'),
      actions: detected.header.slice(0, 15).map((name, i) => ({ label: name || t('roster.column', { n: i + 1 }), value: String(i) }))
    });
    if (choice === null) return false;
    detected.columns.code = Number(choice);
  }
  const entries = buildEntries(rows, detected);
  if (!entries.length) { toast(t('roster.empty')); return false; }
  const roster = { showId: show.id, fileName: String(file.name || '').slice(0, 120), importedAt: new Date().toISOString(), entries };
  const career = show.type === 'career';
  const updates = [];
  for (const lead of idOnly) {
    const entry = findEntry(entries, lead.badgeCode);
    const filled = entry && fillFromEntry(lead, entry, career);
    if (filled) updates.push({ ...filled, updatedAt: new Date().toISOString() });
  }
  await store.putMany([{ store: 'rosters', value: roster }, ...updates.map((value) => ({ store: 'leads', value }))]);
  state.rosters.set(show.id, roster);
  const byId = new Map(updates.map((u) => [u.id, u]));
  state.leads = state.leads.map((l) => byId.get(l.id) || l);
  hud(t('roster.done'));
  toast(idOnly.length
    ? t('roster.matched', { matched: updates.length, total: idOnly.length })
    : t('roster.stored', { count: fmtNumber(entries.length) }));
  render();
  return true;
}

async function openShowPicker() {
  const show = currentShow();
  const choice = await actionSheet({
    actions: [
      ...state.shows.slice().reverse().map((s) => ({ label: s.name + (s.id === state.showId ? ' ✓' : ''), value: s.id })),
      ...(show ? [{ label: t('show.editNamed', { name: show.name }), value: '__edit' }] : []),
      { label: t('show.new'), value: '__new' }
    ]
  });
  if (choice === '__new') openShowEditor(null);
  else if (choice === '__edit') openShowEditor(show);
  else if (choice) selectShow(choice);
}

/* ---------- Lead editor ---------- */

/**
 * @param {object|null} lead existing lead, or null for a new one
 * @param {object} [prefill] values for a new lead (from a scan or a colleague)
 */
function openLeadEditor(lead, prefill) {
  const isNew = !lead;
  const showId = lead ? lead.showId : (prefill?.showId || state.showId);
  const show = showById(showId);
  if (!show) return;
  const type = show.type;
  const data = lead ? structuredClone(lead) : {
    id: store.newId(), showId, priority: 'warm', interests: [], followups: [],
    consent: false, followedUp: false, capturedBy: me(), ...prefill
  };
  data.showId = showId;
  const interests = new Set(data.interests || []);
  const followups = new Set(data.followups || []);
  let priority = data.priority || 'warm';
  let photoId = data.photoId || null;
  let newPhotoBlob = null;
  let removePhoto = false;
  let dirty = Boolean(prefill);
  const markDirty = () => { dirty = true; };

  const fields = type === 'career'
    ? [
      ['name', t('lead.name'), { autocapitalize: 'words', autocomplete: 'off' }],
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
  const onPhoto = async (file) => {
    try {
      newPhotoBlob = await compressPhoto(file);
      removePhoto = false;
      markDirty();
      renderPhoto();
      if (callout) collapse(callout, () => callout.remove());
    } catch { toast(t('photo.unreadable')); }
  };
  const photoInput = fileInput('image/*', onPhoto);
  const cardInput = fileInput('image/*', onPhoto, 'environment');

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
      rows.push(h('button', { type: 'button', class: 'row destructive-text', text: t('lead.photo.remove'), onClick: () => { newPhotoBlob = null; removePhoto = true; markDirty(); renderPhoto(); } }));
    } else {
      rows.push(h('button', { type: 'button', class: 'row action', onClick: () => photoInput.click() },
        icon('camera', 'row-chevron'), h('span', { class: 'row-label', text: t('lead.photo.add') })));
    }
    photoRowHost.append(section(t('lead.photo'), rows, t('lead.photo.footer')));
  }

  const content = [];

  // Badge that only holds an ID: offer a business card photo straight away.
  let callout = null;
  if (isNew && data.badgeCode && !data.badgeHasDetails && !photoId) {
    callout = data.matchedFromList
      ? h('div', { class: 'callout' }, iconTile('listImport', 'brand'),
        h('h3', { text: t('lead.matched.title') }), h('p', { text: t('lead.matched.body') }))
      : h('div', { class: 'callout' }, iconTile('camera', 'orange'),
        h('h3', { text: t('lead.idOnly.title') }), h('p', { text: t('lead.idOnly.body') }),
        h('button', { type: 'button', class: 'callout-button', onClick: () => cardInput.click() }, icon('camera'), t('lead.idOnly.photo')));
    content.push(callout);
  }

  if (isNew && !prefill) {
    content.push(section(null, [h('button', {
      type: 'button', class: 'row action',
      onClick: () => { sheet.close(); setTimeout(openScanner, 200); }
    }, icon('qr', 'row-chevron'), h('span', { class: 'row-label', text: t('capture.scan') }))]));
  }
  content.push(section(type === 'career' ? t('lead.section.student') : t('lead.section.contact'),
    fields.map(([key, label, opts]) => fieldRow(`lead-${key}`, label, data[key], opts))));
  content.push(errorEl);
  content.push(section(type === 'career' ? t('lead.interests.career') : t('lead.interests.business'),
    checklist(type === 'career' ? options().career : options().business, interests, markDirty)));
  content.push(section(t('lead.followups'), checklist(options().followups, followups, markDirty)));
  content.push(section(t('lead.priority'), [h('div', { class: 'row segment-row' },
    segmented([
      { value: 'hot', label: t('lead.priority.hot') },
      { value: 'warm', label: t('lead.priority.warm') },
      { value: 'cold', label: t('lead.priority.cold') }
    ], priority, (v) => { priority = v; markDirty(); }, t('lead.priority')))]));
  content.push(section(t('lead.notes'), [h('div', { class: 'row textarea' },
    h('textarea', { id: 'lead-notes', 'aria-label': t('lead.notes'), placeholder: t('lead.notes.placeholder'), text: data.notes || '' }))]));

  const statusRows = [switchRow('lead-consent', t('lead.consent'), data.consent)];
  if (!isNew) statusRows.push(switchRow('lead-followed', t('lead.followedUp'), data.followedUp));
  const company = state.settings.company.trim();
  content.push(section(null, statusRows, company ? t('lead.consent.footer.company', { company }) : t('lead.consent.footer.generic')));

  content.push(photoRowHost, photoInput, cardInput);

  // The raw code is shown only for badges that carry an ID instead of contact details.
  if (data.badgeCode && !data.badgeHasDetails) {
    content.push(section(t('lead.badge'), [h('div', { class: 'row' }, h('span', { class: 'row-label', text: data.badgeCode }))],
      t('lead.badge.footer')));
  }
  if (!isNew) {
    content.push(section(null, [h('button', { type: 'button', class: 'row action', onClick: () => openHandover(data) },
      icon('qr', 'row-chevron'), h('span', { class: 'row-label', text: t('handover.title') }))], t('handover.footer')));
    const added = `${fmtDate(data.createdAt)} ${fmtTime(data.createdAt)}`;
    content.push(h('p', { class: 'section-footer centered', text: data.capturedBy ? t('lead.addedBy', { date: added, name: data.capturedBy }) : t('lead.added', { date: added }) }));
    content.push(section(null, [h('button', {
      type: 'button', class: 'row destructive', text: t('lead.delete'),
      onClick: async () => {
        const ok = await actionSheet({ message: t('lead.delete.confirm'), actions: [{ label: t('lead.delete'), destructive: true, value: true }] });
        if (!ok) return;
        await store.remove('leads', data.id);
        if (data.photoId) { await store.remove('photos', data.photoId); forgetPhoto(data.photoId); }
        state.leads = state.leads.filter((l) => l.id !== data.id);
        sheet.close();
        toast(t('lead.deleted'));
        const row = $root.querySelector(`[data-lead-id="${CSS.escape(data.id)}"]`);
        await collapse(row);
        render();
      }
    })]));
  } else if (data.capturedBy && data.capturedBy !== me()) {
    content.push(h('p', { class: 'section-footer centered', text: t('lead.from', { name: data.capturedBy }) }));
  }

  const save = async () => {
    const value = (id) => (document.getElementById(id)?.value || '').trim();
    for (const [key] of fields) data[key] = value(`lead-${key}`);
    data.notes = value('lead-notes');
    if (!(data.name || data.company || data.school || data.email || data.phone || data.badgeCode)) {
      errorEl.textContent = t('lead.required');
      errorEl.hidden = false;
      document.getElementById('lead-name').focus();
      return;
    }
    if (data.email && !isEmail(data.email)) {
      errorEl.textContent = t('lead.emailInvalid');
      errorEl.hidden = false;
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
    if (!data.createdAt) data.createdAt = now;
    if (!data.capturedBy) data.capturedBy = me();

    const writes = [];
    if (newPhotoBlob) {
      if (photoId) { await store.remove('photos', photoId); forgetPhoto(photoId); }
      photoId = store.newId();
      writes.push({ store: 'photos', value: { id: photoId, blob: newPhotoBlob } });
    } else if (removePhoto && photoId) {
      await store.remove('photos', photoId);
      forgetPhoto(photoId);
      photoId = null;
    }
    data.photoId = photoId;
    writes.push({ store: 'leads', value: data });
    await store.putMany(writes);
    state.leads = isNew ? [...state.leads, data] : state.leads.map((l) => (l.id === data.id ? data : l));
    if (isNew) {
      store.requestPersistence();
      state.flashId = data.id;
      if (data.showId !== state.showId) { state.showId = data.showId; store.setSetting('currentShow', data.showId); }
    }
    sheet.close();
    if (isNew) hud(t('lead.saved')); else toast(t('lead.updated'));
    render();
  };

  const sheet = openSheet({ title: isNew ? t('lead.new') : t('lead.edit'), confirmLabel: t('common.save'), onConfirm: save, content, isDirty: () => dirty });
  sheet.body.addEventListener('input', markDirty);
  sheet.body.addEventListener('change', markDirty);
  renderPhoto();
}

function viewPhoto(url) {
  const close = () => animate(view, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease' }).then(() => view.remove());
  const view = h('div', { class: 'photo-view', role: 'dialog', 'aria-modal': 'true', onClick: close },
    h('img', { src: url, alt: '' }),
    h('button', { type: 'button', class: 'icon-button glass close', 'aria-label': t('common.close'), onClick: close }, icon('close')));
  document.body.append(view);
}

/* ---------- Hand a lead to a colleague by QR code ---------- */

async function openHandover(lead) {
  const show = showById(lead.showId);
  let svg;
  let shortened = false;
  try {
    const { qrSvg } = await import('./qr-code.js');
    const encoded = encodeLeadQr(lead, show);
    shortened = encoded.shortened;
    svg = qrSvg(encoded.text, 'M');
  } catch {
    toast(t('handover.tooLong'));
    return;
  }
  svg.setAttribute('aria-label', t('handover.title'));
  const who = lead.name || lead.company || lead.school || lead.email || lead.phone || lead.badgeCode;
  openSheet({
    title: t('handover.title'),
    content: [
      h('div', { class: 'qr-card' }, svg),
      h('div', { class: 'sheet-intro' }, h('h3', { text: who }), h('p', { text: t('handover.body') })),
      shortened ? h('p', { class: 'section-footer centered', text: t('handover.shortened') }) : null,
      h('p', { class: 'section-footer centered', text: t('handover.noPhotos') })
    ]
  });
}

async function receiveLead(decoded) {
  if (!decoded) { toast(t('handover.invalid')); return; }
  const existing = state.leads.find((l) => l.id === decoded.lead.id);
  if (existing) { toast(t('handover.already')); openLeadEditor(existing); return; }
  let target = state.shows.find((s) => sameShow(s, { id: '', ...decoded.show })) || currentShow();
  if (!target) {
    target = { id: store.newId(), name: decoded.show.name || t('show.untitled'), type: decoded.show.type, createdAt: new Date().toISOString() };
    await store.put('shows', target);
    state.shows = [...state.shows, target];
    await selectShow(target.id);
  }
  toast(t('handover.received', { name: decoded.lead.capturedBy || t('merge.colleague') }));
  openLeadEditor(null, { ...decoded.lead, showId: target.id });
}

/* ---------- Scanner ---------- */

function platform() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

async function openScanner() {
  if (!currentShow()) return;
  const video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' });
  const frame = h('div', { class: 'frame searching hidden', 'aria-hidden': 'true' });
  const hint = h('p', { class: 'hint', role: 'status', text: t('scan.starting') });
  const panelHost = h('div');
  let closed = false;
  let found = false;
  let blocked = false;
  let permission = null;

  const photoPicker = fileInput('image/*', async (file) => {
    hint.textContent = t('scan.reading');
    const text = await decodeImageFile(file);
    if (text) confirmFound(text, null);
    else hint.textContent = t('scan.notFound');
  }, 'environment');

  const overlay = h('div', { class: 'scanner', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('scan.title') },
    video, frame, panelHost,
    h('div', { class: 'top' },
      h('h2', { text: t('scan.title') }),
      h('button', { type: 'button', class: 'icon-button glass', 'aria-label': t('common.close'), onClick: () => close() }, icon('close'))),
    h('div', { class: 'bottom' },
      hint,
      h('button', { type: 'button', class: 'button glass', onClick: () => photoPicker.click() }, icon('camera'), t('scan.photo')),
      photoPicker)
  );

  const scanner = new CameraScanner(video, (text, corners) => confirmFound(text, corners));

  function onVisible() {
    if (document.visibilityState !== 'visible' || !blocked || closed) return;
    cameraPermission().then((p) => { if (!p || p.state !== 'denied') startCamera(); });
  }
  document.addEventListener('visibilitychange', onVisible);

  function close(after) {
    if (closed) return;
    closed = true;
    scanner.stop();
    document.removeEventListener('visibilitychange', onVisible);
    if (permission) permission.onchange = null;
    document.documentElement.classList.remove('locked');
    animate(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease' }).then(() => {
      overlay.remove();
      if (after) after();
    });
  }

  function showPanel(children) {
    panelHost.textContent = '';
    panelHost.append(h('div', { class: 'panel' }, children));
    frame.classList.add('hidden');
  }

  function showPrimer() {
    hint.textContent = '';
    showPanel([
      illustration('camera'),
      h('h3', { text: t('camera.primer.title') }),
      h('p', { text: t('camera.primer.body') }),
      h('button', { type: 'button', class: 'button prominent', onClick: startCamera }, t('camera.primer.allow'))
    ]);
  }

  function showBlocked() {
    blocked = true;
    hint.textContent = '';
    const os = platform();
    const steps = [1, 2, 3].map((n) => t(`camera.steps.${os}.${n}`, { site: location.host })).filter((s) => !s.startsWith('camera.steps'));
    showPanel([
      illustration('camera'),
      h('h3', { text: t('camera.blocked.title') }),
      h('p', { text: t('camera.blocked.body') }),
      steps.length ? h('ol', null, steps.map((s) => h('li', { text: s }))) : null,
      h('button', { type: 'button', class: 'button prominent', onClick: startCamera }, t('camera.blocked.retry'))
    ]);
  }

  async function startCamera() {
    if (closed || found) return;
    hint.textContent = t('scan.starting');
    const result = await scanner.start();
    if (closed) { scanner.stop(); return; }
    if (result === 'ok') {
      blocked = false;
      panelHost.textContent = '';
      frame.classList.remove('hidden');
      hint.textContent = t('scan.hint');
      if (!state.settings.cameraAllowed) { state.settings.cameraAllowed = true; store.setSetting('cameraAllowed', true); }
    } else if (result === 'denied') {
      hint.textContent = '';
      const panel = panelHost.querySelector('.panel');
      if (blocked && panel) animate(panel, [{ transform: 'translate(-50%, -54%) translateX(-8px)' }, { transform: 'translate(-50%, -54%) translateX(6px)' }, { transform: 'translate(-50%, -54%)' }], { duration: 320 });
      else showBlocked();
    } else {
      hint.textContent = t('scan.noCamera');
    }
  }

  /** Code found: freeze, snap the frame onto the code, show a green check, then open the lead. */
  function confirmFound(text, corners) {
    if (found || closed) return;
    found = true;
    if (navigator.vibrate) navigator.vibrate(35);
    overlay.classList.add('done');
    panelHost.textContent = '';
    hint.textContent = t('scan.found');
    const box = overlay.getBoundingClientRect();
    let target = null;
    if (corners && video.videoWidth) {
      const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
      const ox = (box.width - video.videoWidth * scale) / 2;
      const oy = (box.height - video.videoHeight * scale) / 2;
      const xs = corners.map((p) => p.x * scale + ox);
      const ys = corners.map((p) => p.y * scale + oy);
      const limit = Math.min(box.width, box.height) - 32;
      const size = Math.min(limit, Math.max(96, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 28));
      const clamp = (v, max) => Math.min(Math.max(16, v), max - size - 16);
      const left = clamp((Math.max(...xs) + Math.min(...xs)) / 2 - size / 2, box.width);
      const top = clamp((Math.max(...ys) + Math.min(...ys)) / 2 - size / 2, box.height);
      target = { left, top, width: size, height: size };
    }
    frame.classList.remove('hidden', 'searching');
    const from = frame.getBoundingClientRect();
    const setRect = (r) => {
      frame.style.setProperty('--fx', `${r.left}px`);
      frame.style.setProperty('--fy', `${r.top}px`);
      frame.style.setProperty('--fw', `${r.width}px`);
      frame.style.setProperty('--fh', `${r.height}px`);
    };
    setRect(from);
    frame.classList.add('locked', 'instant');
    void frame.offsetWidth;
    frame.classList.remove('instant');
    const end = target && !reducedMotion() ? target : from;
    requestAnimationFrame(() => setRect(end));
    const check = h('div', { class: 'scan-check', 'aria-hidden': 'true' }, icon('check'));
    check.style.setProperty('--cx', `${end.left + end.width / 2}px`);
    check.style.setProperty('--cy', `${end.top + end.height / 2}px`);
    overlay.append(check);
    setTimeout(() => close(() => handleCode(text)), SCAN_CONFIRM_MS);
  }

  document.body.append(overlay);
  document.documentElement.classList.add('locked');
  animate(overlay, [{ opacity: 0, transform: 'scale(1.04)' }, { opacity: 1, transform: 'none' }], { duration: 320 });

  permission = await cameraPermission();
  if (permission) {
    permission.onchange = () => { if (permission.state === 'granted' && blocked && !closed) startCamera(); };
  }
  const known = permission ? permission.state : 'unknown';
  if (known === 'denied') showBlocked();
  else if (known !== 'granted' && !state.settings.cameraAllowed) showPrimer();
  else startCamera();
}

function handleCode(raw) {
  const code = String(raw).trim().slice(0, 4000);
  if (code.startsWith(LEAD_QR_PREFIX)) { receiveLead(decodeLeadQr(code)); return; }
  const existing = showLeads().find((l) => l.badgeCode === code);
  if (existing) {
    toast(t('scan.duplicate', { time: fmtTime(existing.createdAt) }));
    openLeadEditor(existing);
    return;
  }
  const parsed = parseContact(code);
  const show = currentShow();
  const career = show.type === 'career';
  let prefill = { badgeCode: code, badgeHasDetails: parsed.hasDetails };
  const f = parsed.fields;
  for (const key of ['name', 'email', 'phone', 'linkedin']) if (f[key]) prefill[key] = f[key];
  if (career) {
    if (f.company) prefill.school = f.company;
  } else {
    if (f.company) prefill.company = f.company;
    if (f.jobTitle) prefill.jobTitle = f.jobTitle;
    if (f.country) prefill.country = f.country;
  }
  // A badge with only an ID: look it up in the organiser's list, if one was imported.
  if (!parsed.hasDetails) {
    const roster = state.rosters.get(show.id);
    const entry = roster && findEntry(roster.entries, code);
    const filled = entry && fillFromEntry(prefill, entry, career);
    if (filled) prefill = filled;
  }
  openLeadEditor(null, prefill);
}

/* ---------- Screens ---------- */

function showLogo(show, className) {
  return show.logoId ? storedImage(show.logoId, className) : null;
}

function showTitle(show) {
  return h('div', { class: 'show-header' },
    showLogo(show, 'show-banner'),
    h('button', { type: 'button', class: 'title-button', 'aria-label': `${show.name}. ${t('show.switch')}`, onClick: openShowPicker },
      h('h1', { class: 'large-title', text: show.name }), icon('chevronDown', 'chevron')));
}

/** A big number that counts to its new value. */
function statValue(key, value) {
  const el = h('span', { class: 'value', text: value });
  const previous = state.shown[key];
  state.shown[key] = value;
  countUp(el, previous === undefined ? 0 : previous, value);
  return el;
}

function stat(key, value, label, brand) {
  return h('div', { class: `stat${brand ? ' brand' : ''}` }, statValue(key, value), h('span', { class: 'label', text: label }));
}

function leadRow(lead) {
  const showType = showById(lead.showId)?.type;
  const primary = lead.name || lead.company || lead.school || lead.email || lead.phone || t('lead.badgeOnly');
  const secondary = [
    lead.name ? (showType === 'career' ? lead.school : lead.company) : '',
    showType === 'career' ? lead.field : lead.jobTitle,
    lead.capturedBy && lead.capturedBy !== me() ? t('lead.by', { name: lead.capturedBy }) : ''
  ].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: `row lead-row${lead.id === state.flashId ? ' new' : ''}`, 'data-lead-id': lead.id, onClick: () => openLeadEditor(lead) },
    h('span', { class: `dot ${lead.priority || 'warm'}`, 'aria-label': t(`lead.priority.${lead.priority || 'warm'}`) }),
    h('span', { class: 'row-label' }, primary, secondary ? h('span', { class: 'row-sub', text: secondary }) : null),
    lead.followedUp ? icon('checkCircle', 'done') : null,
    h('span', { class: 'time', text: fmtTime(lead.createdAt) }),
    icon('chevronRight', 'row-chevron'));
}

function noShows(title) {
  return [
    h('h1', { class: 'large-title', text: title }),
    emptyState('stand', t('show.none.title'), t('show.none.body'),
      h('button', { type: 'button', class: 'button prominent', onClick: () => openShowEditor(null) }, icon('plus'), t('show.new')))
  ];
}

function captureScreen() {
  const show = currentShow();
  if (!show) return noShows(t('app.name'));
  const today = todayKey();
  const leads = showLeads();
  const leadsToday = leads.filter((l) => dayKey(l.createdAt) === today);
  const recent = leads.slice(0, 5);
  return [
    showTitle(show),
    h('p', { class: 'subtitle', text: `${show.type === 'career' ? t('show.type.career') : t('show.type.business')} · ${fmtDayLong(new Date().toISOString())}` }),
    h('div', { class: 'stats' },
      stat('today', leadsToday.length, t('capture.leadsToday'), true),
      stat('total', leads.length, t('capture.leadsTotal'))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'button prominent', onClick: () => openLeadEditor(null) }, icon('personAdd'), t('capture.newLead')),
      h('button', { type: 'button', class: 'button', onClick: openScanner }, icon('qr'), t('capture.scan'))),
    recent.length
      ? section(t('capture.recent'), recent.map(leadRow))
      : emptyState('badge', t('capture.empty.title'), t('capture.empty.body'))
  ];
}

function leadsScreen() {
  const show = currentShow();
  if (!show) return noShows(t('tab.leads'));
  const all = showLeads();
  const q = state.search.trim().toLowerCase();
  let list = all;
  if (state.leadFilter === 'hot') list = list.filter((l) => l.priority === 'hot');
  if (state.leadFilter === 'todo') list = list.filter((l) => !l.followedUp);
  if (q) {
    list = list.filter((l) => [l.name, l.company, l.school, l.field, l.jobTitle, l.country, l.email, l.notes, l.capturedBy, l.badgeCode, ...(l.interests || [])]
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
    h('p', { class: 'subtitle', text: show.name })
  ];
  if (!all.length) {
    out.push(emptyState('badge', t('leads.empty'), t('leads.empty.body')));
    return out;
  }

  // Leads that only have a badge ID: suggest importing the organiser's list.
  const waiting = all.filter(isIdOnly).length;
  if (waiting && !state.rosters.has(show.id)) {
    const input = fileInput('.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', (file) => importRoster(show, file));
    out.push(h('div', { class: 'callout' }, iconTile('listImport', 'brand'),
      h('h3', { text: t('leads.idOnly.title', { count: waiting }) }),
      h('p', { text: t('leads.idOnly.body') }),
      h('button', { type: 'button', class: 'callout-button', onClick: () => input.click() }, icon('listImport'), t('roster.import')),
      input));
  }

  out.push(
    h('div', { class: 'search' }, icon('search'), searchInput),
    h('div', { class: 'filter' }, segmented([
      { value: 'all', label: t('leads.filter.all') },
      { value: 'hot', label: t('leads.filter.hot') },
      { value: 'todo', label: t('leads.filter.todo') }
    ], state.leadFilter, (v) => { state.leadFilter = v; setTimeout(render, 120); }, t('tab.leads')))
  );
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
  const grow = state.animateBars;
  return h('div', { class: 'group chart' }, h('div', { class: 'bar-list' }, items.map((item, index) => {
    const track = h('div', { class: 'bar-track', 'aria-hidden': 'true' });
    const seg = h('span', { class: 'a' });
    seg.style.width = `${max ? (item.total / max) * 100 : 0}%`;
    track.append(seg);
    if (grow) requestAnimationFrame(() => animate(seg, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 650, delay: 60 + index * 45, easing: EASE_IOS, fill: 'backwards' }));
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
  for (const l of leads) {
    const d = new Date(l.createdAt);
    const sort = `${dayKey(l.createdAt)} ${String(d.getHours()).padStart(2, '0')}`;
    const label = `${multiDay ? `${fmtDate(l.createdAt)} ` : ''}${String(d.getHours()).padStart(2, '0')}:00`;
    const b = buckets.get(sort) || { label, sort, leads: 0 };
    b.leads++;
    buckets.set(sort, b);
  }
  return [...buckets.values()].sort((a, b) => a.sort.localeCompare(b.sort));
}

function reportScreen() {
  const show = currentShow();
  if (!show) return noShows(t('tab.report'));
  const leads = showLeads();
  const header = [h('h1', { class: 'large-title', text: t('tab.report') }), h('p', { class: 'subtitle', text: show.name })];
  if (!leads.length) return [...header, emptyState('report', t('report.empty.title'), t('report.empty.body'))];
  const career = show.type === 'career';
  const hours = hourBuckets(leads).map((b) => ({ label: b.label, total: b.leads }));
  const people = tally(leads.map((l) => l.capturedBy).filter(Boolean));

  return [
    ...header,
    h('div', { class: 'metric-grid' },
      stat('r-leads', leads.length, t('report.leads'), true),
      stat('r-hot', leads.filter((l) => l.priority === 'hot').length, t('report.hot')),
      stat('r-consent', leads.filter((l) => l.consent).length, t('report.consent')),
      stat('r-todo', leads.filter((l) => !l.followedUp).length, t('report.todo'))),
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
    people.length > 1
      ? h('section', { class: 'section' }, h('h2', { class: 'section-header', text: t('report.byPerson') }), bars(people, t('report.nothing')))
      : null,
    section(t('report.export'), [
      h('button', { type: 'button', class: 'row action', onClick: () => exportShow('xlsx') }, icon('share', 'row-chevron'), h('span', { class: 'row-label', text: t('report.export.xlsx') })),
      h('button', { type: 'button', class: 'row action', onClick: () => exportShow('csv') }, icon('share', 'row-chevron'), h('span', { class: 'row-label', text: t('report.export.csv') }))
    ], t('report.export.footer'))
  ];
}

/* ---------- Settings ---------- */

const OPTION_LISTS = {
  business: { title: 'settings.options.business', tile: ['tag', 'orange'] },
  career: { title: 'settings.options.career', tile: ['gradcap', 'purple'] },
  followups: { title: 'settings.options.followups', tile: ['checklist', 'teal'] }
};

function openOptionsPage(listKey) {
  pushPage({
    title: t(OPTION_LISTS[listKey].title),
    onPop: () => render(),
    render: (page) => optionsPageContent(listKey, page)
  });
}

function optionsPageContent(listKey, page) {
  const list = options()[listKey];
  const save = () => store.setSetting('options', options());
  const rows = list.map((value, index) => {
    const row = h('div', { class: 'row', 'data-index': String(index) },
      h('button', {
        type: 'button', class: 'mini-button remove', 'aria-label': `${t('common.delete')} ${value}`,
        onClick: () => collapse(row, async () => {
          const at = list.indexOf(value);
          if (at < 0) return;
          list.splice(at, 1);
          await save();
          page.refresh();
          toast(t('options.removed', { value }), {
            label: t('common.undo'),
            run: async () => { list.splice(Math.min(at, list.length), 0, value); await save(); page.refresh(); }
          });
        })
      }, icon('minusCircle')),
      h('span', { class: 'row-label', text: value }),
      h('span', { class: 'grip', role: 'img', 'aria-label': t('options.reorder', { value }) }, icon('grip')));
    return row;
  });
  const input = h('input', { type: 'text', placeholder: t('settings.options.add'), 'aria-label': t('settings.options.add'), enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'sentences' });
  const add = async () => {
    const value = input.value.trim();
    if (!value) return;
    if (list.includes(value)) { input.value = ''; toast(t('options.exists')); return; }
    list.push(value);
    await save();
    page.refresh();
    const again = page.body.querySelector('input');
    if (again) again.focus();
    const rowsNow = page.body.querySelectorAll('.row[data-index]');
    const last = rowsNow[rowsNow.length - 1];
    if (last) animate(last, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 350 });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  rows.push(h('div', { class: 'row field' },
    h('button', { type: 'button', class: 'mini-button add', 'aria-label': t('common.add'), onClick: add }, icon('plus')),
    input));
  const group = h('div', { class: 'group reorder' }, rows);
  enableReorder(group, list, async () => { await save(); page.refresh(); });
  return [h('section', { class: 'section' }, group,
    h('p', { class: 'section-footer', text: t('options.footer') }))];
}

/** Drag the grip of a row to move it, as in iPhone edit mode. */
function enableReorder(group, list, onDone) {
  group.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest('.grip');
    if (!grip) return;
    const row = grip.closest('.row');
    const rows = Array.from(group.querySelectorAll('.row[data-index]'));
    const from = rows.indexOf(row);
    if (from < 0) return;
    event.preventDefault();
    try { grip.setPointerCapture(event.pointerId); } catch { /* capture isn't essential */ }
    const rects = rows.map((r) => r.getBoundingClientRect());
    const startY = event.clientY;
    const height = rects[from].height;
    let to = from;
    row.classList.add('lifted');
    group.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(8);
    const offsetFor = (index) => {
      if (index > from) return rects.slice(from + 1, index + 1).reduce((s, r) => s + r.height, 0);
      if (index < from) return -rects.slice(index, from).reduce((s, r) => s + r.height, 0);
      return 0;
    };
    const move = (e) => {
      const dy = Math.max(rects[0].top - rects[from].top, Math.min(rects.at(-1).bottom - rects[from].bottom, e.clientY - startY));
      row.style.setProperty('--dy', `${dy}px`);
      const centre = rects[from].top + height / 2 + dy;
      to = from;
      for (let i = 0; i < from; i++) if (centre < rects[i].top + rects[i].height / 2) { to = i; break; }
      for (let i = rows.length - 1; i > from; i--) if (centre > rects[i].top + rects[i].height / 2) { to = i; break; }
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -height;
        if (to < from && i >= to && i < from) shift = height;
        r.classList.add('shifting');
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      row.style.setProperty('--dy', `${offsetFor(to)}px`);
      row.classList.add('settling');
      setTimeout(async () => {
        group.classList.remove('dragging');
        if (to !== from) {
          const [moved] = list.splice(from, 1);
          list.splice(to, 0, moved);
          if (navigator.vibrate) navigator.vibrate(8);
        }
        await onDone();
      }, reducedMotion() ? 0 : 260);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
}

function openLanguagePage() {
  pushPage({
    title: t('settings.language'),
    onPop: () => { renderTabbar(); render(); },
    render: (page) => [section(null, LANGUAGES.map((lang) => {
      const row = h('button', { type: 'button', class: 'row', role: 'radio', 'aria-checked': String(state.settings.language === lang.code) },
        h('span', { class: 'row-label', text: lang.label || t(lang.labelKey) }), icon('check', 'check'));
      row.addEventListener('click', async () => {
        state.settings.language = lang.code;
        await store.setSetting('language', lang.code);
        setLanguage(lang.code);
        page.page.querySelector('.page-nav h1').textContent = t('settings.language');
        page.refresh();
      });
      return row;
    }), t('settings.language.footer'))]
  });
}

function languageLabel() {
  const lang = LANGUAGES.find((l) => l.code === state.settings.language) || LANGUAGES[0];
  return lang.label || t(lang.labelKey);
}

function settingsScreen() {
  const nameRow = fieldRow('set-name', t('settings.name'), state.settings.userName, { tile: ['person', 'grey'], autocomplete: 'name', autocapitalize: 'words', enterkeyhint: 'done' });
  const nameInput = nameRow.querySelector('input');
  nameInput.addEventListener('change', async () => {
    const value = nameInput.value.trim();
    if (!value) { nameInput.value = state.settings.userName; toast(t('settings.name.required')); return; }
    state.settings.userName = value;
    await store.setSetting('userName', value);
  });
  const companyRow = fieldRow('set-company', t('settings.company'), state.settings.company, { tile: ['building', 'indigo'], autocomplete: 'organization', autocapitalize: 'words', enterkeyhint: 'done' });
  const companyInput = companyRow.querySelector('input');
  companyInput.addEventListener('change', async () => {
    state.settings.company = companyInput.value.trim();
    await store.setSetting('company', state.settings.company);
  });
  for (const input of [nameInput, companyInput]) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  const showRows = state.shows.slice().reverse().map((s) => navRow({
    tile: s.logoId ? storedImage(s.logoId, 'icon-tile') : iconTile('calendar', 'red'),
    label: s.name,
    sub: `${s.type === 'career' ? t('show.type.career') : t('show.type.business')} · ${t('settings.leadCount', { count: leadsOf(s.id).length })}`,
    onClick: () => openShowEditor(s)
  }));
  showRows.push(h('button', { type: 'button', class: 'row action', onClick: () => openShowEditor(null) }, icon('plus', 'row-chevron'), h('span', { class: 'row-label', text: t('settings.addShow') })));

  const storageValue = h('span', { class: 'row-value', text: '…' });
  store.isPersisted().then((p) => { storageValue.textContent = p ? t('settings.storage.persisted') : t('settings.storage.temporary'); });

  const restoreInput = fileInput('application/json,.json', restoreBackup);
  const mergeInput = fileInput('application/json,.json', mergeFromFile);

  const tileRow = (tile, label, onClick) => h('button', { type: 'button', class: 'row with-tile', onClick },
    iconTile(tile[0], tile[1]), h('span', { class: 'row-label', text: label }));

  return [
    h('h1', { class: 'large-title', text: t('tab.settings') }),
    h('div', { class: 'spacer' }),
    section(null, [
      navRow({ tile: ['send', 'green'], label: t('send.title'), onClick: sendToColleague }),
      navRow({ tile: ['merge', 'blue'], label: t('merge.title'), onClick: () => mergeInput.click() }),
      mergeInput
    ], t('settings.colleagues.footer')),
    section(null, [nameRow, companyRow]),
    section(null, [navRow({ tile: ['globe', 'blue'], label: t('settings.language'), value: languageLabel(), onClick: openLanguagePage })]),
    section(t('settings.shows'), showRows),
    section(t('settings.lists'), Object.entries(OPTION_LISTS).map(([key, def]) => navRow({
      tile: def.tile, label: t(def.title), value: String(options()[key].length), onClick: () => openOptionsPage(key)
    }))),
    section(t('settings.data'), [
      tileRow(['backup', 'grey'], t('settings.backup'), backupAll),
      tileRow(['restore', 'grey'], t('settings.restore'), () => restoreInput.click()),
      h('div', { class: 'row with-tile' }, iconTile('storage', 'grey'), h('span', { class: 'row-label', text: t('settings.storage') }), storageValue),
      restoreInput
    ], t('settings.data.footer')),
    section(t('settings.about'), [
      h('div', { class: 'row with-tile' }, iconTile('info', 'grey'), h('span', { class: 'row-label', text: t('settings.version') }), h('span', { class: 'row-value', text: APP_VERSION })),
      h('div', { class: 'row with-tile' }, iconTile('doc', 'grey'), h('span', { class: 'row-label' }, t('settings.licenses'), h('span', { class: 'row-sub', text: t('settings.licenses.body') })))
    ])
  ];
}

/* ---------- Colleagues: send and merge ---------- */

async function sendToColleague() {
  if (!state.shows.length) { toast(t('send.noShows')); return; }
  let show = currentShow();
  if (state.shows.length > 1) {
    const id = await actionSheet({
      message: t('send.which'),
      actions: state.shows.slice().reverse().map((s) => ({ label: `${s.name} (${leadsOf(s.id).length})`, value: s.id }))
    });
    if (!id) return;
    show = showById(id);
  }
  const leads = leadsOf(show.id);
  if (!leads.length) { toast(t('send.empty', { show: show.name })); return; }
  const photoIds = leads.map((l) => l.photoId).filter(Boolean);
  let includePhotos = photoIds.length > 0;
  let prepared = null;

  const sendButton = h('button', { type: 'button', class: 'button prominent', disabled: true }, icon('share'), t('send.button'));
  const prepare = async () => {
    prepared = null;
    sendButton.disabled = true;
    const photos = includePhotos ? await encodePhotos(photoIds) : [];
    const file = buildShowFile({ show, leads: includePhotos ? leads : leads.map((l) => ({ ...l, photoId: null })), photos, sentBy: me() });
    prepared = {
      blob: new Blob([JSON.stringify(file)], { type: 'application/json' }),
      name: `LeadLog-${fileSafe(show.name)}-${fileSafe(me())}.json`
    };
    sendButton.disabled = false;
  };
  // The file is prepared before the tap, so the share sheet opens straight away.
  sendButton.addEventListener('click', async () => {
    if (!prepared) return;
    const result = await deliverFile(prepared.blob, prepared.name);
    if (result === 'shared' || result === 'downloaded') { sheet.close(); hud(t('send.done')); }
  });

  const content = [
    h('div', { class: 'sheet-intro' }, illustration('exchange', 'small'),
      h('h3', { text: show.name }),
      h('p', { text: t('send.body', { count: leads.length }) })),
    photoIds.length ? section(null, [switchRow('send-photos', t('send.photos', { count: photoIds.length }), includePhotos)], t('send.photos.footer')) : null,
    h('div', { class: 'sheet-actions' }, sendButton),
    h('p', { class: 'section-footer centered', text: t('send.footer') })
  ];
  const sheet = openSheet({ title: t('send.title'), content });
  const toggle = sheet.body.querySelector('#send-photos');
  if (toggle) toggle.addEventListener('change', () => { includePhotos = toggle.checked; prepare(); });
  prepare();
}

async function mergeFromFile(file) {
  let data = null;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (data && data.app === 'leadlog' && !data.kind && Array.isArray(data.leads)) { toast(t('merge.isBackup')); return; }
  const incoming = readShowFile(data);
  if (!incoming) { toast(t('merge.invalid')); return; }
  const plan = planMerge({ shows: state.shows, leads: state.leads }, incoming);
  const from = incoming.sentBy || t('merge.colleague');
  if (!plan.add.length) { toast(t('merge.nothing', { show: plan.target.name })); return; }
  const message = plan.skipped
    ? t('merge.confirm.skipped', { count: plan.add.length, from, show: plan.target.name, skipped: plan.skipped })
    : t('merge.confirm', { count: plan.add.length, from, show: plan.target.name });
  const ok = await actionSheet({ message, actions: [{ label: t('merge.action'), value: true }] });
  if (!ok) return;

  const writes = [];
  if (plan.isNewShow) writes.push({ store: 'shows', value: plan.target });
  const photos = new Map(incoming.photos.map((p) => [p.id, p]));
  for (const lead of plan.add) {
    const photo = lead.photoId && photos.get(lead.photoId);
    if (photo) {
      try { writes.push({ store: 'photos', value: { id: photo.id, blob: base64ToBlob(photo.data, photo.type) } }); } catch { lead.photoId = null; }
    } else lead.photoId = null;
    writes.push({ store: 'leads', value: lead });
  }
  await store.putMany(writes);
  if (plan.isNewShow) state.shows = [...state.shows, plan.target];
  state.leads = [...state.leads, ...plan.add];
  state.showId = plan.target.id;
  await store.setSetting('currentShow', plan.target.id);
  hud(t('merge.done'));
  toast(t('merge.added', { count: plan.add.length, from }));
  render();
}

/* ---------- Export, backup, restore ---------- */

/** The badge code is exported only when the badge held an ID rather than contact details. */
const badgeId = (lead) => (lead.badgeCode && !lead.badgeHasDetails ? lead.badgeCode : '');

function leadTable(show, leads) {
  const yes = (b) => (b ? t('export.yes') : t('export.no'));
  const career = show.type === 'career';
  const columns = career
    ? [['export.date', 11], ['export.time', 7], ['lead.name', 22], ['lead.school', 24], ['lead.field', 20], ['lead.year', 12], ['lead.email', 26], ['lead.phone', 16], ['lead.linkedin', 28], ['lead.interests.career', 28], ['lead.followups', 26], ['lead.priority', 9], ['lead.notes', 40], ['lead.consent', 12], ['lead.followedUp', 11], ['export.capturedBy', 20], ['lead.badge', 20]]
    : [['export.date', 11], ['export.time', 7], ['lead.name', 22], ['lead.company', 24], ['lead.jobTitle', 20], ['lead.country', 14], ['lead.email', 26], ['lead.phone', 16], ['lead.interests.business', 28], ['lead.followups', 26], ['lead.priority', 9], ['lead.notes', 40], ['lead.consent', 12], ['lead.followedUp', 11], ['export.capturedBy', 20], ['lead.badge', 20]];
  const rows = leads.slice().reverse().map((l) => {
    const common = [dayKey(l.createdAt), fmtTime(l.createdAt), l.name || ''];
    const priority = t(`lead.priority.${l.priority || 'warm'}`);
    const tail = [(l.interests || []).join(', '), (l.followups || []).join(', '), priority, l.notes || '', yes(l.consent), yes(l.followedUp), l.capturedBy || '', badgeId(l)];
    return career
      ? [...common, l.school || '', l.field || '', l.year || '', l.email || '', l.phone || '', l.linkedin || '', ...tail]
      : [...common, l.company || '', l.jobTitle || '', l.country || '', l.email || '', l.phone || '', ...tail];
  });
  return { header: columns.map(([key]) => t(key)), widths: columns.map(([, w]) => w), rows };
}

async function exportShow(format) {
  const show = currentShow();
  if (!show) return;
  const { header, widths, rows } = leadTable(show, showLeads());
  const name = `${fileSafe(show.name)}-leads`;
  if (format === 'csv') {
    await deliverFile(buildCsv([header, ...rows]), `${name}.csv`);
    return;
  }
  const hours = hourBuckets(showLeads()).map((b) => [b.sort.replace(/ (\d\d)$/, ' $1:00'), b.leads]);
  const blob = buildXlsx([
    { name: t('export.sheet.leads'), rows: [header, ...rows], widths },
    { name: t('export.sheet.hours'), rows: [[t('export.hour'), t('report.leads')], ...hours], widths: [18, 10] }
  ]);
  await deliverFile(blob, `${name}.xlsx`);
}

async function backupAll() {
  const [shows, leads, settings, photos, rosters] = await Promise.all([
    store.getAll('shows'), store.getAll('leads'), store.getAll('settings'), store.getAll('photos'), store.getAll('rosters')
  ]);
  const encodedPhotos = [];
  for (const p of photos) encodedPhotos.push({ id: p.id, type: p.blob.type, data: await blobToBase64(p.blob) });
  const backup = { app: 'leadlog', format: 2, exportedAt: new Date().toISOString(), shows, leads, settings, rosters, photos: encodedPhotos };
  const stamp = new Date().toISOString().slice(0, 10);
  await deliverFile(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `LeadLog-backup-${stamp}.json`);
}

async function restoreBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    backup = null;
  }
  if (backup && backup.kind === 'show-share') { toast(t('restore.isShare')); return; }
  if (!backup || backup.app !== 'leadlog' || !Array.isArray(backup.leads) || !Array.isArray(backup.shows)) {
    toast(t('settings.restoreFailed'));
    return;
  }
  const ok = await actionSheet({ message: t('restore.confirm', { count: backup.leads.length }), actions: [{ label: t('settings.restore'), value: true }] });
  if (!ok) return;
  const isRecord = (r) => r && typeof r === 'object' && typeof r.id === 'string';
  const writes = [];
  backup.shows.filter(isRecord).forEach((value) => writes.push({ store: 'shows', value }));
  backup.leads.filter(isRecord).forEach((value) => writes.push({ store: 'leads', value }));
  (backup.settings || []).filter((s) => s && typeof s.key === 'string').forEach((value) => writes.push({ store: 'settings', value }));
  (backup.rosters || []).filter((r) => r && typeof r.showId === 'string' && Array.isArray(r.entries)).forEach((value) => writes.push({ store: 'rosters', value }));
  for (const p of (backup.photos || []).filter(isRecord)) {
    try { writes.push({ store: 'photos', value: { id: p.id, blob: base64ToBlob(p.data, p.type) } }); } catch { /* skip a damaged photo */ }
  }
  await store.putMany(writes);
  await loadAll();
  renderTabbar();
  render();
  hud(t('restore.done'));
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
  $tabbar.append(h('span', { class: 'tab-indicator', 'aria-hidden': 'true' }));
  for (const tab of TABS) {
    const b = h('button', { type: 'button', role: 'tab', 'data-tab': tab.id, 'aria-selected': String(state.tab === tab.id), 'aria-controls': 'screen' },
      icon(tab.icon), h('span', { text: t(`tab.${tab.id}`) }));
    b.addEventListener('click', () => selectTab(tab.id));
    $tabbar.append(b);
  }
  $tabbar.style.setProperty('--tab-i', String(TABS.findIndex((tab) => tab.id === state.tab)));
}

function selectTab(id) {
  popAllPages();
  if (state.tab === id) { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); return; }
  state.tab = id;
  for (const b of $tabbar.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
  $tabbar.style.setProperty('--tab-i', String(TABS.findIndex((tab) => tab.id === id)));
  state.animateBars = id === 'report';
  window.scrollTo(0, 0);
  render({ enter: true });
  state.animateBars = false;
}

function render(opts = {}) {
  const screens = { capture: captureScreen, leads: leadsScreen, report: reportScreen, settings: settingsScreen };
  const children = screens[state.tab]();
  $root.textContent = '';
  append($root, children);
  if (opts.enter && !reducedMotion()) {
    $root.classList.remove('entering');
    void $root.offsetWidth;
    $root.classList.add('entering');
  }
  const show = currentShow();
  $navTitle.textContent = state.tab === 'capture' ? (show ? show.name : t('app.name')) : t(`tab.${state.tab}`);
  document.title = t('app.name');
  updateNavbar();
  state.flashId = null;
}

$root.addEventListener('animationend', (e) => { if (e.target === $root) $root.classList.remove('entering'); });

let navFrame = 0;
function updateNavbar() {
  cancelAnimationFrame(navFrame);
  navFrame = requestAnimationFrame(() => {
    const p = Math.min(1, Math.max(0, (window.scrollY - 12) / 28));
    $navbar.style.setProperty('--nav-p', p.toFixed(3));
  });
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

/* ---------- Status bar colour ---------- */

/**
 * iPhone Home Screen apps colour the status bar from theme-color but ignore
 * per-mode (media) variants, so one value is kept in step with light/dark mode.
 */
function syncStatusBar() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const meta = document.getElementById('theme-color');
  const apply = () => { if (meta) meta.setAttribute('content', dark.matches ? '#061c21' : '#e8f1f2'); };
  apply();
  dark.addEventListener('change', apply);
}

/* ---------- Start ---------- */

async function start() {
  installMotion();
  syncStatusBar();
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
  render({ enter: true });
  window.addEventListener('scroll', updateNavbar, { passive: true });
  registerServiceWorker();
  if (!state.settings.userName) await showWelcome();
}

start();
