// Shared helpers for the Pune + Mumbai verification work. READ-ONLY: reads a pg snapshot file, never the database.
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..', '..');
const CITIES = ['Pune', 'Mumbai'];

/** Newest snapshot folder whose label matches (default: the one taken before this work). */
function snapshotDir(label = 'pune-mumbai-before-sample') {
  const base = path.join(REPO, 'migration', 'backup');
  const dirs = fs.readdirSync(base).filter((d) => d.startsWith('pg-snapshot-') && d.endsWith(label)).sort();
  if (!dirs.length) throw new Error(`No snapshot *${label} in migration/backup`);
  return path.join(base, dirs[dirs.length - 1]);
}

/** Same normalisation the app uses for logo lookup (lib/developers.ts, go-live-stats.mjs). */
const appKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Company identity key for duplicate review: drops legal suffixes only, keeps every other word. */
const SUFFIX = /\b(private|pvt|limited|ltd|llp|l l p|co|company|the|and|m s|ms)\b/g;
const companyKey = (s) => appKey(String(s || '').replace(/&/g, ' and ')).replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();

/** Individual landowner names (no company word) — they have no website or logo to verify. */
const COMPANY_WORD = /\b(developers?|builders?|realty|realtors?|estates?|infra\w*|constructions?|homes?|housing|properties|projects?|promoters?|enterprises?|associates?|corporation|group|ventures?|spaces?|lifespaces?|buildcon|buildtech|landmarks?|shelters?|habitat|ltd|limited|llp|pvt|private|company|co op|society|trust|industries|developments?)\b/i;
const isCompany = (s) => COMPANY_WORD.test(String(s || ''));

function loadRecords(dir = snapshotDir()) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'scraped_projects.json'), 'utf8'));
  return rows.filter((r) => CITIES.includes(r.doc?.data?.city) && !r.doc.deleted);
}
function loadDevelopers(dir = snapshotDir()) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'developers.json'), 'utf8'));
}

/** appKey(name or alias) → developers entry (logo kept out to save memory). */
function logoIndex(devs) {
  const m = new Map();
  for (const { doc } of devs) {
    if (!doc.logo) continue;
    const e = { id: doc.id, name: doc.name, source: doc.source || '', logo_kind: String(doc.logo).startsWith('data:') ? 'embedded image' : 'url' };
    for (const k of [doc.name, ...(doc.aliases || [])]) if (k) m.set(appKey(k), e);
  }
  return m;
}

const csvCell = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function writeCsv(file, rows, cols = Object.keys(rows[0] || {})) {
  fs.writeFileSync(file, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n'));
}

module.exports = { ROOT, REPO, CITIES, snapshotDir, appKey, companyKey, isCompany, loadRecords, loadDevelopers, logoIndex, writeCsv };
