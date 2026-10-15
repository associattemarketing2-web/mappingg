// READ-ONLY research for the RERA Karnataka rows of scraped_projects.
//
//   node migration/enrichment/scraped/ka-research.mjs <snapshot scraped_projects.json> [--limit N] [--concurrency 3]
//
// 1. Index: one official search (district = Bengaluru Urban) on rera.karnataka.gov.in lists every
//    registered project with its internal detail id. Cached in the cache dir.
// 2. Detail: for each scraped row whose registration number is in the index, POST projectDetails
//    (the page behind "View Project Details") and parse the project section.
// Results are appended to <cache>/ka-results.jsonl (one line per registration number), so a run can
// be stopped and resumed. The page text is kept gzipped in <cache>/ka-pages/ as evidence.
// Parsing is in parsers.mjs; it never writes to the database (apply.mts does that).

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { cells } from './parsers.mjs';

const [snapFile, ...args] = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LIMIT = Number(opt('--limit', Infinity));
const CONC = Number(opt('--concurrency', 3));
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache');
const PAGES = path.join(CACHE, 'ka-pages');
const INDEX = path.join(CACHE, 'ka-index.json');
const OUT = path.join(CACHE, 'ka-fetch-log.jsonl');
mkdirSync(PAGES, { recursive: true });

const BASE = 'https://rera.karnataka.gov.in';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body, timeoutMs = 300000) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST', body: new URLSearchParams(body),
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.text();
    } catch { /* retry */ }
    await wait(10000 * (i + 1));
  }
  return null;
}

// ---- index ------------------------------------------------------------------------------
async function loadIndex() {
  if (existsSync(INDEX)) return JSON.parse(readFileSync(INDEX, 'utf8'));
  console.log('Building index (one district search, ~3 min)…');
  const html = await post(`${BASE}/projectViewDetails`, { project: '', firm: '', appNo: '', regNo: '', district: 'Bengaluru Urban', subdistrict: '0' }, 900000);
  if (!html) throw new Error('index search failed');
  const out = {};
  for (const m of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const id = (m[0].match(/id="(\d+)"[^>]*showFileApplicationPreview/) || [])[1];
    const reg = (m[0].match(/PRM\/KA\/RERA\/[0-9A-Z/]+/) || [])[0];
    if (id && reg) out[reg] = id;
  }
  writeFileSync(INDEX, JSON.stringify(out));
  console.log(`Index: ${Object.keys(out).length} projects`);
  return out;
}

// ---- main ---------------------------------------------------------------------------------
// Fetch only: every page is saved, and parsing happens in apply.mts (so parser fixes never need a refetch).
// The log (ka-fetch-log.jsonl) records each attempt; failed fetches are retried on the next run.
if (snapFile) {
  const rows = JSON.parse(readFileSync(snapFile, 'utf8'));
  const index = await loadIndex();
  const pageOf = (reg) => path.join(PAGES, `${reg.replace(/\//g, '_')}.txt.gz`);
  const todo = rows
    .map((r) => r.doc)
    .filter((d) => !d.deleted && d.original?.regulator === 'RERA Karnataka')
    .map((d) => d.original.rera_number)
    .filter((reg, i, a) => reg && a.indexOf(reg) === i && index[reg] && !existsSync(pageOf(reg)))
    .slice(0, LIMIT);
  console.log(`Karnataka: ${todo.length} pages to fetch`);
  let n = 0, ok = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const reg = queue.shift();
      const html = await post(`${BASE}/projectDetails`, { action: index[reg] }, 180000);
      const t = html ? cells(html) : null;
      // A page cut short by the server has the header but not the project section: retry it next run.
      const good = !!t && t.includes(reg) && t.includes('Registration/Extensions');
      if (good) { writeFileSync(pageOf(reg), gzipSync(t.join('\n'))); ok++; }
      appendFileSync(OUT, JSON.stringify({ reg, detail_id: index[reg], at: new Date().toISOString(), ok: good }) + '\n');
      if (++n % 25 === 0) console.log(`${n}/${todo.length} (${ok} saved) ${new Date().toISOString()}`);
      await wait(1000);
    }
  }));
  console.log(`Done: ${n} fetched, ${ok} saved.`);
}
