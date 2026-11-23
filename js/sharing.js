/**
 * Sharing leads between colleagues, without any server:
 *  - a show file (JSON) sent through the share sheet and merged on the other phone
 *  - a single lead handed over as a QR code
 * The functions here are pure (no storage, no interface) so they are easy to test.
 */

const SHOW_FILE_KIND = 'show-share';
export const LEAD_QR_PREFIX = 'LEADLOG:1:';

/* ---------- Matching helpers ---------- */

const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Same show on two phones: same name and type (each phone creates its own id). */
export function sameShow(a, b) {
  return a.id === b.id || (norm(a.name) === norm(b.name) && (a.type || 'business') === (b.type || 'business'));
}

/** Keys that identify the same person, used to skip duplicates. */
function leadKeys(lead) {
  const keys = [`id:${lead.id}`];
  if (lead.badgeCode) keys.push(`badge:${norm(lead.badgeCode)}`);
  if (lead.email) keys.push(`email:${norm(lead.email)}`);
  const org = lead.company || lead.school;
  if (lead.name && org) keys.push(`person:${norm(lead.name)}|${norm(org)}`);
  return keys;
}

/* ---------- Show file ---------- */

/**
 * @param {{show: object, leads: object[], photos: {id: string, type: string, data: string}[], sentBy: string}} input
 */
export function buildShowFile({ show, leads, photos, sentBy }) {
  return {
    app: 'leadlog',
    kind: SHOW_FILE_KIND,
    format: 1,
    sentAt: new Date().toISOString(),
    sentBy: sentBy || '',
    show: { id: show.id, name: show.name, type: show.type, createdAt: show.createdAt },
    leads: leads.map((l) => ({ ...l, capturedBy: l.capturedBy || sentBy || '' })),
    photos
  };
}

const isRecord = (r) => r && typeof r === 'object' && typeof r.id === 'string';

/** Validate a parsed show file. Returns null when it isn't one. */
export function readShowFile(data) {
  if (!data || data.app !== 'leadlog' || data.kind !== SHOW_FILE_KIND || !isRecord(data.show) || !Array.isArray(data.leads)) return null;
  const show = {
    id: data.show.id,
    name: String(data.show.name || '').slice(0, 200) || 'Show',
    type: data.show.type === 'career' ? 'career' : 'business',
    createdAt: typeof data.show.createdAt === 'string' ? data.show.createdAt : new Date().toISOString()
  };
  const sentBy = String(data.sentBy || '').slice(0, 120);
  const leads = data.leads.filter((l) => isRecord(l) && typeof l.createdAt === 'string')
    .map((l) => ({ ...l, capturedBy: String(l.capturedBy || sentBy || '').slice(0, 120) }));
  const photos = (Array.isArray(data.photos) ? data.photos : []).filter((p) => isRecord(p) && typeof p.data === 'string');
  return { show, leads, photos, sentBy };
}

/**
 * Work out what a merge would do.
 * @returns {{target: object, isNewShow: boolean, add: object[], skipped: number}}
 *   add: incoming leads re-pointed to the target show; their photos are kept only if referenced
 */
export function planMerge({ shows, leads }, incoming) {
  const existing = shows.find((s) => sameShow(s, incoming.show));
  const target = existing || { ...incoming.show };
  const known = new Set(leads.filter((l) => l.showId === target.id).flatMap(leadKeys));
  const allIds = new Set(leads.map((l) => l.id));
  const add = [];
  let skipped = 0;
  for (const lead of incoming.leads) {
    const keys = leadKeys(lead);
    if (allIds.has(lead.id) || keys.some((k) => known.has(k))) { skipped++; continue; }
    keys.forEach((k) => known.add(k));
    add.push({ ...lead, showId: target.id });
  }
  return { target, isNewShow: !existing, add, skipped };
}

/* ---------- Single lead as a QR code ---------- */

const SHORT = {
  id: 'i', name: 'n', company: 'c', jobTitle: 'j', country: 'k', email: 'e', phone: 'p',
  school: 's', field: 'f', year: 'y', linkedin: 'l', notes: 'o', priority: 'r',
  createdAt: 't', capturedBy: 'b', badgeCode: 'g'
};
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));

/** Most bytes a handover QR should hold so phone cameras still read it easily. */
export const LEAD_QR_MAX = 900;

/**
 * Encode one lead (without photos) for a QR code. Notes are shortened if needed;
 * throws 'too-long' if the lead still doesn't fit.
 * @returns {{text: string, shortened: boolean}}
 */
export function encodeLeadQr(lead, show) {
  const payload = { v: 1, sh: { n: show.name, t: show.type === 'career' ? 'c' : 'b' } };
  for (const [key, short] of Object.entries(SHORT)) if (lead[key]) payload[short] = lead[key];
  if (lead.interests && lead.interests.length) payload.in = lead.interests;
  if (lead.followups && lead.followups.length) payload.fu = lead.followups;
  if (lead.consent) payload.cn = 1;
  if (lead.badgeCode && !lead.badgeHasDetails) payload.gi = 1;
  const bytes = (p) => new TextEncoder().encode(LEAD_QR_PREFIX + JSON.stringify(p)).length;
  let shortened = false;
  while (bytes(payload) > LEAD_QR_MAX && payload.o) {
    payload.o = payload.o.slice(0, Math.max(0, payload.o.length - 40)).trimEnd();
    if (payload.o.length < 20) delete payload.o;
    shortened = true;
  }
  if (bytes(payload) > LEAD_QR_MAX) throw new Error('too-long');
  return { text: LEAD_QR_PREFIX + JSON.stringify(payload), shortened };
}

/** @returns {{lead: object, show: {name: string, type: string}} | null} */
export function decodeLeadQr(text) {
  if (typeof text !== 'string' || !text.startsWith(LEAD_QR_PREFIX)) return null;
  let payload;
  try { payload = JSON.parse(text.slice(LEAD_QR_PREFIX.length)); } catch { return null; }
  if (!payload || payload.v !== 1 || typeof payload.i !== 'string') return null;
  const lead = {};
  for (const [short, key] of Object.entries(LONG)) if (typeof payload[short] === 'string') lead[key] = payload[short].slice(0, 4000);
  lead.interests = Array.isArray(payload.in) ? payload.in.filter((v) => typeof v === 'string') : [];
  lead.followups = Array.isArray(payload.fu) ? payload.fu.filter((v) => typeof v === 'string') : [];
  lead.consent = payload.cn === 1;
  if (lead.badgeCode) lead.badgeHasDetails = payload.gi !== 1;
  if (!['hot', 'warm', 'cold'].includes(lead.priority)) lead.priority = 'warm';
  const sh = payload.sh || {};
  return { lead, show: { name: String(sh.n || ''), type: sh.t === 'c' ? 'career' : 'business' } };
}
