/**
 * Turns the text lines read from a business card into lead fields.
 * Pure functions (no interface, no storage) so they are easy to test.
 *
 * Reliable: email, phone, website (clear patterns).
 * Best effort: name, company, job title, country (guessed from clues such as
 * the email address, legal forms like "s.r.o." or "GmbH", job words and text size).
 */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const WEB = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s]*)?/i;
const PHONE = /\+?\(?\d[\d\s().\/-]{6,}\d/;

const TITLES = /^(?:ing|mgr|bc|dr|mudr|judr|phdr|rndr|paeddr|mvdr|doc|prof|ph\.?d|csc|drsc|mba|msc|bsc|ma|ba|dis|dipl\.?-?ing|llm|mph|eng)\.?,?$/i;
/** Legal forms that end a company name ("s.r.o.", "GmbH", "Ltd"). */
const LEGAL_FORM = /\b(?:spol\.\s?s\s?r\.\s?o|s\.\s?r\.\s?o|a\.\s?s|v\.\s?o\.\s?s|k\.\s?s|z\.\s?s|gmbh|ag|kg|se|ltd|limited|plc|llc|inc|corp|corporation|co\.|s\.\s?a|s\.\s?p\.\s?a|s\.\s?r\.\s?l|b\.\s?v|n\.\s?v|sp\.\s?z\s?o\.\s?o|oy|ab|a\/s|aps|kft|zrt|d\.\s?o\.\s?o)(?![\p{L}])\.?/iu;
/** Legal forms plus words that usually appear in company names. */
const LEGAL = new RegExp(`${LEGAL_FORM.source}|\\b(?:company|group|holding|industries|technologies|solutions|systems|networks)\\b`, 'iu');
const JOB = /\b(?:manager|director|engineer|sales|head|chief|ceo|cto|cfo|coo|cmo|founder|co-founder|owner|president|vice|vp|partner|specialist|consultant|officer|coordinator|representative|technician|developer|designer|marketing|purchasing|procurement|buyer|account|executive|analyst|lead|leader|assistant|advisor|architect|administrator|supervisor|scientist|researcher|product|project|business|export|key|area|regional|jednatel|jednatelka|ředitel|ředitelka|manažer|manažerka|obchodní|obchodník|vedoucí|technik|technička|inženýr|inženýrka|specialista|specialistka|referent|referentka|nákupčí|asistent|asistentka|konzultant|konzultantka|projektant|vývojář|majitel|majitelka|předseda|místopředseda|prokurista|geschäftsführer|leiter|leiterin|vertrieb|einkauf|verkauf|berater|ingenieur)\b/i;
const ADDRESS = /\b(?:street|st\.|road|rd\.|avenue|ave\.|ulice|ul\.|nám\.|náměstí|třída|tř\.|straße|strasse|str\.|platz|gasse|weg|p\.?o\.? box|\d{3}\s?\d{2}\b|\b\d{4,5}\s+[A-ZÁ-Ž])/i;
const LABEL = /^(?:t|tel|telefon|phone|ph|m|mob|mobil|mobile|cell|gsm|e|email|e-mail|mail|w|web|www|f|fax|a|adresa|address)\s*[.:]?\s+/i;
const FREE_MAIL = /^(?:gmail|googlemail|seznam|email|centrum|volny|post|atlas|outlook|hotmail|live|yahoo|icloud|me|mac|gmx|web|protonmail|proton|aol|mail|tiscali|quick|azet|zoznam)$/i;

const PHONE_COUNTRY = [
  ['420', 'CZ'], ['421', 'SK'], ['49', 'DE'], ['43', 'AT'], ['48', 'PL'], ['36', 'HU'], ['44', 'GB'], ['353', 'IE'],
  ['33', 'FR'], ['39', 'IT'], ['34', 'ES'], ['351', 'PT'], ['31', 'NL'], ['32', 'BE'], ['352', 'LU'], ['41', 'CH'],
  ['45', 'DK'], ['46', 'SE'], ['47', 'NO'], ['358', 'FI'], ['354', 'IS'], ['30', 'GR'], ['40', 'RO'], ['359', 'BG'],
  ['385', 'HR'], ['386', 'SI'], ['381', 'RS'], ['387', 'BA'], ['370', 'LT'], ['371', 'LV'], ['372', 'EE'], ['380', 'UA'],
  ['90', 'TR'], ['972', 'IL'], ['971', 'AE'], ['966', 'SA'], ['974', 'QA'], ['20', 'EG'], ['27', 'ZA'], ['91', 'IN'],
  ['86', 'CN'], ['852', 'HK'], ['886', 'TW'], ['81', 'JP'], ['82', 'KR'], ['65', 'SG'], ['60', 'MY'], ['66', 'TH'],
  ['84', 'VN'], ['62', 'ID'], ['63', 'PH'], ['61', 'AU'], ['64', 'NZ'], ['55', 'BR'], ['52', 'MX'], ['54', 'AR'], ['1', 'US']
].sort((a, b) => b[0].length - a[0].length);

const TLD_COUNTRY = {
  cz: 'CZ', sk: 'SK', de: 'DE', at: 'AT', pl: 'PL', hu: 'HU', uk: 'GB', ie: 'IE', fr: 'FR', it: 'IT', es: 'ES', pt: 'PT',
  nl: 'NL', be: 'BE', lu: 'LU', ch: 'CH', dk: 'DK', se: 'SE', no: 'NO', fi: 'FI', gr: 'GR', ro: 'RO', bg: 'BG', hr: 'HR',
  si: 'SI', rs: 'RS', lt: 'LT', lv: 'LV', ee: 'EE', ua: 'UA', tr: 'TR', il: 'IL', ae: 'AE', in: 'IN', cn: 'CN', jp: 'JP',
  kr: 'KR', sg: 'SG', au: 'AU', nz: 'NZ', br: 'BR', mx: 'MX', za: 'ZA'
};

/** Lower case, no accents, letters and digits only. */
const flat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Undo spaces that text recognition puts around @ and dots in addresses. */
const compact = (s) => s.replace(/\s*@\s*/g, '@').replace(/\s*\(at\)\s*/gi, '@').replace(/(\w)\s*\.\s*(?=\w)/g, '$1.');

/** "TOMÁŠ HORÁK" → "Tomáš Horák" (only for text written all in capitals). */
function titleCase(s) {
  if (s !== s.toUpperCase() || s === s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function countryName(code, language) {
  try {
    return new Intl.DisplayNames([language || 'en'], { type: 'region' }).of(code) || '';
  } catch {
    return '';
  }
}

function countryFromPhone(phone) {
  const plus = String(phone || '').replace(/[^\d+]/g, '');
  const digits = plus.startsWith('+') ? plus.slice(1) : plus.startsWith('00') ? plus.slice(2) : '';
  if (!digits) return '';
  const hit = PHONE_COUNTRY.find(([prefix]) => digits.startsWith(prefix));
  return hit ? hit[1] : '';
}

function countryFromDomain(domain) {
  const parts = String(domain || '').toLowerCase().split('.');
  return TLD_COUNTRY[parts[parts.length - 1]] || '';
}

/** Split a line on visual separators: "Engineer | Company", "Tel • Email". */
function segments(line) {
  return line.text.split(/\s+[|•·]\s+|\s{3,}/).map((text) => ({ ...line, text: text.trim() })).filter((s) => s.text);
}

/** Words of a person's name, ignoring academic titles. */
function nameWords(text) {
  return text.replace(/,/g, ' ').split(/\s+/).filter((w) => w && !TITLES.test(w));
}

function looksLikeName(text) {
  if (/\d|@|\/|:/.test(text) || LEGAL.test(text) || ADDRESS.test(text) || JOB.test(text)) return false;
  const words = nameWords(text);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(w) || /^(?:van|von|de|der|den|da|di|du|la|le)$/i.test(w));
}

/**
 * @param {{text: string, height?: number, top?: number, confidence?: number}[]} lines from the text reader
 * @param {{language?: string}} [options] language for the country name
 * @returns {{fields: Record<string, string>, found: number}}
 */
export function parseCard(lines, options = {}) {
  const usable = lines
    .filter((l) => l.text && l.text.replace(/[^\p{L}\d]/gu, '').length >= 2 && (l.confidence === undefined || l.confidence >= 40))
    .flatMap(segments);
  const fields = {};
  const used = new Set();

  // Email (first one found), website, LinkedIn
  for (const seg of usable) {
    const text = compact(seg.text.replace(LABEL, ''));
    const email = text.match(EMAIL);
    if (email && !fields.email) { fields.email = email[0].replace(/[.,;]+$/, '').toLowerCase(); used.add(seg); continue; }
    if (/linkedin\.com\//i.test(text) && !fields.linkedin) {
      const m = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s]+/i);
      if (m) { fields.linkedin = m[0]; used.add(seg); continue; }
    }
    if (!email && !/\s/.test(text.trim()) && WEB.test(text) && /[a-z]{2,}\.[a-z]{2,}/i.test(text) && !PHONE.test(text)) {
      if (!fields.url) fields.url = text.match(WEB)[0].toLowerCase();
      used.add(seg);
    }
  }
  const domain = fields.email ? fields.email.split('@')[1] : (fields.url || '').replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
  const domainName = domain ? flat(domain.split('.').slice(0, -1).join('').replace(/^www/, '')) : '';
  const companyDomain = domainName && !FREE_MAIL.test(domain.split('.')[0]) ? domainName : '';

  // Phone: mobile or plain number first, fax last
  const phones = [];
  for (const seg of usable) {
    if (used.has(seg)) continue;
    const label = (seg.text.match(/^([a-z.\- ]{1,10})[:.]?\s/i) || [])[1] || '';
    const m = seg.text.replace(LABEL, '').match(PHONE);
    if (!m) continue;
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    if (ADDRESS.test(seg.text) && !/\+/.test(m[0])) continue;
    const fax = /fax/i.test(label);
    const mobile = /^(?:m|mob|mobil|mobile|cell|gsm)\b/i.test(label);
    phones.push({ value: m[0].replace(/\s+/g, ' ').trim(), rank: fax ? 2 : mobile ? 0 : 1 });
    used.add(seg);
  }
  phones.sort((a, b) => a.rank - b.rank);
  if (phones.length) fields.phone = phones[0].value;

  const rest = usable.filter((s) => !used.has(s));

  // Company: legal form, or the words of the email domain
  let company = rest.find((s) => LEGAL.test(s.text) && !looksLikeName(s.text) && !ADDRESS.test(s.text));
  if (!company && companyDomain) {
    company = rest.find((s) => {
      const f = flat(s.text);
      return f.length >= 3 && (f.includes(companyDomain) || companyDomain.includes(f)) && !JOB.test(s.text);
    });
  }
  if (company) {
    let text = company.text.replace(/[|,;]+$/, '').trim();
    // Drop stray characters after the company name (often a logo read as letters):
    // a company name ends with its legal form, or with the last word of the email domain.
    const legalAt = text.search(LEGAL_FORM);
    if (legalAt >= 0) {
      const match = text.slice(legalAt).match(LEGAL_FORM);
      text = text.slice(0, legalAt + match[0].length).replace(/[,;]+$/, '');
    } else if (companyDomain) {
      const words = text.split(/\s+/);
      let last = -1;
      words.forEach((w, i) => { if (companyDomain.includes(flat(w)) && flat(w).length >= 2) last = i; else if (LEGAL.test(w)) last = i; });
      if (last >= 0 && last < words.length - 1) {
        const tail = words.slice(last + 1).join(' ');
        if (!LEGAL_FORM.test(tail)) text = words.slice(0, last + 1).join(' ');
      }
    }
    fields.company = text;
    used.add(company);
  }

  // Job title: job words, not the company
  const job = rest.find((s) => !used.has(s) && JOB.test(s.text) && !looksLikeName(s.text) && !ADDRESS.test(s.text) && s.text.length <= 60);
  if (job) { fields.jobTitle = job.text.replace(/[|,;]+$/, '').trim(); used.add(job); }

  // Name: matches the email's local part best, else the largest name-like line
  const candidates = rest.filter((s) => !used.has(s) && looksLikeName(s.text));
  if (candidates.length) {
    const local = fields.email ? flat(fields.email.split('@')[0]) : '';
    const maxHeight = Math.max(...candidates.map((c) => c.height || 0)) || 1;
    const score = (c) => {
      let points = ((c.height || 0) / maxHeight) * 2;
      if (local) {
        const words = nameWords(c.text).map(flat);
        if (words.some((w) => w.length >= 3 && local.includes(w))) points += 3;
        else if (words.length >= 2 && local === words[0][0] + words[words.length - 1]) points += 3;
      }
      return points;
    };
    const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
    fields.name = titleCase(best.text.replace(/[|;]+$/, '').trim());
    used.add(best);
  }

  // Country: phone prefix, then email or website ending, then an address line naming it
  const code = countryFromPhone(fields.phone) || countryFromDomain(domain);
  if (code) fields.country = countryName(code, options.language);

  for (const key of Object.keys(fields)) if (!fields[key]) delete fields[key];
  return { fields, found: Object.keys(fields).length };
}
