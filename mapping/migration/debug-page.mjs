import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3200/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[REQFAIL] ${r.url()} — ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => logs.push('[GOTO] ' + e.message));
await new Promise((r) => setTimeout(r, 6000));

const info = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  return {
    hasLegacyRoot: !!q('[data-legacy-root]'),
    legacyRootChildren: q('[data-legacy-root]')?.children.length ?? -1,
    hasMapDiv: !!q('#map'),
    mapHTMLlen: q('#map')?.innerHTML.length ?? -1,
    leafletContainer: !!q('.leaflet-container'),
    tiles: document.querySelectorAll('img.leaflet-tile').length,
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    maplibreCanvas: !!q('.maplibregl-canvas'),
    Ltype: typeof window.L,
    supabaseType: typeof window.supabase,
    bodyChildTags: Array.from(document.body.children).map((c) => c.tagName + (c.id ? '#' + c.id : '')).slice(0, 20),
  };
});

console.log('URL:', URL);
console.log('DOM:', JSON.stringify(info, null, 2));
console.log('--- console/errors (last 40) ---');
console.log(logs.slice(-40).join('\n'));

await browser.close();
