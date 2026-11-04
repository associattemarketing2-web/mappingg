// READ-ONLY. Builds seo-doc/keyword-research.csv: one target keyword per indexable
// landing page, with the inventory Mappingg actually has for it.
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs scripts/seo-audit/keyword-sheet.mts [--gsc=<queries.csv>]
//
// Search volume, competition, CPC and ranking columns are left EMPTY unless a real
// source fills them: pass --gsc=<file> with a Search Console "Queries" export
// (columns: Top queries, Clicks, Impressions, CTR, Position) to merge clicks,
// impressions, CTR and position for exact-match queries. Nothing is estimated.
//
// "priority" is NOT a search-demand score: it ranks pages by commercial intent and
// by how many real projects back the page (see seo-doc/KEYWORD-RESEARCH.md).

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { cityFrom, hasCityHub, CITY_SHORT, type CityKey } from '../../lib/seo/city.ts';
import { nonProjectReason } from '../../lib/seo/project-filter.ts';
import { localitiesOf } from '../../lib/locality.ts';
import { slugify } from '../../lib/seo/slug.ts';
import { applyFieldVisibility } from '../../lib/seo/project-meta.ts';
import { availableFacets, MIN_FACET_PROJECTS, type Facet } from '../../lib/seo/facets.ts';
import { localityIndexing } from '../../lib/seo/indexing.ts';

const pg = createRequire(import.meta.url)('pg');
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

const raw = process.env.DATABASE_URL || readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!.slice(13).replace(/^"|"$/g, '');
const u = new URL(raw);
const ssl = u.searchParams.get('sslmode') !== 'disable';
u.searchParams.delete('sslmode');
const c = new pg.Client({ connectionString: u.toString(), ssl });
await c.connect();
await c.query('BEGIN READ ONLY');
const rows = (await c.query(`select doc - 'image' - 'brochure_image' - 'images' as d from pins where coalesce(doc->>'hidden','false') <> 'true'`)).rows.map((r: any) => r.d);
const posts = (await c.query(`select doc->>'slug' s, doc->>'title' t, doc->>'status' st from posts`)).rows.filter((r: any) => r.st === 'published');
await c.query('ROLLBACK');
await c.end();

const pins = rows.filter((p: any) => !nonProjectReason(p)).map((p: any) => applyFieldVisibility(p));

// Optional Search Console export.
const gsc = new Map<string, { clicks: string; impressions: string; ctr: string; position: string }>();
const gscFile = arg('gsc');
if (gscFile) {
  const lines = readFileSync(gscFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(1)) {
    const cols = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    const [q, clicks, impressions, ctr, position] = cols;
    if (q) gsc.set(q.trim().toLowerCase(), { clicks, impressions, ctr, position });
  }
}

type Row = Record<string, string | number>;
const out: Row[] = [];
const SITE = 'https://www.mappingg.com';
const query = (f: Facet) => f.label.replace('₹', '').replace('4+ BHK', '4 BHK').toLowerCase();

function add(r: { keyword: string; cluster: string; intent: string; city: string; url: string; projects: number | ''; secondary: string; competitors?: string; action: string; priority: string }) {
  const g = gsc.get(r.keyword.toLowerCase());
  out.push({
    keyword: r.keyword,
    cluster: r.cluster,
    intent: r.intent,
    country: 'IN',
    target_city: r.city,
    monthly_search_volume: '',
    competition: '',
    keyword_difficulty: '',
    cpc_inr: '',
    gsc_clicks: g?.clicks ?? '',
    gsc_impressions: g?.impressions ?? '',
    gsc_ctr: g?.ctr ?? '',
    gsc_position: g?.position ?? '',
    target_url: `${SITE}${r.url}`,
    secondary_keywords: r.secondary,
    mappingg_projects_on_page: r.projects,
    competitor_urls_seen: r.competitors || '',
    priority: r.priority,
    recommended_action: r.action,
    data_source: g ? 'Search Console export + Mappingg DB' : 'Mappingg DB (no search-volume source connected)',
  });
}

// Competitor URLs observed in live searches on 4 Nov 2026 (COMPETITOR-ANALYSIS.md).
const SEEN: Record<string, string> = {
  'new residential projects in kharadi': 'squareyards.com/projects-in-kharadi-pune; housiey.com/in/pune/kharadi; homebazaar.com/under-construction-projects-in-kharadi-pune; ghar.tv',
  'flats in kharadi': 'squareyards.com/projects-in-kharadi-pune; housiey.com/in/pune/kharadi',
  '2 bhk flats in wakad': 'housing.com; propertypistol.com/pune/buy/2bhk-flats-for-sale-in-wakad; ghar.tv; jllhomes.co.in',
  'flats under 1 crore in pune': 'homebazaar.com/buy/flats-under-1-crore-in-pune; squareyards.com/ready-to-move-projects-under-1-crore-in-pune; addressofchoice.com',
  '3 bhk flats in mundhwa': 'squareyards.com/projects-in-mundhwa-pune; housing.com; propertypistol.com; housiey.com',
  'stamp duty and registration charges in pune': 'bajajfinserv.in; sobha.com; godrejproperties.com; paisabazaar.com; houssed.com',
  'how to check maharera registration': 'housing.com/news; housiey.com/blogs; piramalrealty.com; lntrealty.com',
  'kharadi vs mundhwa': 'punerealityhub.pages.dev; puravankara.com',
};

// 1. City hubs and city facet pages.
const byCity = new Map<CityKey, any[]>();
for (const p of pins) {
  const k = cityFrom(p.location, p.lat, p.lng);
  if (hasCityHub(k)) byCity.set(k, [...(byCity.get(k) || []), p]);
}
for (const [city, list] of byCity) {
  const name = CITY_SHORT[city];
  add({ keyword: `new projects in ${name.toLowerCase()}`, cluster: 'A. Transactional', intent: 'transactional', city: name, url: `/cities/${city}`, projects: list.length, secondary: `flats for sale in ${name.toLowerCase()}; new residential projects in ${name.toLowerCase()}; real estate projects in ${name.toLowerCase()}`, action: 'Keep; add written city overview', priority: 'P1' });
  for (const { facet, pins: fp } of availableFacets(list)) {
    const q = `${query(facet)} in ${name.toLowerCase()}`;
    add({
      keyword: q,
      cluster: facet.kind === 'bhk' ? 'C. BHK' : 'D. Budget',
      intent: 'transactional',
      city: name,
      url: `/cities/${city}/${facet.slug}`,
      projects: fp.length,
      secondary: `new ${q}; ${query(facet)} for sale in ${name.toLowerCase()}`,
      competitors: SEEN[q],
      action: 'New page (4 Nov). Monitor in GSC; pair with blog guide where one exists',
      priority: fp.length >= 40 ? 'P1' : 'P2',
    });
  }
}

// 2. Locality hubs and locality facet pages.
const byLoc = new Map<string, { name: string; city: CityKey; pins: any[] }>();
for (const p of pins) {
  for (const l of localitiesOf(p.location)) {
    const s = slugify(l);
    if (!s) continue;
    const g = byLoc.get(s) || { name: l, city: cityFrom(p.location, p.lat, p.lng), pins: [] };
    g.pins.push(p);
    byLoc.set(s, g);
  }
}
for (const [slug, g] of [...byLoc].sort((a, b) => b[1].pins.length - a[1].pins.length)) {
  if (!localityIndexing(slug, g.pins.length).index) continue;
  const name = g.name;
  const lower = name.toLowerCase();
  add({ keyword: `flats in ${lower}`, cluster: 'B. Location', intent: 'transactional / local', city: CITY_SHORT[g.city], url: `/locations/${slug}`, projects: g.pins.length, secondary: `new projects in ${lower}; property in ${lower}; residential projects in ${lower}`, competitors: SEEN[`flats in ${lower}`] || SEEN[`new residential projects in ${lower}`], action: g.pins.length >= 10 ? 'Keep; add a written area guide if missing' : 'Keep; thin inventory — do not expand until more projects', priority: g.pins.length >= 10 ? 'P1' : 'P3' });
  if (g.pins.length < MIN_FACET_PROJECTS) continue;
  for (const { facet, pins: fp } of availableFacets(g.pins)) {
    const q = `${query(facet)} in ${lower}`;
    add({ keyword: q, cluster: 'E. Long-tail (locality × BHK/budget)', intent: 'transactional', city: CITY_SHORT[g.city], url: `/locations/${slug}/${facet.slug}`, projects: fp.length, secondary: `new ${q}`, competitors: SEEN[q], action: 'New page (4 Nov). Monitor in GSC', priority: 'P2' });
  }
}

// 3. Informational and comparison queries → existing guides (or a gap).
const blog = (slug: string) => posts.find((p: any) => p.s === slug) ? `/blog/${slug}` : '';
const INFO: [string, string, string, string][] = [
  ['how to check maharera registration', 'how-to-check-maharera-registration-number', 'maharera registration number check; rera registered projects in pune', 'Pune'],
  ['stamp duty and registration charges in pune', 'stamp-duty-registration-charges-pune', 'stamp duty in maharashtra; property registration charges maharashtra', 'Pune'],
  ['carpet area vs built up area', 'carpet-area-vs-built-up-vs-super-built-up-area', 'super built up area meaning; rera carpet area', ''],
  ['ready to move vs under construction flats', 'ready-to-move-vs-under-construction-flats-pune', 'gst on under construction flat', 'Pune'],
  ['documents to check before buying a flat', 'documents-to-check-before-buying-flat-pune', 'home buying checklist; property documents checklist', 'Pune'],
  ['site visit checklist before buying flat', 'site-visit-checklist-before-buying-flat-pune', 'what to check before buying a flat', 'Pune'],
  ['best areas to buy property in pune', 'best-areas-to-buy-property-in-pune', 'best areas for families in pune; best areas for it professionals in pune', 'Pune'],
  ['flat prices in pune', 'flat-prices-in-pune-by-locality-and-bhk', 'pune property price trends; property rates in pune', 'Pune'],
  ['gst on flats', 'gst-on-flats-under-construction-ready-to-move', 'gst on under construction property', ''],
  ['home loan emi eligibility', 'home-loan-emi-eligibility-pune', 'home loan eligibility calculator', ''],
  ['occupancy certificate vs completion certificate', 'occupancy-certificate-oc-completion-certificate-pune', 'what is oc in property', 'Pune'],
  ['possession delay rera complaint', 'possession-delay-rera-buyer-rights-maharera-complaint', 'maharera complaint for delay', 'Pune'],
  ['agreement for sale clauses', 'agreement-for-sale-clauses-to-check-maharera', 'maharera model agreement for sale', 'Pune'],
  ['capital gains tax on sale of flat', 'capital-gains-tax-on-sale-of-flat-india', 'ltcg on property', ''],
  ['nri buying property in india', 'nri-guide-buying-property-in-india-pune', 'nri property purchase rules', 'Pune'],
];
for (const [kw, slug, sec, city] of INFO) {
  const url = blog(slug);
  add({ keyword: kw, cluster: 'F. Informational', intent: 'informational', city, url: url || '(no page yet)', projects: '', secondary: sec, competitors: SEEN[kw], action: url ? 'Keep; refresh yearly with official sources' : 'Write guide', priority: 'P2' });
}
const COMPARE: [string, string][] = [
  ['kharadi vs mundhwa', 'Pune'], ['wakad vs hinjewadi', 'Pune'], ['baner vs balewadi', 'Pune'],
  ['east pune vs west pune', 'Pune'], ['thane vs navi mumbai', 'Mumbai'], ['whitefield vs sarjapur road', 'Bengaluru'],
];
for (const [kw, city] of COMPARE) {
  add({ keyword: kw, cluster: 'G. Comparison', intent: 'commercial investigation', city, url: '(no page yet)', projects: '', secondary: `${kw} for buying flat; ${kw} which is better`, competitors: SEEN[kw], action: 'Content gap: write a data-led comparison from live inventory (CONTENT-ROADMAP.md)', priority: 'P2' });
}
add({ keyword: 'mappingg', cluster: 'H. Branded', intent: 'navigational', city: '', url: '/', projects: pins.length, secondary: 'mappingg map; mappingg pune; mappingg.com', competitors: '', action: 'Check brand query in GSC once connected; site did not appear for "mappingg.com" in a 4 Nov web search', priority: 'P1' });

const cols = Object.keys(out[0]);
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync('seo-doc/keyword-research.csv', '﻿' + [cols.join(','), ...out.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n') + '\n');
console.log(`wrote ${out.length} rows to seo-doc/keyword-research.csv`);
const by = new Map<string, number>(); for (const r of out) by.set(String(r.cluster), (by.get(String(r.cluster)) || 0) + 1);
console.log(Object.fromEntries(by));
