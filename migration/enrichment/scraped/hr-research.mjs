// READ-ONLY research for the HARERA Gurugram rows of scraped_projects.
//
//   node migration/enrichment/scraped/hr-research.mjs <snapshot scraped_projects.json> [--limit N] [--concurrency 3]
//
// For each row with an official project link (haryanarera.gov.in/view_project/searchprojectDetail/<id>)
// it saves two official pages as cells (see parsers.mjs) in <cache>/hr-pages/:
//   <id>-detail.txt.gz  the public project detail page
//   <id>-form.txt.gz    the registration application, Form REP-I (project_preview_open/<id>)
// Fetch only; parsing happens in apply.mts. Each attempt is logged to <cache>/hr-fetch-log.jsonl and
// pages already saved are skipped, so a run can be stopped and resumed. Never writes to the database.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { cells } from './parsers.mjs';

const [snapFile, ...args] = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LIMIT = Number(opt('--limit', Infinity));
const CONC = Number(opt('--concurrency', 3));
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache');
const PAGES = path.join(CACHE, 'hr-pages');
const LOG = path.join(CACHE, 'hr-fetch-log.jsonl');
mkdirSync(PAGES, { recursive: true });

const BASE = 'https://haryanarera.gov.in/view_project';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (res.ok) return await res.text();
    } catch { /* retry */ }
    await wait(8000 * (i + 1));
  }
  return null;
}

const rows = JSON.parse(readFileSync(snapFile, 'utf8'));
const page = (id, kind) => path.join(PAGES, `${id}-${kind}.txt.gz`);
const ids = rows
  .map((r) => r.doc)
  .filter((d) => !d.deleted && d.original?.regulator === 'HARERA Gurugram')
  .map((d) => (String(d.original.project_url || '').match(/searchprojectDetail\/(\d+)$/) || [])[1])
  .filter((id, i, a) => id && a.indexOf(id) === i && !(existsSync(page(id, 'detail')) && existsSync(page(id, 'form'))))
  .slice(0, LIMIT);
console.log(`Haryana: ${ids.length} projects to fetch`);

let n = 0, ok = 0;
const queue = [...ids];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const id = queue.shift();
    const res = {};
    for (const [kind, url] of [['detail', `${BASE}/searchprojectDetail/${id}`], ['form', `${BASE}/project_preview_open/${id}`]]) {
      if (existsSync(page(id, kind))) { res[kind] = true; continue; }
      const html = await get(url);
      const t = html ? cells(html) : null;
      // The form for a project without an online application is an empty shell; keep it anyway as evidence.
      res[kind] = !!t && t.length > 20;
      if (res[kind]) writeFileSync(page(id, kind), gzipSync(t.join('\n')));
      await wait(800);
    }
    if (res.detail) ok++;
    appendFileSync(LOG, JSON.stringify({ id, at: new Date().toISOString(), ...res }) + '\n');
    if (++n % 25 === 0) console.log(`${n}/${ids.length} (${ok} saved) ${new Date().toISOString()}`);
  }
}));
console.log(`Done: ${n} fetched, ${ok} with a detail page.`);
