// Mappingg SEO crawler — HTTP + rendered-HTML checks for every discoverable URL.
//
//   npm run seo:audit                        full audit of https://www.mappingg.com
//   node scripts/seo-audit/crawl.mjs --base=http://localhost:3000 --label=local
//   node scripts/seo-audit/crawl.mjs --focus=links      (also: metadata, schema, sitemap)
//   node scripts/seo-audit/crawl.mjs --limit=200        (cap pages, for a quick run)
//
// Discovery: robots.txt → sitemap.xml → every public static route in app/ →
// internal links found on crawled pages (breadth-first). Read-only: GET requests
// only, 4 at a time, with a crawler User-Agent. Writes to reports/seo-audit/<date>/:
//   seo-audit-results.json, PAGE-BY-PAGE-SEO.csv, TECHNICAL-SEO-ISSUES.csv, BLOG-SEO-REPORT.csv
//
// What it cannot see: JavaScript-only content (it reads the server HTML, which is
// what Google indexes first), Core Web Vitals, and Google's own index status.

import { parse } from 'node-html-parser';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { arg, markLastRun, outDir, writeCsv, writeJson, SEVERITY_ORDER } from './common.mjs';

const BASE = String(arg('base', 'https://www.mappingg.com')).replace(/\/$/, '');
const CANON_ORIGIN = String(arg('canonical-origin', 'https://www.mappingg.com')).replace(/\/$/, '');
const LIMIT = Number(arg('limit', 5000));
const CONCURRENCY = Number(arg('concurrency', 4));
const FOCUS = arg('focus', '');
const UA = 'MappinggSEOAudit/1.0 (+https://www.mappingg.com; internal audit)';

const issues = [];
const issue = (url, severity, code, detail, fix) => issues.push({ url, severity, code, detail, fix });

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function get(url, { follow = true } = {}) {
  const chain = [];
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' } });
    } catch (e) {
      return { url, status: 0, error: String(e.message || e), chain };
    }
    const ms = Date.now() - t0;
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current).toString();
      chain.push({ from: current, status: res.status, to: next });
      await res.arrayBuffer().catch(() => {});
      if (!follow) return { url, status: res.status, location: next, chain, ms };
      current = next;
      continue;
    }
    const body = await res.text().catch(() => '');
    return {
      url,
      finalUrl: current,
      status: res.status,
      chain,
      ms,
      contentType: res.headers.get('content-type') || '',
      xRobots: res.headers.get('x-robots-tag') || '',
      bytes: Buffer.byteLength(body),
      body,
    };
  }
  return { url, status: 0, error: 'too many redirects', chain };
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function parseRobots(txt) {
  const disallow = [];
  const sitemaps = [];
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') applies = m[2] === '*' || /googlebot/i.test(m[2]);
    else if (key === 'disallow' && applies && m[2]) disallow.push(m[2]);
    else if (key === 'sitemap') sitemaps.push(m[2]);
  }
  return { disallow, sitemaps };
}

const blocked = (pathname, disallow) => disallow.some((d) => pathname.startsWith(d));

/** Static, public page routes from the app/ folder (no dynamic segments, no private areas). */
async function sourceRoutes() {
  const routes = [];
  async function walk(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((e) => e.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(e.name))) routes.push(rel || '/');
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('[') || e.name.startsWith('(') || e.name.startsWith('_') || e.name === 'api') continue;
      await walk(path.join(dir, e.name), `${rel}/${e.name}`);
    }
  }
  await walk(path.resolve('app'), '');
  return routes;
}

function sitemapChecks(xml, url) {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const lastmods = [...xml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/g)].map((m) => m[1]);
  const result = {
    url,
    wellFormed: /^\s*<\?xml/.test(xml) && /<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(xml) && /<\/urlset>\s*$/.test(xml),
    urls: locs.length,
    bytes: Buffer.byteLength(xml),
    duplicates: locs.length - new Set(locs).size,
    offOrigin: locs.filter((l) => !l.startsWith(CANON_ORIGIN + '/') && l !== CANON_ORIGIN).length,
    badLastmod: lastmods.filter((d) => Number.isNaN(Date.parse(d))).length,
    futureLastmod: lastmods.filter((d) => Date.parse(d) > Date.now() + 86400000).length,
    withLastmod: lastmods.length,
  };
  if (!result.wellFormed) issue(url, 'critical', 'sitemap-invalid', 'Sitemap is not a well-formed urlset', 'Fix app/sitemap.ts output');
  if (result.urls > 50000 || result.bytes > 50 * 1024 * 1024) issue(url, 'high', 'sitemap-too-large', `${result.urls} URLs / ${result.bytes} bytes`, 'Split into a sitemap index');
  if (result.duplicates) issue(url, 'medium', 'sitemap-duplicate-url', `${result.duplicates} duplicate <loc> entries`, 'De-duplicate in app/sitemap.ts');
  if (result.offOrigin) issue(url, 'high', 'sitemap-off-origin', `${result.offOrigin} URLs not on ${CANON_ORIGIN}`, 'Use SITE_URL for every entry');
  if (result.badLastmod) issue(url, 'medium', 'sitemap-bad-lastmod', `${result.badLastmod} unparsable <lastmod>`, 'Emit ISO dates');
  if (result.futureLastmod) issue(url, 'low', 'sitemap-future-lastmod', `${result.futureLastmod} <lastmod> in the future`, 'Use real update dates');
  return { result, locs };
}

// ---------------------------------------------------------------------------
// Page analysis
// ---------------------------------------------------------------------------

const toCanonPath = (href) => {
  try {
    const u = new URL(href);
    return u.pathname + u.search;
  } catch {
    return href;
  }
};

function pageType(p) {
  const seg = p.split('?')[0].split('/').filter(Boolean);
  if (!seg.length) return 'home';
  const map = { projects: 'project', locations: 'locality', developers: 'developer', cities: 'city', status: 'status', property: 'property-type', blog: 'blog-post' };
  if (seg.length === 1) return { projects: 'project-listing', locations: 'locality-listing', developers: 'developer-listing', cities: 'city-listing', property: 'property-type-listing', blog: 'blog-listing', map: 'map' }[seg[0]] || 'static';
  if (seg[0] === 'developer-api') return 'api-docs';
  return map[seg[0]] || 'other';
}

function schemaChecks(url, blocks) {
  const types = [];
  const errors = [];
  for (const raw of blocks) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      errors.push(`invalid JSON-LD: ${String(e.message).slice(0, 80)}`);
      continue;
    }
    const nodes = (Array.isArray(data) ? data : [data]).flatMap((n) => (n && n['@graph'] ? n['@graph'] : [n]));
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const t = [].concat(n['@type'] || 'unknown').join('/');
      types.push(t);
      if (!n['@context'] && !(Array.isArray(data) && data[0]?.['@context'])) errors.push(`${t}: missing @context`);
      if (t === 'BreadcrumbList') {
        const items = n.itemListElement || [];
        if (!items.length) errors.push('BreadcrumbList: no items');
        items.forEach((it, i) => {
          if (it.position !== i + 1) errors.push('BreadcrumbList: positions not sequential');
          if (!it.name) errors.push('BreadcrumbList: item without name');
          if (i < items.length - 1 && !it.item) errors.push('BreadcrumbList: intermediate item without URL');
        });
      }
      if (t === 'BlogPosting' || t === 'Article') {
        for (const k of ['headline', 'datePublished', 'image', 'author']) if (!n[k]) errors.push(`${t}: missing ${k}`);
        if (n.headline && n.headline.length > 110) errors.push(`${t}: headline over 110 chars`);
      }
      if (t === 'FAQPage') {
        const q = n.mainEntity || [];
        if (!q.length) errors.push('FAQPage: no questions');
        if (q.some((x) => !x.name || !x.acceptedAnswer?.text)) errors.push('FAQPage: question without answer');
        if (q.some((x) => x.name && x.acceptedAnswer?.text && x.name.trim() === String(x.acceptedAnswer.text).trim())) errors.push('FAQPage: answer text repeats the question');
      }
      if (t === 'ItemList' && !(n.itemListElement || []).length) errors.push('ItemList: empty');
      if (t === 'VideoObject') for (const k of ['name', 'thumbnailUrl', 'uploadDate']) if (!n[k]) errors.push(`VideoObject: missing ${k}`);
      if (/aggregateRating|review/i.test(JSON.stringify(n))) errors.push(`${t}: contains rating/review markup — verify it is real and visible`);
    }
  }
  const counts = types.reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {});
  for (const [t, c] of Object.entries(counts)) if (c > 1 && !['ListItem', 'Question'].includes(t) && t !== 'VideoObject') errors.push(`duplicate ${t} nodes (${c})`);
  for (const e of errors) issue(url, /invalid JSON|missing headline|missing @context/.test(e) ? 'high' : 'medium', 'schema', e, 'Fix the JSON-LD builder in lib/seo/schema.ts or the page');
  return { types, errors };
}

function analyze(url, res) {
  const p = toCanonPath(url);
  const row = {
    url: p,
    type: pageType(p),
    status: res.status,
    redirect_to: res.chain?.length ? toCanonPath(res.finalUrl || res.chain[res.chain.length - 1].to) : '',
    redirect_hops: res.chain?.length || 0,
    response_ms: res.ms || '',
    html_kb: res.bytes ? Math.round(res.bytes / 1024) : '',
  };
  if (res.status !== 200 || !/text\/html/.test(res.contentType || '')) return { row, links: [] };

  const root = parse(res.body, { comment: false, blockTextElements: { script: true, style: true, noscript: true } });
  const head = root.querySelector('head');
  const meta = (sel) => root.querySelector(sel)?.getAttribute('content')?.trim() || '';
  const title = root.querySelector('title')?.text.trim() || '';
  const description = meta('meta[name="description"]');
  const robots = [meta('meta[name="robots"]'), meta('meta[name="googlebot"]'), res.xRobots].filter(Boolean).join(', ');
  const canonicals = root.querySelectorAll('link[rel="canonical"]').map((l) => l.getAttribute('href') || '');
  const canonical = canonicals[0] || '';
  const h1s = root.querySelectorAll('h1').map((h) => h.text.replace(/\s+/g, ' ').trim());
  const headings = root.querySelectorAll('h1,h2,h3,h4,h5,h6').map((h) => Number(h.tagName[1]));
  const jsonLdBlocks = root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.rawText || s.text);
  const imgs = root.querySelectorAll('main img, article img, img');
  const seenImg = new Set();
  const images = imgs.filter((i) => !seenImg.has(i) && seenImg.add(i));

  // Visible text: drop scripts, styles, nav chrome.
  // Inside <main>, a <header> is the page's own hero (H1 + intro), so only the
  // site chrome outside <main> is dropped.
  const mainEl = root.querySelector('main');
  const bodyEl = mainEl || root.querySelector('body') || root;
  const clone = parse(bodyEl.toString());
  clone.querySelectorAll(mainEl ? 'script,style,noscript,nav,svg' : 'script,style,noscript,nav,header,footer,svg').forEach((n) => n.remove());
  const words = clone.text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => /\w/.test(w)).length;

  const links = [];
  let external = 0;
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (/^(mailto:|tel:|javascript:|#|whatsapp:|sms:)/i.test(href)) continue;
    let u;
    try {
      u = new URL(href, res.finalUrl || url);
    } catch {
      continue;
    }
    const sameSite = u.origin === new URL(BASE).origin || u.origin === CANON_ORIGIN;
    if (!sameSite) {
      external++;
      continue;
    }
    const text = (a.text || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    links.push({ path: u.pathname + u.search, text, nofollow: /nofollow/i.test(a.getAttribute('rel') || '') });
  }

  const noindex = /noindex/i.test(robots);
  const lang = root.querySelector('html')?.getAttribute('lang') || '';
  const og = { title: meta('meta[property="og:title"]'), image: meta('meta[property="og:image"]'), url: meta('meta[property="og:url"]') };
  const missingAlt = images.filter((i) => i.getAttribute('alt') == null).length;
  const emptyAlt = images.filter((i) => i.getAttribute('alt') === '').length;
  const noDims = images.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length;
  const firstImgLazy = images[0]?.getAttribute('loading') === 'lazy';
  const schema = schemaChecks(p, jsonLdBlocks);

  // Heading order: no skipped levels going down (h2 → h4).
  let skips = 0;
  for (let i = 1; i < headings.length; i++) if (headings[i] - headings[i - 1] > 1) skips++;

  Object.assign(row, {
    indexable: !noindex && (!canonical || toCanonPath(canonical) === p.split('#')[0]) ? 'yes' : 'no',
    robots: robots || '(none = index,follow)',
    canonical: canonical ? toCanonPath(canonical) : '',
    canonical_origin: canonical ? (() => { try { return new URL(canonical).origin; } catch { return 'invalid'; } })() : '',
    title,
    title_len: title.length,
    description,
    description_len: description.length,
    h1_count: h1s.length,
    h1: h1s[0] || '',
    h2_count: headings.filter((h) => h === 2).length,
    heading_skips: skips,
    words,
    images: images.length,
    img_missing_alt: missingAlt,
    img_empty_alt: emptyAlt,
    img_no_dimensions: noDims,
    first_img_lazy: firstImgLazy ? 'yes' : '',
    internal_links: new Set(links.map((l) => l.path)).size,
    external_links: external,
    schema_types: [...new Set(schema.types)].join(' '),
    schema_errors: schema.errors.length,
    og_title: og.title ? 'yes' : 'no',
    og_image: og.image,
    lang,
  });

  // --- page-level issues
  const sev = (base) => (noindex ? 'low' : base);
  if (!title) issue(p, 'high', 'title-missing', 'No <title>', 'Add metadata');
  else if (title.length > 70) issue(p, sev('low'), 'title-long', `${title.length} chars: ${title}`, 'Keep under ~60–65 chars so it is not truncated');
  else if (title.length < 20) issue(p, sev('medium'), 'title-short', title, 'Make the title descriptive');
  if (/undefined|null|\[object|NaN|#\d+ —|Project #\d+/.test(title)) issue(p, 'high', 'title-placeholder', title, 'Template placeholder leaked into title');
  if (/\b[A-Z]{3,}\b[\s.,-]+\b[A-Z]{3,}\b[\s.,-]+\b[A-Z]{3,}\b/.test(title)) issue(p, sev('low'), 'title-all-caps', title, 'Show imported ALL-CAPS names in title case');
  if (!description) issue(p, sev('medium'), 'description-missing', 'No meta description', 'Add a page-specific description');
  else if (description.length > 170) issue(p, 'low', 'description-long', `${description.length} chars`, 'Trim to ~155–160 chars');
  else if (description.length < 70) issue(p, sev('low'), 'description-short', `${description.length} chars: ${description}`, 'Expand with page-specific facts');
  if (/undefined|null|NaN/.test(description)) issue(p, 'high', 'description-placeholder', description, 'Template placeholder leaked');
  if (canonicals.length > 1) issue(p, 'high', 'canonical-multiple', canonicals.join(' '), 'Emit exactly one canonical');
  if (!canonical) issue(p, sev('medium'), 'canonical-missing', 'No canonical tag', 'Set alternates.canonical');
  else {
    const c = new URL(canonical, CANON_ORIGIN);
    if (c.origin !== CANON_ORIGIN) issue(p, 'high', 'canonical-wrong-origin', canonical, `Canonical must use ${CANON_ORIGIN}`);
    if (!noindex && c.pathname + c.search !== p) issue(p, 'medium', 'canonical-other-url', `points to ${c.pathname + c.search}`, 'Confirm this page should be canonicalised elsewhere');
  }
  if (!h1s.length) issue(p, sev('high'), 'h1-missing', 'No <h1>', 'Add one descriptive H1');
  if (h1s.length > 1) issue(p, sev('medium'), 'h1-multiple', h1s.join(' | ').slice(0, 200), 'Keep one primary H1');
  if (skips) issue(p, 'low', 'heading-skip', `${skips} skipped heading level(s)`, 'Use h2 → h3 in order');
  if (missingAlt) issue(p, 'medium', 'img-alt-missing', `${missingAlt} image(s) with no alt`, 'Add accurate alt text (alt="" for decorative)');
  if (noDims) issue(p, 'low', 'img-no-dimensions', `${noDims} image(s) without width/height`, 'Set width/height to avoid layout shift');
  if (firstImgLazy && ['project', 'blog-post'].includes(row.type)) issue(p, 'low', 'lcp-image-lazy', 'First image is loading="lazy"', 'Do not lazy-load the main above-the-fold image');
  if (!noindex && words < 150 && !['map', 'home'].includes(row.type)) issue(p, 'medium', 'thin-content', `${words} words of visible text`, 'Add useful, page-specific content or noindex');
  if (!og.title || !og.image) issue(p, 'low', 'og-missing', `og:title ${og.title ? 'ok' : 'missing'}, og:image ${og.image ? 'ok' : 'missing'}`, 'Use buildMetadata()');
  if (!lang) issue(p, 'low', 'lang-missing', 'No <html lang>', 'Set lang');
  if (res.bytes > 500 * 1024) issue(p, 'medium', 'html-heavy', `${Math.round(res.bytes / 1024)} KB of HTML`, 'Paginate or trim inline data');
  if (res.chain?.length > 1) issue(p, 'low', 'redirect-chain', res.chain.map((c) => `${c.status} ${toCanonPath(c.to)}`).join(' → '), 'Link to the final URL');

  return { row, links, jsonLdBlocks, schema };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dir = await outDir(FOCUS ? `focus-${FOCUS}` : undefined);
  const started = new Date().toISOString();
  console.log(`[seo-audit] crawling ${BASE} → ${path.relative(process.cwd(), dir)}`);

  // robots.txt
  const robotsRes = await get(`${BASE}/robots.txt`);
  const robots = parseRobots(robotsRes.body || '');
  if (robotsRes.status !== 200) issue('/robots.txt', 'critical', 'robots-missing', `HTTP ${robotsRes.status}`, 'Serve robots.txt');
  if (!robots.sitemaps.length) issue('/robots.txt', 'medium', 'robots-no-sitemap', 'No Sitemap: line', 'Add sitemap to robots.ts');
  for (const essential of ['/_next/', '/img/', '/css/', '/legacy/', '/projects', '/blog', '/locations']) {
    if (blocked(essential, robots.disallow)) issue('/robots.txt', 'critical', 'robots-blocks-public', `Disallow covers ${essential}`, 'Never block public pages or rendering assets');
  }

  // sitemap.xml
  const smRes = await get(`${BASE}/sitemap.xml`);
  let sitemap = { result: { url: '/sitemap.xml', urls: 0 }, locs: [] };
  if (smRes.status === 200) sitemap = sitemapChecks(smRes.body, '/sitemap.xml');
  else issue('/sitemap.xml', 'critical', 'sitemap-missing', `HTTP ${smRes.status}`, 'Serve app/sitemap.ts');
  const sitemapPaths = new Set(sitemap.locs.map(toCanonPath));

  // Seed queue
  const statics = await sourceRoutes();
  const queue = [];
  const seen = new Set();
  const enqueue = (p, source) => {
    const clean = p.split('#')[0] || '/';
    if (seen.has(clean) || seen.size >= LIMIT) return;
    if (blocked(clean, robots.disallow)) return;
    if (/^\/(api|_next|rest)\//.test(clean) || /\.(png|jpe?g|webp|svg|gif|pdf|mp4|ico|json|xml|txt|js|css|zip|docx)(\?|$)/i.test(clean)) return;
    seen.add(clean);
    queue.push({ path: clean, source });
  };
  enqueue('/', 'seed');
  for (const s of statics) enqueue(s, 'source');
  for (const l of sitemapPaths) enqueue(l, 'sitemap');

  const pages = new Map();
  const inbound = new Map();
  const linkTargets = new Map(); // path → first linking page
  let cursor = 0;
  const t0 = Date.now();
  while (cursor < queue.length) {
    const batch = queue.slice(cursor, cursor + CONCURRENCY * 10);
    cursor += batch.length;
    await pool(batch, CONCURRENCY, async (item) => {
      const res = await get(BASE + item.path);
      const a = analyze(BASE + item.path, res);
      a.row.discovered_via = item.source;
      a.row.in_sitemap = sitemapPaths.has(item.path) ? 'yes' : 'no';
      pages.set(item.path, { ...a, res: { status: res.status, chain: res.chain } });
      if (res.status === 0) issue(item.path, 'high', 'fetch-error', res.error, 'Check server logs');
      else if (res.status >= 500) issue(item.path, 'critical', 'http-5xx', `HTTP ${res.status}`, 'Fix server error');
      for (const l of a.links) {
        if (l.path === item.path) continue;
        inbound.set(l.path, (inbound.get(l.path) || 0) + 1);
        if (!linkTargets.has(l.path)) linkTargets.set(l.path, item.path);
        // Follow query-string links only for pagination (?page=N on the blog and project
        // listings); map/filter params are app state.
        if (!l.path.includes('?') || /^\/[a-z0-9/-]*\?page=\d+$/.test(l.path)) enqueue(l.path, 'link');
      }
    });
    process.stdout.write(`\r[seo-audit] ${pages.size}/${queue.length} pages  (${Math.round((Date.now() - t0) / 1000)} s)   `);
  }
  process.stdout.write('\n');

  // --- cross-page checks
  const rows = [...pages.values()].map((p) => p.row);
  for (const r of rows) r.inbound_links = inbound.get(r.url) || 0;
  const indexable = rows.filter((r) => r.status === 200 && r.indexable === 'yes');

  const dupes = (key) => {
    const m = new Map();
    for (const r of indexable) if (r[key]) m.set(r[key], [...(m.get(r[key]) || []), r.url]);
    return [...m.entries()].filter(([, urls]) => urls.length > 1);
  };
  const dupTitles = dupes('title');
  const dupDescs = dupes('description');
  for (const [t, urls] of dupTitles) for (const u of urls) issue(u, 'high', 'title-duplicate', `"${t}" shared by ${urls.length} pages: ${urls.filter((x) => x !== u).slice(0, 3).join(' ')}`, 'Make each title unique');
  for (const [, urls] of dupDescs) for (const u of urls) issue(u, 'medium', 'description-duplicate', `shared by ${urls.length} pages: ${urls.filter((x) => x !== u).slice(0, 3).join(' ')}`, 'Make each description unique');
  for (const r of rows) {
    r.duplicate_title = dupTitles.some(([, u]) => u.includes(r.url)) ? 'yes' : '';
    r.duplicate_description = dupDescs.some(([, u]) => u.includes(r.url)) ? 'yes' : '';
  }

  // Sitemap ↔ page state
  for (const sp of sitemapPaths) {
    const pg = pages.get(sp);
    if (!pg) {
      issue(sp, 'info', 'sitemap-not-crawled', 'Over --limit, not fetched', 'Rerun without --limit');
      continue;
    }
    const r = pg.row;
    if (r.status !== 200) issue(sp, 'high', 'sitemap-non-200', `HTTP ${r.status}${r.redirect_to ? ` → ${r.redirect_to}` : ''}`, 'List only final 200 URLs');
    else if (r.indexable !== 'yes') issue(sp, 'high', 'sitemap-not-indexable', `robots "${r.robots}", canonical ${r.canonical}`, 'Drop noindex/canonicalised URLs from the sitemap');
  }
  for (const r of indexable) {
    if (r.in_sitemap === 'no' && !r.url.includes('?')) issue(r.url, 'medium', 'indexable-not-in-sitemap', `discovered via ${r.discovered_via}`, 'Add to sitemap or noindex if low value');
    if (r.inbound_links === 0 && r.url !== '/') issue(r.url, 'medium', 'orphan', 'No internal links point here (in crawled pages)', 'Link from a relevant hub page');
  }

  // Broken / redirected internal links
  for (const [target, from] of linkTargets) {
    const pg = pages.get(target.split('#')[0]);
    if (!pg) continue;
    if (pg.row.status >= 400) issue(target, 'high', 'broken-internal-link', `HTTP ${pg.row.status}, linked from ${from} (+${(inbound.get(target) || 1) - 1} more)`, 'Fix or remove the link');
    else if (pg.row.redirect_hops) issue(target, 'low', 'link-to-redirect', `${pg.row.redirect_hops} hop(s) → ${pg.row.redirect_to}, linked from ${from}`, 'Link straight to the final URL');
  }

  // Blog rows
  const blog = [...pages.values()]
    .filter((p) => p.row.type === 'blog-post' && p.row.status === 200)
    .map((p) => {
      const ld = (p.jsonLdBlocks || []).map((b) => { try { return JSON.parse(b); } catch { return null; } }).flat().find((n) => n && n['@type'] === 'BlogPosting');
      const r = p.row;
      const internalTargets = p.links.map((l) => l.path);
      return {
        url: r.url,
        title: r.title,
        title_len: r.title_len,
        description: r.description,
        description_len: r.description_len,
        h1: r.h1,
        h2_count: r.h2_count,
        words: r.words,
        date_published: ld?.datePublished || '',
        date_modified: ld?.dateModified || '',
        author: ld?.author?.name || '',
        schema_types: r.schema_types,
        schema_errors: r.schema_errors,
        has_breadcrumb_schema: /BreadcrumbList/.test(r.schema_types) ? 'yes' : 'no',
        links_to_projects: new Set(internalTargets.filter((t) => t.startsWith('/projects/'))).size,
        links_to_localities: new Set(internalTargets.filter((t) => t.startsWith('/locations/'))).size,
        links_to_blog: new Set(internalTargets.filter((t) => /^\/blog\/[^?]/.test(t))).size,
        external_links: r.external_links,
        images: r.images,
        img_missing_alt: r.img_missing_alt,
        inbound_links: r.inbound_links,
        in_sitemap: r.in_sitemap,
        indexable: r.indexable,
      };
    });

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code) || a.url.localeCompare(b.url));
  for (const r of rows) {
    const mine = issues.filter((i) => i.url === r.url);
    r.issues = mine.map((i) => i.code).join(' ');
    r.top_severity = mine[0]?.severity || '';
  }

  const bySev = issues.reduce((a, i) => ((a[i.severity] = (a[i.severity] || 0) + 1), a), {});
  const byCode = issues.reduce((a, i) => ((a[i.code] = (a[i.code] || 0) + 1), a), {});
  const byType = rows.reduce((a, r) => ((a[r.type] = (a[r.type] || 0) + 1), a), {});
  const summary = {
    base: BASE,
    started,
    finished: new Date().toISOString(),
    discovered: queue.length,
    fetched: pages.size,
    limit_hit: seen.size >= LIMIT,
    source_static_routes: statics.length,
    sitemap: sitemap.result,
    robots: { status: robotsRes.status, disallow: robots.disallow, sitemaps: robots.sitemaps },
    status_counts: rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
    page_types: byType,
    indexable_200: indexable.length,
    unique_titles: new Set(indexable.map((r) => r.title)).size,
    unique_descriptions: new Set(indexable.map((r) => r.description)).size,
    duplicate_title_groups: dupTitles.length,
    duplicate_description_groups: dupDescs.length,
    missing_title: indexable.filter((r) => !r.title).length,
    missing_description: indexable.filter((r) => !r.description).length,
    missing_canonical: indexable.filter((r) => !r.canonical).length,
    schema_error_pages: rows.filter((r) => r.schema_errors > 0).length,
    blog_posts: blog.length,
    issues_by_severity: bySev,
    issues_by_code: byCode,
  };

  const PAGE_COLS = ['url', 'type', 'status', 'redirect_to', 'redirect_hops', 'indexable', 'robots', 'canonical', 'in_sitemap', 'title', 'title_len', 'duplicate_title', 'description', 'description_len', 'duplicate_description', 'h1_count', 'h1', 'h2_count', 'heading_skips', 'words', 'images', 'img_missing_alt', 'img_no_dimensions', 'internal_links', 'inbound_links', 'external_links', 'schema_types', 'schema_errors', 'og_image', 'html_kb', 'response_ms', 'discovered_via', 'top_severity', 'issues'];
  await writeCsv(path.join(dir, 'PAGE-BY-PAGE-SEO.csv'), rows.sort((a, b) => a.url.localeCompare(b.url)), PAGE_COLS);
  await writeCsv(path.join(dir, 'TECHNICAL-SEO-ISSUES.csv'), issues.map((i) => ({ ...i, status: 'open' })), ['severity', 'code', 'url', 'detail', 'fix', 'status']);
  await writeCsv(path.join(dir, 'BLOG-SEO-REPORT.csv'), blog);
  await writeJson(path.join(dir, 'seo-audit-results.json'), { summary, pages: rows, issues, blog });
  if (!FOCUS && !arg('no-mark')) await markLastRun(dir);

  console.log(`[seo-audit] ${pages.size} pages, ${indexable.length} indexable, ${issues.length} issues`, bySev);
  const show = (codes) => {
    const hits = issues.filter((i) => codes.some((c) => i.code.startsWith(c)));
    console.log(`\n${hits.length} ${FOCUS} issue(s):`);
    for (const i of hits.slice(0, 60)) console.log(`  [${i.severity}] ${i.code} ${i.url} — ${i.detail}`);
  };
  if (FOCUS === 'links') show(['broken-internal-link', 'link-to-redirect', 'orphan', 'redirect-chain']);
  if (FOCUS === 'metadata') show(['title', 'description', 'canonical', 'h1', 'og-']);
  if (FOCUS === 'schema') show(['schema']);
  if (FOCUS === 'sitemap') { console.log(sitemap.result); show(['sitemap', 'robots', 'indexable-not-in-sitemap']); }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
