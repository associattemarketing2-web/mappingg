import { inflateRawSync, inflateSync } from 'node:zlib';
import { parseCsv } from './lead-sources/csv';
import { normalizePhone } from './phone';
import { prettyPhone, waDigits } from './wa-store';

// WhatsApp bulk send: pulls phone numbers (and names, where the file has a name
// column) out of whatever file the team uploads — CSV / TXT, Excel (.xlsx),
// Word (.docx) or a text PDF. No dependencies: .xlsx/.docx are unzipped and
// PDF content streams inflated with node:zlib. Scanned PDFs (images) and old
// binary .xls files have no readable text; the caller tells the user to export
// a CSV instead.

export const MAX_BULK_BYTES = 10 * 1024 * 1024;
export const MAX_BULK_NUMBERS = 5000;

export interface BulkRecipient { phone: string; phone_display: string; name: string }
export interface Extracted { recipients: BulkRecipient[]; duplicates: number; invalid: string[]; format: string }

// "+91 98765 43210", "919876543210", "09876543210", "98765-43210" — a code of
// up to 3 digits, then 10 digits (optionally split 5 + 5).
const PHONE_RE = /(?<![\d+])(\+?\d{1,3}[\s.-]?)?(\d{5})[\s.-]?(\d{5})(?!\d)/g;

/** One candidate → "919876543210", or null when it isn't a valid mobile number. */
function toWa(raw: string): string | null {
  const plus = raw.trim().startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (!plus && d.length === 11 && d.startsWith('0')) d = d.slice(1);
  const stored = normalizePhone(plus ? '+' + d : d);
  return stored ? waDigits(stored) : null;
}

/** Every phone number written in a piece of text, in order. */
function phonesIn(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const n = toWa(m[0]);
    if (n) ok.push(n); else bad.push(m[0].trim());
  }
  return { ok, bad };
}

const PHONE_HEAD = /phone|mobile|number|whats\s*app|contact|cell|^no\.?$|^mob/i;
const NAME_HEAD = /name/i;

/** Rows of cells → recipients. Uses the phone / name columns when the first row is a header, else scans every cell. */
const isHeader = (head: string[]) => head.some((h) => PHONE_HEAD.test(h.trim())) && !head.some((h) => phonesIn(h).ok.length);

function fromRows(rows: string[][], format: string): Extracted {
  const head = rows[0] || [];
  const looksLikeHeader = isHeader(head);
  const phoneCols = looksLikeHeader ? head.map((h, i) => (PHONE_HEAD.test(h.trim()) && !NAME_HEAD.test(h) ? i : -1)).filter((i) => i >= 0) : [];
  const nameCol = looksLikeHeader ? head.findIndex((h) => NAME_HEAD.test(h) && !/company|project|file|user\s*name/i.test(h)) : -1;
  const out: { phone: string; name: string }[] = [];
  const invalid: string[] = [];
  for (const row of looksLikeHeader ? rows.slice(1) : rows) {
    const cells = phoneCols.length ? phoneCols.map((i) => row[i] || '') : row;
    const name = nameCol >= 0 ? (row[nameCol] || '').trim() : '';
    let found = false;
    for (const cell of cells) {
      const { ok, bad } = phonesIn(cell);
      ok.forEach((phone) => out.push({ phone, name }));
      found ||= ok.length > 0;
      // Anything in a phone column that isn't a valid number is worth reporting; stray numbers in other text are not.
      if (phoneCols.length && !ok.length && /\d/.test(cell)) invalid.push(cell.trim());
      else invalid.push(...bad);
    }
    // No name column: a short non-numeric cell next to the number is probably the name.
    if (found && nameCol < 0 && !phoneCols.length) {
      const guess = row.find((c) => c.trim() && !/\d{4,}/.test(c) && c.trim().length <= 60 && !/@/.test(c));
      if (guess) for (let i = out.length - 1; i >= 0 && !out[i].name; i--) out[i].name = guess.trim();
    }
  }
  return finish(out, invalid, format);
}

function finish(list: { phone: string; name: string }[], invalid: string[], format: string): Extracted {
  const seen = new Map<string, BulkRecipient>();
  let duplicates = 0;
  for (const r of list) {
    const prev = seen.get(r.phone);
    if (prev) { duplicates++; if (!prev.name && r.name) prev.name = r.name.slice(0, 80); continue; }
    if (seen.size >= MAX_BULK_NUMBERS) break;
    seen.set(r.phone, { phone: r.phone, phone_display: prettyPhone(r.phone), name: r.name.slice(0, 80) });
  }
  return { recipients: [...seen.values()], duplicates, invalid: [...new Set(invalid)].slice(0, 200), format };
}

/* --------------------------------- ZIP (xlsx / docx) --------------------------------- */

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (!/\.xml$/i.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    try { files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data)); } catch { /* skip unreadable entry */ }
  }
  return files;
}

const unxml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unxml(m[1])).join('');

/** Column letters of a cell ref ("C12" → 2). */
const colIndex = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] || 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function xlsxRows(files: Map<string, Buffer>): string[][] {
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.slice(19)) - parseInt(b.slice(19)));
  const rows: string[][] = [];
  for (const s of sheets) {
    const xml = files.get(s)!.toString('utf8');
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] || '';
        const type = /\bt="(\w+)"/.exec(attrs)?.[1];
        const v = unxml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || '');
        let val = type === 's' ? shared[Number(v)] || '' : type === 'inlineStr' ? texts(inner) : v;
        // Big numbers can be stored as 9.87654321E9.
        if (!type && /^\d+(\.\d+)?E\+?\d+$/i.test(val)) val = Number(val).toFixed(0);
        row[colIndex(/\br="([A-Z]+)\d+"/.exec(attrs)?.[1] || String.fromCharCode(65 + row.length))] = val;
      }
      rows.push(Array.from(row, (x) => x ?? ''));
    }
  }
  return rows;
}

function docxText(files: Map<string, Buffer>): string {
  const xml = files.get('word/document.xml')?.toString('utf8') || '';
  return xml.split(/<\/w:p>|<w:tab\/>|<w:br\/>|<\/w:tc>/).map((part) => texts(part)).join('\n');
}

/* --------------------------------- PDF --------------------------------- */

/** Text shown by a PDF content stream: string operands of Tj / TJ / ' / ", one line per text move. */
function pdfStreamText(s: string): string {
  let out = '';
  const re = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|-?\d+(?:\.\d+)?|T[dDm*]|ET|'|"/g;
  for (const m of s.matchAll(re)) {
    const t = m[0];
    if (t[0] === '(') {
      out += t.slice(1, -1).replace(/\\([nrtbf()\\]|\d{1,3}|\r?\n)/g, (_, e: string) =>
        /^\d/.test(e) ? String.fromCharCode(parseInt(e, 8)) : e === 'n' ? '\n' : e === 't' ? '\t' : /^[rbf]$/.test(e) ? ' ' : /\n/.test(e) ? '' : e);
    } else if (t[0] === '<') {
      const hex = t.slice(1, -1).replace(/\s/g, '');
      const bytes = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
      // UTF-16BE text strings; anything else is taken as single-byte.
      out += bytes[0] === 0xfe && bytes[1] === 0xff ? bytes.subarray(2).swap16().toString('utf16le') : bytes.toString('latin1');
    } else if (/^-?\d/.test(t)) {
      if (Number(t) < -200) out += ' '; // big kerning gap inside TJ = a space
    } else out += '\n';
  }
  return out;
}

function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts: string[] = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const dict = m[1];
    re.lastIndex = end;
    if (/\/(Image|XObject\s*\/Subtype\s*\/Image|DCTDecode|JPXDecode)/.test(dict) && !/\/Type\s*\/ObjStm/.test(dict)) continue;
    let data: Buffer = buf.subarray(start, end);
    if (/FlateDecode/.test(dict)) { try { data = inflateSync(data); } catch { continue; } }
    else if (/\/Filter/.test(dict)) continue;
    const s = data.toString('latin1');
    if (/\bBT\b/.test(s)) parts.push(pdfStreamText(s));
  }
  return parts.join('\n');
}

/* --------------------------------- Entry --------------------------------- */

/** Pulls recipients from an uploaded file (or pasted text when `name` is ''). Throws with a user-facing message. */
export function extractRecipients(buf: Buffer, name: string): Extracted {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-' || ext === 'pdf') {
    const text = pdfText(buf);
    const { ok, bad } = phonesIn(text);
    if (!ok.length) throw new Error('No phone numbers could be read from this PDF. If it is a scan/photo or uses special fonts, export the list as CSV or Excel and upload that.');
    return finish(ok.map((phone) => ({ phone, name: '' })), bad, 'PDF');
  }
  if (isZip) {
    const files = unzip(buf);
    if ([...files.keys()].some((k) => k.startsWith('xl/'))) return fromRows(xlsxRows(files), 'Excel');
    if (files.has('word/document.xml')) return fromRows(docxText(files).split('\n').map((l) => [l]), 'Word');
    throw new Error('This file type is not supported. Upload CSV, Excel (.xlsx), PDF, Word (.docx) or a text file.');
  }
  if (ext === 'xls' || buf.subarray(0, 4).toString('hex') === 'd0cf11e0') {
    throw new Error('Old Excel (.xls) files cannot be read. In Excel use File → Save As → .xlsx or CSV, then upload again.');
  }
  const text = buf.toString('utf8');
  if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 2000))) throw new Error('This file type is not supported. Upload CSV, Excel (.xlsx), PDF, Word (.docx) or a text file.');
  if (ext === 'vcf' || /^BEGIN:VCARD/m.test(text)) {
    // Contacts export: FN = name, TEL = number.
    const list: { phone: string; name: string }[] = [];
    const bad: string[] = [];
    for (const card of text.split(/END:VCARD/i)) {
      const fn = /^FN[^:]*:(.*)$/im.exec(card)?.[1]?.trim() || '';
      for (const tel of card.matchAll(/^TEL[^:]*:(.*)$/gim)) {
        const n = toWa(tel[1]);
        if (n) list.push({ phone: n, name: fn }); else bad.push(tel[1].trim());
      }
    }
    return finish(list, bad, 'Contacts (vCard)');
  }
  // parseCsv cuts every row to the header's width — right for a file with a header row,
  // but a bare list ("9876543210" then "9876543211, Amit") is read line by line instead.
  const csv = parseCsv(text, 50_000);
  const rows = isHeader(csv.headers) ? [csv.headers, ...csv.rows] : text.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseCsv(l).headers);
  return fromRows(rows, ext === 'csv' ? 'CSV' : name ? 'Text' : 'Pasted list');
}
