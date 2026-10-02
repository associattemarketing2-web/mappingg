import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.argv[2] || 'http://localhost:3700';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 7000));
const info = await page.evaluate(async () => {
  let regs = [];
  try { regs = (await navigator.serviceWorker.getRegistrations()).map((r) => r.active?.scriptURL || 'installing'); } catch {}
  const manifestHref = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
  const manifest = manifestHref ? await fetch(manifestHref).then((r) => r.json()).catch(() => null) : null;
  return {
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    swRegistrations: regs,
    manifestName: manifest?.name,
    manifestIcons: manifest?.icons?.length,
    display: manifest?.display,
    appleMeta: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]'),
    appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
  };
});
console.log(JSON.stringify(info, null, 2));
console.log('pageerrors:', errs);
await browser.close();
