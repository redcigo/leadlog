/**
 * The organiser's lead list: many exhibitions give badges that only hold an
 * ID, and send exhibitors a spreadsheet of the people they scanned after the
 * show. This module reads that file (CSV or Excel .xlsx), finds the badge
 * code column, and matches it with leads that only have a badge code.
 * Only the columns LeadLog uses are kept.
 */

/* ---------- Reading files ---------- */

/** @returns {Promise<string[][]>} rows of cell text */
export async function readTable(file) {
  const name = (file.name || '').toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || name.endsWith('.xlsx')) return readXlsx(bytes);
  if (name.endsWith('.xls') && bytes[0] === 0xd0) throw new Error('old-excel');
  return parseCsv(decodeText(bytes));
}

/** UTF-8 first; Czech Excel often saves CSV as Windows-1250. */
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try { return new TextDecoder('windows-1250').decode(bytes); } catch { return new TextDecoder('iso-8859-1').decode(bytes); }
  }
}

/** RFC 4180 CSV with the delimiter detected from the first line (comma, semicolon or tab). */
export function parseCsv(text) {
  const newline = text.indexOf('\n');
  const firstLine = newline < 0 ? text : text.slice(0, newline);
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

/* Minimal .xlsx reader: unzip (stored or deflate) and read the first worksheet. */

async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not-zip');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    files.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return async (name) => {
    const entry = files.get(name);
    if (!entry) return null;
    const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
    const data = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return decoder.decode(data);
    if (entry.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('unsupported-zip');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

function columnIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/i);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(bytes) {
  const read = await unzip(bytes);
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const textOf = (node) => Array.from(node.getElementsByTagName('t')).map((t) => t.textContent).join('');

  const shared = [];
  const sharedXml = await read('xl/sharedStrings.xml');
  if (sharedXml) for (const si of parse(sharedXml).getElementsByTagName('si')) shared.push(textOf(si));

  // Find the first sheet through the workbook relationships.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const first = parse(workbook).getElementsByTagName('sheet')[0];
    const relId = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = Array.from(parse(rels).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === relId);
    if (rel) {
      const target = rel.getAttribute('Target');
      sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    }
  }
  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error('no-sheet');

  const rows = [];
  for (const rowEl of parse(sheetXml).getElementsByTagName('row')) {
    const row = [];
    let next = 0;
    for (const c of rowEl.getElementsByTagName('c')) {
      const index = c.hasAttribute('r') ? columnIndex(c.getAttribute('r')) : next;
      next = index + 1;
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0];
      let value = '';
      if (type === 's') value = shared[Number(v && v.textContent)] || '';
      else if (type === 'inlineStr') value = textOf(c);
      else if (v) value = v.textContent;
      row[index] = String(value).trim();
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    if (row.some((cell) => cell)) rows.push(row);
  }
  return rows;
}

/* ---------- Columns ---------- */

const PATTERNS = {
  email: /e-?mail/i,
  phone: /phone|tel\b|telefon|mobile|mobil|gsm/i,
  first: /first ?name|given|forename|^jm[ée]no$|k[řr]estn|vorname|pr[ée]nom/i,
  last: /last ?name|surname|family|p[řr][íi]jmen[íi]|nachname|^nom$/i,
  name: /^(full ?)?name$|contact|jm[ée]no a p[řr][íi]jmen[íi]|cel[ée] jm[ée]no|visitor name|attendee name|^name\b/i,
  company: /company|organi[sz]ation|firma|spole[čc]nost|employer|unternehmen|soci[ée]t[ée]|instituc/i,
  jobTitle: /job|title|position|pozice|funkce|role|designation/i,
  country: /country|zem[ěe]|st[áa]t\b|land|pays|nation/i,
  code: /badge|barcode|bar code|\bqr\b|code|k[óo]d|\bid\b|registration|reg\.? ?(no|number)|ticket|attendee|visitor|number|[čc][íi]slo/i
};

/**
 * Find the header row and the columns LeadLog can use.
 * The badge code column is chosen by matching cell values with the badge codes
 * already scanned; the column names are only a fallback.
 * @param {string[][]} rows @param {string[]} codes badge codes of ID-only leads
 */
export function detectColumns(rows, codes) {
  const headerIndex = Math.max(0, rows.slice(0, 10).findIndex((r) => r.filter((c) => /[a-zá-ž]/i.test(c)).length >= 2));
  const header = rows[headerIndex] || [];
  const body = rows.slice(headerIndex + 1);
  const columns = {};
  const taken = new Set();
  for (const key of ['email', 'phone', 'first', 'last', 'name', 'company', 'jobTitle', 'country']) {
    const index = header.findIndex((h, i) => !taken.has(i) && PATTERNS[key].test(h));
    if (index >= 0) { columns[key] = index; taken.add(index); }
  }
  // Badge code: the column whose values match the most scanned codes.
  let best = { index: -1, hits: 0 };
  if (codes.length) {
    const width = Math.max(...rows.map((r) => r.length));
    for (let i = 0; i < width; i++) {
      const values = body.map((r) => r[i] || '').filter(Boolean);
      const hits = codes.filter((code) => values.some((v) => codesMatch(code, v))).length;
      if (hits > best.hits) best = { index: i, hits };
    }
  }
  if (best.index >= 0) columns.code = best.index;
  else {
    const index = header.findIndex((h, i) => !taken.has(i) && PATTERNS.code.test(h));
    if (index >= 0) columns.code = index;
  }
  return { headerIndex, header, columns, codeHits: best.hits };
}

/** Badge text and a list value match when equal, or when one is a whole part of the other (IDs inside URLs). */
export function codesMatch(code, value) {
  // Spreadsheets drop leading zeros from numbers, so compare numbers without them.
  const clean = (v) => String(v || '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
  const a = clean(code);
  const b = clean(value);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length < 4) return false;
  const parts = (v) => v.split(/[^a-z0-9]+/).map(clean);
  return parts(a).includes(b) || (a.length >= 4 && parts(b).includes(a));
}

/** Keep only the fields LeadLog uses. */
export function buildEntries(rows, { headerIndex, columns }) {
  const cell = (row, key) => (columns[key] === undefined ? '' : String(row[columns[key]] || '').trim());
  return rows.slice(headerIndex + 1).map((row) => ({
    code: cell(row, 'code'),
    name: cell(row, 'name') || [cell(row, 'first'), cell(row, 'last')].filter(Boolean).join(' '),
    company: cell(row, 'company'),
    jobTitle: cell(row, 'jobTitle'),
    email: cell(row, 'email'),
    phone: cell(row, 'phone'),
    country: cell(row, 'country')
  })).filter((e) => e.code);
}

export function findEntry(entries, code) {
  return entries.find((e) => codesMatch(code, e.code)) || null;
}

/**
 * Fill empty fields of a lead from a list entry. Never overwrites what was typed.
 * @returns {object|null} the updated lead, or null when nothing changed
 */
export function fillFromEntry(lead, entry, career) {
  const map = career
    ? { name: 'name', school: 'company', email: 'email', phone: 'phone' }
    : { name: 'name', company: 'company', jobTitle: 'jobTitle', email: 'email', phone: 'phone', country: 'country' };
  const updated = { ...lead };
  let changed = false;
  for (const [leadKey, entryKey] of Object.entries(map)) {
    if (!updated[leadKey] && entry[entryKey]) { updated[leadKey] = entry[entryKey]; changed = true; }
  }
  if (!changed) return null;
  updated.matchedFromList = true;
  return updated;
}
