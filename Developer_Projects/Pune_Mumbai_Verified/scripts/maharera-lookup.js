// Looks up MahaRERA registration numbers on the PUBLIC "Search Project" listing (no login, no CAPTCHA), one at a time.
// Polite and bounded: 4 s between requests, at most 2 tries per number, stops after 8 unanswered in a row.
// Every attempt is logged (cache/maharera/lookup-log.jsonl); answers are cached (cache/maharera/lookup/<no>.html),
// so a rerun only asks for what is still missing.
//   node scripts/maharera-lookup.js <queue.json> [--max N]
const fs = require('fs'), path = require('path');
const [queueFile, ...args] = process.argv.slice(2);
const MAX = Number(args.includes('--max') ? args[args.indexOf('--max') + 1] : Infinity);
const DIR = path.resolve(__dirname, '..', 'cache', 'maharera', 'lookup'); fs.mkdirSync(DIR, { recursive: true });
const LOG = path.resolve(__dirname, '..', 'cache', 'maharera', 'lookup-log.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
(async () => {
  const q = JSON.parse(fs.readFileSync(queueFile, 'utf8')).filter((r) => r.in_db === 'not in db' && !fs.existsSync(path.join(DIR, `${r.rera}.html`))).slice(0, MAX);
  console.log(`${q.length} numbers to look up`);
  let unanswered = 0, found = 0, done = 0;
  for (const r of q) {
    let ok = false;
    for (let t = 1; t <= 2 && !ok; t++) {
      const at = new Date().toISOString();
      try {
        const res = await fetch(`https://www.maharera.maharashtra.gov.in/projects-search-result?project_name=${r.rera}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
        if (res.status === 403 || res.status === 429) { fs.appendFileSync(LOG, JSON.stringify({ rera: r.rera, at, status: res.status, stop: true }) + '\n'); console.log(`HTTP ${res.status} - stopping`); process.exit(2); }
        const h = await res.text();
        ok = h.includes('Showing Final');
        fs.appendFileSync(LOG, JSON.stringify({ rera: r.rera, at, try: t, status: res.status, answered: ok }) + '\n');
        if (ok) { fs.writeFileSync(path.join(DIR, `${r.rera}.html`), h); if (h.includes(`# ${r.rera}`)) found++; }
      } catch (e) { fs.appendFileSync(LOG, JSON.stringify({ rera: r.rera, at, try: t, error: e.message }) + '\n'); }
      await sleep(ok ? 4000 : 8000);
    }
    unanswered = ok ? 0 : unanswered + 1;
    if (unanswered >= 8) { console.log('8 unanswered in a row - stopping (registry not responding)'); break; }
    if (++done % 20 === 0) console.log(`${done}/${q.length} looked up, ${found} found`);
  }
  console.log(`done: ${done} looked up, ${found} found on the listing`);
})();
