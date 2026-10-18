// Fetches public MahaRERA "Search Project" listing pages (no login, no CAPTCHA) for Pune and Mumbai,
// newest pages first, skipping pages the existing dataset already covers. Polite: one page every 3 s,
// cached (cache/maharera/<district>/p<N>.html), backs off and stops on 403/429 or repeated errors.
//   node scripts/crawl-listing.js <district>:<fromPage>-<toPage>[,more] ...
//   e.g. node scripts/crawl-listing.js 521:1240-1300 518:585-633 519:105-130
const fs = require('fs'), path = require('path');
const C = require('./common.js');
const DIST = { 521: 'Pune', 518: 'Mumbai Suburban', 519: 'Mumbai City', 516: 'Nashik', 517: 'Thane' };
const BASE = 'https://www.maharera.maharashtra.gov.in/projects-search-result?project_state=27';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pages already in the database snapshot (no need to fetch them again).
const done = new Set();
for (const r of JSON.parse(fs.readFileSync(path.join(C.snapshotDir(), 'scraped_projects.json'), 'utf8'))) {
  const m = String(r.doc?.original?.source_url || '').match(/project_district=(\d+)&page=(\d+)/); if (m) done.add(`${m[1]}:${m[2]}`);
}

(async () => {
  const jobs = [];
  for (const a of process.argv.slice(2)) { const [d, rng] = a.split(':'); const [from, to] = rng.split('-').map(Number); for (let p = to; p >= from; p--) if (!done.has(`${d}:${p}`)) jobs.push([d, p]); }
  console.log(`${jobs.length} pages to fetch (already-covered pages skipped)`);
  let fails = 0;
  for (const [d, p] of jobs) {
    const dir = path.join(C.ROOT, 'cache', 'maharera', d); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `p${p}.html`);
    if (fs.existsSync(file)) continue;
    const url = `${BASE}&project_district=${d}&page=${p}`;
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
        if (res.status === 403 || res.status === 429) { console.log(`HTTP ${res.status} on ${DIST[d]} p${p} - stopping to respect the site's limits`); process.exit(2); }
        const html = await res.text();
        if (!res.ok || !html.includes('Showing Final')) throw new Error(`HTTP ${res.status}, ${html.length} bytes, no results block`);
        fs.writeFileSync(file, html); ok = true; fails = 0;
        console.log(`${DIST[d]} p${p} ok (${(html.match(/<p class="p-0">#/g) || []).length} records)`);
      } catch (e) { console.log(`${DIST[d]} p${p} attempt ${attempt}: ${e.message}`); await sleep(10000 * attempt); }
    }
    if (!ok && ++fails >= 3) { console.log('3 pages failed in a row - stopping'); process.exit(3); }
    await sleep(3000);
  }
  console.log('done');
})();
