// Crawls a developer's OWN website (same host only, max N pages, 1 request / 1.5 s, cached) and records, for every
// page that shows MahaRERA registration numbers, what the page states: RERA numbers, BHK types (page title / meta
// description only, not the site menu), possession sentences with the date they state, address, land, map points.
// Output: cache/devsites/<host>.json
//   node scripts/dev-crawl.js <homepage> [maxPages=80]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require('./common.js');
const [start, maxArg] = process.argv.slice(2);
const MAX = Number(maxArg) || 80;
const host = new URL(start).hostname.replace(/^www\./, '');
const OUT = path.join(C.ROOT, 'cache', 'devsites'); fs.mkdirSync(OUT, { recursive: true });
const PAGES = path.join(C.ROOT, 'cache', 'pages'); fs.mkdirSync(PAGES, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// MahaRERA (P5 + 10 digits, PR/PM/PC/PP + 13 digits) and Telangana RERA (P02 + 9 digits).
const RERA = /\b(P[RMCP]\d{13}|P5\d{10}|P02\d{9})\b/g;
const PRIORITY = /pune|mumbai|thane|navi|project|residential|ongoing|propert|homes|apartment|flats|bhk|location|city|new-launch|upcoming|luxury/i;
const SKIP = /\.(pdf|jpe?g|png|webp|svg|gif|mp4|zip|docx?|xlsx?)(\?|$)|blog|news|media|career|investor|press|policy|terms|login|whatsapp|tel:|mailto:|nri|faq|csr|award|disclaimer|sitemap|feed|wp-json|javascript:/i;

async function get(url) {
  const file = path.join(PAGES, crypto.createHash('md5').update(url).digest('hex') + '.html');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.OFFLINE === '1') return { url, status: 0, html: '', error: 'not cached (offline run)' };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const type = res.headers.get('content-type') || '';
    const html = /html|text/.test(type) ? await res.text() : '';
    const c = { url: res.url, fetched: new Date().toISOString(), status: res.status, html };
    fs.writeFileSync(file, JSON.stringify(c)); await sleep(1500); return c;
  } catch (e) { await sleep(1500); return { url, status: 0, html: '', error: e.cause?.code || e.message }; }
}
const text = (h) => h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '-').replace(/\s+/g, ' ');
const uniq = (a) => [...new Set(a)];

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const yr = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y));
/** Date stated in a possession sentence: "30/12/31" -> 2031-12-30, "Dec 2029" -> 2029-12, "31st December 2030" -> 2030-12-31. A year alone -> null. */
// Real calendar dates only (31/09 is rejected).
const valid = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
function parseDate(s) {
  let m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/);
  if (m && valid(yr(m[3]), +m[2], +m[1]) && yr(m[3]) >= 2024 && yr(m[3]) <= 2040) return `${yr(m[3])}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/\b(?:(\d{1,2})(?:st|nd|rd|th)?[\s-]+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,'-]+(20[2-4]\d|\d{2})\b/i);
  if (m && yr(m[3]) >= 2024 && yr(m[3]) <= 2040 && (!m[1] || valid(yr(m[3]), MON[m[2].toLowerCase()], +m[1]))) return m[1] ? `${yr(m[3])}-${pad(MON[m[2].toLowerCase()])}-${pad(m[1])}` : `${yr(m[3])}-${pad(MON[m[2].toLowerCase()])}`;
  return null;
}
const BHK_RE = /\b\d(?:\.5)?(?:\s*(?:,|&|and|\/)\s*\d(?:\.5)?)*\s*BHK\b/gi;

function facts(c) {
  const h = c.html;
  const decoded = h.replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').replace(/\\u0026/gi, '&').replace(/\\"/g, '"').replace(/\\[rnt]/g, ' ');
  const t = text(h); void decoded;
  const rera = uniq([...(h.replace(/\\u002F|\s+/g, ' ').match(RERA) || [])]);
  const title = ((h.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").trim();
  const desc = ((h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || h.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description/i) || [])[1] || '');
  const ogt = ((h.match(/property=["']og:title["'][^>]*content=["']([^"']*)/i) || [])[1] || '');
  const head = [title, desc, ogt].join(' | ');
  const bhk = uniq((head.match(BHK_RE) || []).flatMap((x) => x.match(/\d(?:\.5)?/g)).map((n) => `${n} BHK`));
  // The date must follow the keyword closely (within 80 characters); the sentence around it is kept as evidence.
  const possession = uniq([...t.matchAll(/[^.?!|]{0,160}\b(possession|completion date|completion|handover|hand over|delivered|delivery)\b([^?!|]{0,160})/gi)]
    .map((m) => ({ text: m[0].trim().slice(0, 320), date: parseDate(m[2].slice(0, 80)) })).filter((x) => x.date).map((x) => JSON.stringify(x))).slice(0, 5).map((x) => JSON.parse(x));
  const addr = uniq([...t.matchAll(/(?:site address|project address|address)\s*[:-]?\s*(.{15,200}?\b4[01]\d\s?\d{3}\b)/gi)].map((m) => m[1].trim())).slice(0, 3);
  const land = uniq([...t.matchAll(/[^.]{0,60}?\b\d{1,3}(?:\.\d+)?\s*\+?\s*acres?\b[^.]{0,40}/gi)].map((m) => m[0].trim())).slice(0, 3);
  const map = uniq([...h.matchAll(/!2d(7[2-4]\.\d+)!3d(1[89]\.\d+)/g)].map((m) => `${m[2]},${m[1]}`).concat([...h.matchAll(/@(1[89]\.\d{4,}),(7[2-4]\.\d{4,})/g)].map((m) => `${m[1]},${m[2]}`))).slice(0, 4);
  return { url: c.url, title, description: desc.slice(0, 300), rera, bhk, possession, address: addr, land_text: land, map_points: map };
}

(async () => {
  const seen = new Set(), queue = [start], pages = [];
  let fetched = 0;
  while (queue.length && fetched < MAX) {
    queue.sort((a, b) => (PRIORITY.test(b) ? 1 : 0) - (PRIORITY.test(a) ? 1 : 0));
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const c = await get(u); fetched++;
    if (!c.html) continue;
    const f = facts(c); if (f.rera.length) pages.push(f);
    for (const m of c.html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      let v; try { v = new URL(m[1].replace(/&amp;/g, '&'), c.url); } catch { continue; }
      if (v.hostname.replace(/^www\./, '') !== host || SKIP.test(v.href)) continue;
      v.hash = ''; const s = v.href.replace(/\/$/, '');
      if (!seen.has(s) && !seen.has(s + '/') && !queue.includes(s)) queue.push(s);
    }
  }
  fs.writeFileSync(path.join(OUT, host + '.json'), JSON.stringify({ host, start, crawled: new Date().toISOString(), fetched, pages }, null, 1));
  const proj = pages.filter((p) => p.rera.length <= 4);
  console.log(`${host}: ${fetched} pages, ${pages.length} with RERA nos, ${uniq(proj.flatMap((p) => p.rera)).length} numbers on project pages, ${proj.filter((p) => p.bhk.length && p.possession.length).length} project pages with BHK + possession`);
})();
