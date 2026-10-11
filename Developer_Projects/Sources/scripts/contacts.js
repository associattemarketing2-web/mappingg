// Extract publicly published business contacts (tel:/mailto: links) from a developer's own website.
// Usage: node contacts.js <outJson> <json list of {legal, brand, domain, mustMatch}>
const fs = require('fs');
const [outFile, listFile] = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PATHS = ['/', '/contact-us', '/contact', '/contactus', '/contact-us/', '/contact/'];
const PERSONAL_EMAIL = /@(gmail|yahoo|hotmail|outlook|rediffmail|live|icloud)\./i;
async function get(u) {
  try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (research; low-rate)' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: r.status, url: r.url, html: r.ok ? await r.text() : '' }; } catch (e) { return { status: 0, url: u, html: '', err: e.message }; }
}
(async () => {
  for (const d of list) {
    if (out[d.legal] && out[d.legal].done) continue;
    const rec = { legal: d.legal, brand: d.brand, domain: d.domain, pages: [], phones: [], emails: [], identity: false, done: false };
    for (const p of PATHS) {
      const u = `https://${d.domain}${p}`; const r = await get(u); await sleep(2500);
      rec.pages.push({ url: u, final: r.url, status: r.status, err: r.err });
      if (!r.html) continue;
      const title = (r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].replace(/\s+/g, ' ').trim();
      if (new RegExp(d.mustMatch, 'i').test(title + ' ' + r.html.slice(0, 200000))) { rec.identity = true; rec.title = rec.title || title; }
      for (const m of r.html.matchAll(/href=["']tel:([^"']+)["']/gi)) { const n = decodeURIComponent(m[1]).replace(/[^\d+]/g, ''); if (n.replace(/\D/g, '').length >= 8 && !rec.phones.some(x => x.number === n)) rec.phones.push({ number: n, source: r.url }); }
      for (const m of r.html.matchAll(/href=["']mailto:([^"'?]+)/gi)) { const e = decodeURIComponent(m[1]).trim().toLowerCase(); if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !PERSONAL_EMAIL.test(e) && !rec.emails.some(x => x.email === e)) rec.emails.push({ email: e, source: r.url }); }
      if (/contact/i.test(p) && (rec.phones.length || rec.emails.length) && r.status === 200) rec.contactPage = rec.contactPage || r.url;
    }
    rec.done = true; out[d.legal] = rec; fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    console.log(`${d.legal}: identity=${rec.identity} phones=${rec.phones.map(x => x.number).join(',')} emails=${rec.emails.map(x => x.email).join(',')}`);
  }
})();
