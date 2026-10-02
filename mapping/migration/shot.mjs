import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const targets = [
  ['http://localhost:3200/', 'shot-public.png'],
  ['http://localhost:3200/s-admin', 'shot-editor.png'],
  ['http://localhost:3200/mundhwa-map-3d', 'shot-3d.png'],
];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
for (const [url, file] of targets) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  // grant geolocation so the public map's "near me" doesn't hang on prompt
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:3200', ['geolocation']);
  await page.setGeolocation({ latitude: 18.5256, longitude: 73.9226 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 7000));
  const extra = await page.evaluate(() => ({
    mlMarkers: document.querySelectorAll('.maplibregl-marker').length,
    leafMarkers: document.querySelectorAll('.leaflet-marker-icon').length,
  }));
  await page.screenshot({ path: file, fullPage: false });
  console.log(file, JSON.stringify(extra));
  await page.close();
}
await browser.close();
