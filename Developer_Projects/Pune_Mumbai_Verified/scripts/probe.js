// Reads one public web page (developer's own site) and prints what is needed to verify a record:
// logo candidates, map points, RERA numbers, addresses, configuration words, and links containing a keyword.
//   node probe.js <url> [linkKeyword]
// Caches the HTML under ../cache/pages/ (git-ignored) so a page is fetched once. Polite: one request, 30 s timeout.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [url, kw] = process.argv.slice(2);
const CACHE = path.resolve(__dirname, '..', 'cache', 'pages');
fs.mkdirSync(CACHE, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

(async () => {
  const file = path.join(CACHE, crypto.createHash('md5').update(url).digest('hex') + '.html');
  let html, finalUrl = url;
  if (fs.existsSync(file)) { const c = JSON.parse(fs.readFileSync(file, 'utf8')); html = c.html; finalUrl = c.url; }
  else {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    html = await res.text(); finalUrl = res.url;
    console.log('HTTP', res.status, finalUrl, html.length, 'bytes');
    fs.writeFileSync(file, JSON.stringify({ url: finalUrl, fetched: new Date().toISOString(), status: res.status, html }));
  }
  const abs = (u) => { try { return new URL(u.replace(/&amp;/g, '&'), finalUrl).href; } catch { return u; } };
  const uniq = (a) => [...new Set(a)];
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  console.log('TITLE:', (html.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim());
  const logos = uniq([...html.matchAll(/<img[^>]+>/gi)].map((m) => m[0]).filter((t) => /logo/i.test(t)).map((t) => abs((t.match(/\s(?:data-)?src=["']([^"']+)/i) || [])[1] || '') + '  alt=' + ((t.match(/alt=["']([^"']*)/i) || [])[1] || ''))).slice(0, 8);
  console.log('LOGO <img>:', logos.length ? '\n  ' + logos.join('\n  ') : 'none');
  const og = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image/i) || [])[1];
  if (og) console.log('OG:IMAGE:', abs(og));
  const icons = uniq([...html.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi)].map((m) => abs((m[0].match(/href=["']([^"']+)/i) || [])[1] || ''))).slice(0, 3);
  if (icons.length) console.log('ICONS:', icons.join(' '));
  const pts = [];
  for (const m of html.matchAll(/!2d(\d{2}\.\d+)!3d(\d{2}\.\d+)/g)) pts.push(`embed lat=${m[2]} lng=${m[1]}`);
  for (const m of html.matchAll(/@(\d{2}\.\d{4,}),(\d{2}\.\d{4,})/g)) pts.push(`maps-link lat=${m[1]} lng=${m[2]}`);
  for (const m of html.matchAll(/[?&](?:q|ll|query|destination|center)=(\d{2}\.\d{4,})(?:,|%2C)\s*(\d{2}\.\d{4,})/gi)) pts.push(`maps-query lat=${m[1]} lng=${m[2]}`);
  for (const m of html.matchAll(/["']?lat(?:itude)?["']?\s*[:=]\s*["']?(1[89]\.\d{4,})["']?[\s,;]+["']?(?:lng|lon|long|longitude)["']?\s*[:=]\s*["']?(7[234]\.\d{4,})/gi)) pts.push(`script lat=${m[1]} lng=${m[2]}`);
  console.log('MAP POINTS:', pts.length ? uniq(pts).slice(0, 8).join(' | ') : 'none');
  const maps = uniq([...html.matchAll(/https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)[^"'\s<>]*/gi)].map((m) => m[0].replace(/&amp;/g, '&'))).slice(0, 5);
  if (maps.length) console.log('MAP LINKS:\n  ' + maps.map((m) => m.slice(0, 220)).join('\n  '));
  const rera = uniq(text.match(/\bP[RMC]?\d{10,14}\b|\bP5\d{10}\b/g) || []);
  console.log('RERA NOs:', rera.join(', ') || 'none');
  const addr = uniq([...text.matchAll(/(?:address|site address|corporate office|registered office|site office|located at)[^A-Za-z0-9]{0,5}(.{20,220}?\b4\d{2}\s?\d{3}\b)/gi)].map((m) => m[1].trim())).slice(0, 4);
  console.log('ADDRESS-LIKE:', addr.length ? '\n  ' + addr.join('\n  ') : 'none');
  const pins = uniq(text.match(/\b4[01]\d\s?\d{3}\b/g) || []).slice(0, 10); console.log('PINCODES:', pins.join(', ') || 'none');
  const bhk = uniq((text.match(/\b\d(?:\.5)?\s?(?:&\s?\d(?:\.5)?\s?)?BHK\b/gi) || []).map((s) => s.toUpperCase().replace(/\s+/g, ' '))).slice(0, 10);
  console.log('BHK WORDS:', bhk.join(', ') || 'none');
  const poss = uniq((text.match(/(?:possession|completion)[^.]{0,60}?\b(?:20[2-3]\d)\b/gi) || [])).slice(0, 4); console.log('POSSESSION WORDS:', poss.join(' | ') || 'none');
  const tel = uniq([...html.matchAll(/href=["']tel:([^"']+)/gi)].map((m) => m[1].trim())).slice(0, 4); const mail = uniq([...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => m[1].trim())).slice(0, 4);
  console.log('TEL:', tel.join(', ') || 'none', '| MAIL:', mail.join(', ') || 'none');
  if (kw) {
    const re = new RegExp(kw, 'i');
    const links = uniq([...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)].filter((m) => re.test(m[1]) || re.test(m[2])).map((m) => abs(m[1]) + '  [' + m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) + ']')).slice(0, 12);
    console.log(`LINKS ~ /${kw}/:`, links.length ? '\n  ' + links.join('\n  ') : 'none');
    const ctx = [...text.matchAll(new RegExp(`.{0,160}${kw}.{0,200}`, 'gi'))].map((m) => m[0]).slice(0, 3);
    if (ctx.length) console.log('TEXT ~ kw:\n  ' + ctx.join('\n  '));
  }
})().catch((e) => console.log('FETCH FAILED:', url, e.cause?.code || e.message));
