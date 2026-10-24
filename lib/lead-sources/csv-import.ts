import { z } from 'zod';
import { getDb } from '../mongodb';
import { parseCsv } from './csv';
import { CSV_FIELDS, csvRowToLead, sha256, suggestMapping, type CsvMapping, type CsvProvenance } from './normalize';
import { ingestLead } from './ingest';
import { knownKeys, logRun, type Sql } from './store';

// Authorised CSV import (broker referrals, buyer enquiries collected offline).
// The uploader must say who supplied the file and how the people in it agreed
// to be contacted, and confirm it. Rows are rejected when the consent column
// (if mapped) isn't a clear "yes", when contact details are invalid, when the
// person is already in the CRM, or when the same person appears twice in the
// file. Always previewed as a dry run first; the import itself is idempotent.

export const CSV_SOURCE = 'csv_import';
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

const fieldKeys = CSV_FIELDS.map(([k]) => k) as [string, ...string[]];
export const importSchema = z.object({
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  file_name: z.string().trim().max(200).default(''),
  mapping: z.record(z.enum(fieldKeys), z.number().int().min(0).max(500)),
  provenance: z.object({
    kind: z.enum(['broker_referral', 'buyer_enquiry']),
    supplied_by: z.string().trim().min(2, 'Say who supplied this file').max(120),
    supplier_rera: z.string().trim().max(60).optional().default(''),
    consent_basis: z.string().trim().min(30, 'Describe how these people agreed to be contacted (at least 30 characters)').max(1000),
    attest: z.literal(true, { errorMap: () => ({ message: 'Confirm that every person in the file agreed to be contacted' }) }),
  }),
  dry_run: z.boolean().default(true),
}).strict();

export function previewCsv(text: string) {
  const { headers, rows } = parseCsv(text, MAX_CSV_ROWS + 1);
  return { headers, total: rows.length, too_many: rows.length > MAX_CSV_ROWS, sample: rows.slice(0, 5), mapping: suggestMapping(headers), fields: CSV_FIELDS };
}

const phoneDigits = (s: unknown) => String(s || '').replace(/\D/g, '').slice(-10);

/** Phones (last 10 digits) and emails already in the CRM, from every lead table. */
async function existingContacts() {
  const db = await getDb();
  const [leads, contact] = await Promise.all([
    db.collection('leads').find({}, { projection: { whatsapp: 1, phone: 1, email: 1 } }).toArray(),
    db.collection('contact_leads').find({}, { projection: { phone: 1, email: 1 } }).toArray(),
  ]);
  const phones = new Set<string>(), emails = new Set<string>();
  for (const l of [...leads, ...contact] as Record<string, unknown>[]) {
    for (const p of [l.whatsapp, l.phone]) { const d = phoneDigits(p); if (d.length === 10) phones.add(d); }
    const e = String(l.email || '').trim().toLowerCase(); if (e) emails.add(e);
  }
  return { phones, emails };
}

export interface ImportReport {
  dry_run: boolean; total: number; valid: number; imported: number; merged: number;
  skipped: { row: number; reason: string }[]; skipped_count: number; by_reason: Record<string, number>;
}

export async function runCsvImport(input: z.infer<typeof importSchema>, uploader: string, sql?: Sql, now = new Date()): Promise<ImportReport> {
  const { headers, rows } = parseCsv(input.csv, MAX_CSV_ROWS + 1);
  if (rows.length > MAX_CSV_ROWS) throw new Error(`The file has more than ${MAX_CSV_ROWS} rows. Split it and import each part.`);
  const map = input.mapping as CsvMapping;
  for (const [f, i] of Object.entries(map)) if (i >= headers.length) throw new Error(`Column for "${f}" is out of range.`);
  if (map.name === undefined && map.first_name === undefined) throw new Error('Map a name column (full name, or first name).');
  if (map.phone === undefined && map.email === undefined) throw new Error('Map a phone or an email column.');

  const prov: CsvProvenance = input.provenance;
  const skipped: { row: number; reason: string }[] = [];
  const ok: Extract<ReturnType<typeof csvRowToLead>, { ok: true }>[] = [];
  const seenPhone = new Set<string>(), seenEmail = new Set<string>();
  const { phones, emails } = await existingContacts();

  rows.forEach((cells, i) => {
    const r = csvRowToLead(cells, i + 2, map, prov, uploader, now);
    if (!r.ok) { skipped.push({ row: r.row, reason: r.reason }); return; }
    const d = phoneDigits(r.lead.phone), e = r.lead.email;
    if ((d && seenPhone.has(d)) || (e && seenEmail.has(e))) { skipped.push({ row: r.row, reason: 'Same person appears earlier in this file' }); return; }
    if (d) seenPhone.add(d); if (e) seenEmail.add(e);
    if ((d && phones.has(d)) || (e && emails.has(e))) { skipped.push({ row: r.row, reason: 'Already in your leads' }); return; }
    ok.push(r);
  });
  const already = await knownKeys(CSV_SOURCE, ok.map((r) => r.key), sql);
  const fresh = ok.filter((r) => {
    if (!already.has(r.key)) return true;
    skipped.push({ row: r.row, reason: 'Imported before' });
    return false;
  });

  let imported = 0, merged = 0;
  if (!input.dry_run) {
    const label = `CSV import · ${prov.kind === 'broker_referral' ? 'Broker referral' : 'Buyer enquiry'} (${prov.supplied_by})`;
    for (const r of fresh) {
      const res = await ingestLead(CSV_SOURCE, r.key, r.lead, { payloadHash: sha256(JSON.stringify(r.lead)), label, email: false, sql, now });
      if (res.outcome === 'created') imported++; else if (res.outcome === 'merged') merged++; else skipped.push({ row: r.row, reason: 'Imported before' });
    }
  }
  skipped.sort((a, b) => a.row - b.row);
  const by_reason: Record<string, number> = {};
  for (const s of skipped) by_reason[s.reason] = (by_reason[s.reason] || 0) + 1;

  if (!input.dry_run) {
    await logRun({
      source: CSV_SOURCE, action: 'import', ok: true, imported, merged, skipped: skipped.length, actor: uploader,
      detail: { file_name: input.file_name, rows: rows.length, kind: prov.kind, supplied_by: prov.supplied_by, by_reason, consent_column: map.consent !== undefined },
    }, sql);
  }
  return { dry_run: input.dry_run, total: rows.length, valid: fresh.length, imported, merged, skipped: skipped.slice(0, 300), skipped_count: skipped.length, by_reason };
}
