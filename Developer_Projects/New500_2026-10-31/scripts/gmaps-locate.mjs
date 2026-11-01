// Google Maps place for each Mumbai / Pune project in Scraped data (owner's request, 31 Oct 2026: "location real ho,
// Google Map kahin se bhi info lo"). Headless Chrome opens google.com/maps/search/<project, developer, locality, city>,
// one search every ~12 s, and records what Google shows: the place name, its address (with pincode) and the place's own
// coordinates (from the place URL), plus the first results when Google shows a list. Cached per query.
//
//   node Developer_Projects/New500_2026-10-31/scripts/gmaps-locate.mjs      → <cache>/gmaps/results.json
//
// Nothing is decided here; mh-complete.mjs accepts a place only when its name carries the project's own words,
// its address is in the right city, and (when the developer page has a map) it is within 1 km of that point.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('migration/backup/scraped-enrichment-cache/new500/gmaps');
mkdirSync(DIR, { recursive: true });
const queries = JSON.parse(readFileSync(path.join(DIR, 'queries.json'), 'utf8'));
const OUT = path.join(DIR, 'results.json');
const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const todo = queries.filter((q) => !results[q.key]);
if (!todo.length) { console.log('all cached'); process.exit(0); }

const PORT = 9343;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${DIR}/profile`, '--no-first-run', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 200; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { pend.get(d.id)?.(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

for (const q of todo) {
  await send('Page.navigate', { url: `https://www.google.com/maps/search/${encodeURIComponent(q.query)}?hl=en` });
  await sleep(9000);
  await js(`(document.querySelector('form[action*="consent"] button') || {click(){}}).click(); 1`);
  await sleep(2500);
  const href = await js('location.href');
  const r = {
    query: q.query, at: new Date().toISOString(), url: href,
    name: await js(`(document.querySelector('h1.DUwDvf') || document.querySelector('h1') || {}).textContent || ''`),
    category: await js(`(document.querySelector('button.DkEaL') || {}).textContent || ''`),
    address: await js(`(document.querySelector('[data-item-id="address"]') || {}).textContent || ''`),
    place: (String(href).match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || []).slice(1).map(Number),
    list: await js(`[...document.querySelectorAll('a.hfpxzc')].slice(0, 6).map(a => ({ name: a.getAttribute('aria-label'), lat: +(a.href.match(/!3d(-?[\\d.]+)/) || [])[1] || null, lng: +(a.href.match(/!4d(-?[\\d.]+)/) || [])[1] || null, url: a.href }))`),
  };
  results[q.key] = r;
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log(`${q.key}  →  ${r.name || '(list)'} | ${r.address} | ${r.place.join(',')} | list ${r.list?.length || 0}`);
  await sleep(1500);
}
ws.close(); chrome.kill(); process.exit(0);
