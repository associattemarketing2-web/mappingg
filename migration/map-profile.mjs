// Real browser profiler for the public /map page. Measures the actual network
// waterfall, main-thread long tasks, time-to-markers and JS heap — no guessing.
// Usage: node migration/map-profile.mjs http://localhost:3320/map
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3320/map';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const ctx = browser.defaultBrowserContext();
try { await ctx.overridePermissions(new URL(URL).origin, ['geolocation']); } catch {}
await page.setGeolocation({ latitude: 18.5256, longitude: 73.9226 });

// Collect every response with its transferred size.
const responses = [];
page.on('response', async (res) => {
  try {
    const req = res.request();
    const buf = await res.buffer().catch(() => null);
    responses.push({ url: res.url(), type: req.resourceType(), status: res.status(), bytes: buf ? buf.length : 0 });
  } catch {}
});

// Observe long tasks (main-thread blocking) from the very start.
await page.evaluateOnNewDocument(() => {
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longtasks.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
});

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message));

// Poll until Leaflet markers appear (time-to-markers).
let markerMs = -1, markerCount = 0;
for (let i = 0; i < 120; i++) {
  markerCount = await page.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length).catch(() => 0);
  if (markerCount > 0) { markerMs = Date.now() - t0; break; }
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 4000)); // let it settle

const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  return {
    ttfb: Math.round(n.responseStart || 0),
    domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
    load: Math.round(n.loadEventEnd || 0),
  };
});
const longtasks = await page.evaluate(() => window.__longtasks || []);
const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
const finalMarkers = await page.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length);

// Summarise the waterfall.
const groups = {};
for (const r of responses) {
  let k = 'other';
  if (r.url.includes('/api/db')) k = '/api/db (pins etc.)';
  else if (r.url.includes('/legacy/')) k = 'legacy bundle json';
  else if (r.url.includes('/api/media')) k = '/api/media images';
  else if (r.url.includes('leaflet')) k = 'leaflet lib/css';
  else if (r.url.includes('unpkg')) k = 'unpkg other';
  else if (r.url.includes('fonts.g')) k = 'google fonts';
  else if (r.url.includes('tile') || r.url.includes('openstreetmap') || r.url.includes('arcgis')) k = 'map tiles';
  else if (r.url.includes('/db-shim')) k = 'db-shim.js';
  else if (r.type === 'document') k = 'map html document';
  else if (r.type === 'script') k = 'other scripts';
  (groups[k] ||= { count: 0, bytes: 0 }).count++;
  groups[k].bytes += r.bytes;
}

console.log('\n==== /map REAL PROFILE ====');
console.log('URL:', URL);
console.log('TTFB(ms):', nav.ttfb, ' DOMContentLoaded(ms):', nav.domContentLoaded, ' load(ms):', nav.load);
console.log('time-to-first-marker(ms):', markerMs, ' markers rendered:', finalMarkers);
console.log('JS heap used(MB):', mem);
console.log('long tasks (count):', longtasks.length, ' total blocking(ms):', longtasks.reduce((a, b) => a + b, 0), ' tasks:', JSON.stringify(longtasks));
console.log('\n-- network by group (bytes transferred) --');
let total = 0;
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].bytes - a[1].bytes)) {
  total += v.bytes;
  console.log(`  ${k.padEnd(24)} ${String(v.count).padStart(3)} reqs  ${(v.bytes / 1024).toFixed(1)} KB`);
}
console.log(`  ${'TOTAL'.padEnd(24)} ${String(responses.length).padStart(3)} reqs  ${(total / 1024).toFixed(1)} KB`);

// The single biggest data request (the all-pins fetch).
const apidb = responses.filter((r) => r.url.includes('/api/db')).sort((a, b) => b.bytes - a.bytes)[0];
if (apidb) console.log('\nlargest /api/db response:', (apidb.bytes / 1024).toFixed(1), 'KB');

await browser.close();
