/**
 * Turns the text inside a badge or business-card QR code into contact fields.
 *
 * Supported: vCard (2.1 to 4.0), MeCard, BIZCARD, and plain text or delimited
 * strings that contain an email address or phone number.
 * Badges that only hold an ID return no fields; the raw code is kept by the caller.
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/;

/**
 * @typedef {Object} ParsedContact
 * @property {'vcard'|'mecard'|'bizcard'|'text'|'url'|'id'} format
 * @property {{name?:string, company?:string, jobTitle?:string, email?:string,
 *   phone?:string, country?:string, linkedin?:string, url?:string}} fields
 * @property {boolean} hasDetails  true when at least a name, email or phone was found
 */

/** @param {string} text @returns {ParsedContact} */
export function parseContact(text) {
  const raw = String(text || '').trim();
  let result;
  if (/^BEGIN:VCARD/i.test(raw)) result = { format: 'vcard', fields: parseVCard(raw) };
  else if (/^MECARD:/i.test(raw)) result = { format: 'mecard', fields: parseMeCard(raw) };
  else if (/^BIZCARD:/i.test(raw)) result = { format: 'bizcard', fields: parseBizCard(raw) };
  else if (/^https?:\/\//i.test(raw)) result = { format: 'url', fields: urlFields(raw) };
  else result = parsePlain(raw);

  const f = result.fields;
  for (const key of Object.keys(f)) {
    if (typeof f[key] === 'string') f[key] = f[key].trim();
    if (!f[key]) delete f[key];
  }
  result.hasDetails = Boolean(f.name || f.email || f.phone || f.company);
  return result;
}

function urlFields(url) {
  return /linkedin\.com\//i.test(url) ? { linkedin: url } : {};
}

/* ---------- vCard ---------- */

function unescapeVCard(value) {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;:\\])/g, '$1');
}

function decodeQuotedPrintable(value, charset) {
  const softJoined = value.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < softJoined.length; i++) {
    const ch = softJoined[i];
    if (ch === '=' && /^[0-9A-F]{2}$/i.test(softJoined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(softJoined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
}

/** Split on a separator that is not escaped with a backslash. */
function splitUnescaped(value, sep) {
  const parts = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) { current += ch + value[i + 1]; i++; continue; }
    if (ch === sep) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseVCard(text) {
  // Unfold continuation lines (a line break followed by a space or tab).
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const props = [];
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const head = line.slice(0, colon);
    let value = line.slice(colon + 1);
    const [nameWithGroup, ...params] = head.split(';');
    const name = nameWithGroup.replace(/^.*\./, '').toUpperCase();
    const paramText = params.join(';').toUpperCase();
    if (/QUOTED-PRINTABLE/.test(paramText)) {
      const cs = /CHARSET=([^;]+)/.exec(paramText);
      value = decodeQuotedPrintable(value, cs ? cs[1].toLowerCase() : 'utf-8');
    }
    props.push({ name, params: paramText, value });
  }
  const first = (n) => props.find((p) => p.name === n);
  const all = (n) => props.filter((p) => p.name === n);
  const fields = {};

  const fn = first('FN');
  if (fn) fields.name = unescapeVCard(fn.value);
  if (!fields.name && first('N')) {
    const [family = '', given = '', middle = '', prefix = '', suffix = ''] = splitUnescaped(first('N').value, ';').map(unescapeVCard);
    fields.name = [prefix, given, middle, family, suffix].filter(Boolean).join(' ');
  }
  if (first('ORG')) fields.company = unescapeVCard(splitUnescaped(first('ORG').value, ';')[0]);
  if (first('TITLE')) fields.jobTitle = unescapeVCard(first('TITLE').value);
  else if (first('ROLE')) fields.jobTitle = unescapeVCard(first('ROLE').value);

  const emails = all('EMAIL');
  const email = emails.find((e) => /PREF|WORK/.test(e.params)) || emails[0];
  if (email) fields.email = unescapeVCard(email.value).replace(/^mailto:/i, '');

  const tels = all('TEL');
  const tel = tels.find((p) => /CELL|MOBILE/.test(p.params)) || tels.find((p) => /WORK/.test(p.params)) || tels[0];
  if (tel) fields.phone = unescapeVCard(tel.value).replace(/^tel:/i, '');

  const adr = first('ADR');
  if (adr) {
    const country = splitUnescaped(adr.value, ';')[6];
    if (country) fields.country = unescapeVCard(country);
  }
  for (const u of all('URL')) {
    const url = unescapeVCard(u.value);
    if (/linkedin\.com\//i.test(url)) fields.linkedin = url;
    else if (!fields.url) fields.url = url;
  }
  return fields;
}

/* ---------- MeCard and BIZCARD ---------- */

function keyValues(body) {
  const map = {};
  for (const part of splitUnescaped(body, ';')) {
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const key = part.slice(0, colon).toUpperCase();
    const value = part.slice(colon + 1).replace(/\\([,;:\\])/g, '$1');
    if (!(key in map)) map[key] = value;
  }
  return map;
}

function parseMeCard(text) {
  const kv = keyValues(text.replace(/^MECARD:/i, ''));
  const fields = {};
  if (kv.N) {
    const [last, firstName] = kv.N.split(',');
    fields.name = firstName ? `${firstName.trim()} ${last.trim()}` : kv.N;
  }
  if (kv.ORG) fields.company = kv.ORG;
  if (kv.TITLE) fields.jobTitle = kv.TITLE;
  if (kv.EMAIL) fields.email = kv.EMAIL;
  if (kv.TEL) fields.phone = kv.TEL;
  if (kv.URL) {
    if (/linkedin\.com\//i.test(kv.URL)) fields.linkedin = kv.URL; else fields.url = kv.URL;
  }
  if (kv.ADR) {
    const parts = kv.ADR.split(',');
    if (parts.length > 1) fields.country = parts[parts.length - 1];
  }
  return fields;
}

function parseBizCard(text) {
  const kv = keyValues(text.replace(/^BIZCARD:/i, ''));
  const fields = {};
  const name = [kv.N, kv.X].filter(Boolean).join(' ');
  if (name) fields.name = name;
  if (kv.C) fields.company = kv.C;
  if (kv.T) fields.jobTitle = kv.T;
  if (kv.E) fields.email = kv.E;
  if (kv.B) fields.phone = kv.B;
  return fields;
}

/* ---------- Plain or delimited text ---------- */

/**
 * A phone number inside free text: at least 8 digits, and not glued to letters
 * or digits on either side (so "ECOC26-104233" is not read as "26-104233").
 */
function findPhone(text) {
  const re = new RegExp(PHONE_RE.source, 'g');
  let match;
  while ((match = re.exec(text))) {
    const before = text[match.index - 1] || '';
    const after = text[match.index + match[0].length] || '';
    if (/[\p{L}\d]/u.test(before) || /[\p{L}\d]/u.test(after)) continue;
    // Numbers labelled as an ID ("ID 26-104233", "No. 123456789") are not phone numbers.
    if (/(?:^|[^\p{L}])(?:id|no|nr|č|code|k[óo]d|badge|ticket)\.?:?\s*#?\s*$/iu.test(text.slice(0, match.index))) continue;
    if (match[0].replace(/\D/g, '').length >= 8) return match[0];
  }
  return null;
}

function parsePlain(raw) {
  const fields = {};
  const email = EMAIL_RE.exec(raw);
  if (email) fields.email = email[0];
  const delimiter = ['^', '|', '\t'].find((d) => raw.includes(d));
  // A single word with no email or delimiter is a badge ID, even when it is all digits,
  // unless it starts with + like an international phone number.
  const singleToken = !email && !delimiter && !/\s/.test(raw) && !raw.startsWith('+');
  const phone = singleToken ? null : findPhone(raw.replace(EMAIL_RE, ' '));
  if (phone) fields.phone = phone;

  // Delimited badges, e.g. "12345^Jane^Doe^Manager^Company^phone^web^email
  if (delimiter && (fields.email || fields.phone)) {
    const parts = raw.split(delimiter).map((p) => p.trim()).filter(Boolean);
    const words = parts.filter((p) => /^[\p{L}][\p{L}' .-]*$/u.test(p) && !EMAIL_RE.test(p));
    if (words.length >= 2) fields.name = `${words[0]} ${words[1]}`;
  }
  return { format: Object.keys(fields).length ? 'text' : 'id', fields };
}
