// Small RFC 4180 CSV parser for the lead importer: quoted fields, "" escapes,
// commas/newlines inside quotes, CRLF or LF line ends, a UTF-8 BOM, and
// semicolon- or tab-separated exports (Excel in some locales). No dependencies.

export interface ParsedCsv { headers: string[]; rows: string[][] }

/** Guesses the separator from the first line (outside quotes). */
function sniff(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch: string) => {
    let n = 0, q = false;
    for (const c of firstLine) { if (c === '"') q = !q; else if (!q && c === ch) n++; }
    return n;
  };
  const best = [',', ';', '\t'].map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

export function parseCsv(input: string, maxRows = 20_000): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const sep = sniff(text);
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) out.push(row);
      row = [];
      if (out.length > maxRows) break;
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) out.push(row);

  const [head = [], ...rest] = out;
  const headers = head.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: rest.slice(0, maxRows).map((r) => headers.map((_, i) => (r[i] ?? '').trim())) };
}
