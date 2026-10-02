import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.argv[2] || 'http://localhost:3400';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(base, ['geolocation']);

for (const path of ['/', '/s-admin', '/mundhwa-map-3d']) {
  const page = await browser.newPage();
  await page.setGeolocation({ latitude: 18.5256, longitude: 73.9226 });
  const supabaseHits = [];
  const dbShim = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/supabase/i.test(u)) supabaseHits.push(u);
    if (/db-shim\.js/.test(u)) dbShim.push(u);
  });
  await page.goto(base + path, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 6000));
  const markers = await page.evaluate(() =>
    document.querySelectorAll('.leaflet-marker-icon, .maplibregl-marker').length);
  console.log(`\n${path}`);
  console.log('  markers rendered :', markers);
  console.log('  db-shim.js loaded:', dbShim.length > 0);
  console.log('  SUPABASE requests:', supabaseHits.length, supabaseHits.slice(0, 3));
  await page.close();
}
await browser.close();
