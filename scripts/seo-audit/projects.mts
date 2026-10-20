// Project-by-project and blog-by-blog SEO report from the database (READ-ONLY).
//
//   npm run seo:projects            (writes next to the latest crawl, or --out=<dir>)
//
// Opens one Postgres session with default_transaction_read_only = on, reads the
// public pins and blog posts, and runs them through the same helpers the pages
// use (lib/seo/*), so the report shows exactly the title/URL/indexing the site
// renders. Writes:
//   PROJECT-SEO-REPORT.csv     one row per public pin: URL, verified fields, keywords, gaps
//   KEYWORD-URL-MAPPING.csv    one target query per indexable URL (+ cannibalisation flags)
//   BLOG-CONTENT-REPORT.csv    one row per published post from the stored article
//   projects-summary.json      totals for the summary step
// No search volumes or rankings are invented: Search Console is not connected,
// so every keyword is marked "site data (no search data)".

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { localitiesOf } from '../../lib/locality.ts';
import { slugify, projectSlug } from '../../lib/seo/slug.ts';
import { cityFrom, CITY_LABELS, hasCityHub } from '../../lib/seo/city.ts';
import { nonProjectReason } from '../../lib/seo/project-filter.ts';
import { projectIndexing, localityIndexing, developerIndexing } from '../../lib/seo/indexing.ts';
import { displayDeveloperName, displayPlaceName } from '../../lib/seo/developer-name.ts';
import {
  applyFieldVisibility, displayProjectName, projectTitle, projectDescription, projectFaqs,
  realPrice, reraNumber, bhkLabel,
} from '../../lib/seo/project-meta.ts';
import { arg, latestDir, outDir, writeCsv, writeJson } from './common.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');

const SITE = 'https://www.mappingg.com';
const NO_DATA = 'site data (no search data — Search Console not connected)';

function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!env) throw new Error('DATABASE_URL is not set');
  return env.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

async function readOnly<T>(fn: (q: (sql: string) => Promise<any[]>) => Promise<T>): Promise<T> {
  const u = new URL(dbUrl());
  const ssl = u.searchParams.get('sslmode') === 'disable' ? false : true;
  u.searchParams.delete('sslmode');
  const client = new pg.Client({ connectionString: u.toString(), ssl });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    await client.query('BEGIN READ ONLY');
    const out = await fn(async (sql) => (await client.query(sql)).rows);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}

const filled = (v: unknown) => v != null && String(v).trim() !== '';
const isAllCaps = (s?: string) => !!s && s === s.toUpperCase() && /[A-Z]{4}/.test(s);

async function main() {
  const dir = arg('out') ? await outDir() : (await latestDir()) || (await outDir());
  const { pins, posts } = await readOnly(async (q) => ({
    pins: (await q(`select doc - 'image' - 'brochure_image' - 'images' as d,
                           (doc ? 'image' and coalesce(doc->>'image','') <> '') or coalesce(doc->>'image_url','') <> '' as has_image
                    from pins where coalesce(doc->>'hidden','false') <> 'true'`)).map((r) => ({ ...r.d, _has_image: r.has_image })),
    posts: (await q(`select doc from posts`)).map((r) => r.doc),
  }));

  // Live crawl results from the same folder, if present.
  const crawlFile = path.join(dir, 'seo-audit-results.json');
  const crawl = existsSync(crawlFile) ? JSON.parse(readFileSync(crawlFile, 'utf8')) : null;
  const live = new Map<string, any>((crawl?.pages || []).map((p: any) => [p.url, p]));

  // ---- projects
  type Row = Record<string, string | number>;
  const rows: Row[] = [];
  const keywordRows: Row[] = [];
  const titleCount = new Map<string, number>();
  const projects = pins
    .map((raw: any) => {
      const reason = nonProjectReason(raw);
      const p = applyFieldVisibility(raw);
      const loc = displayPlaceName(localitiesOf(p.location)[0] || '');
      const cityKey = cityFrom(p.location, p.lat, p.lng);
      return { raw, p, reason, loc, cityKey, city: CITY_LABELS[cityKey] };
    });
  for (const x of projects) if (!x.reason) {
    const k = `${slugify(x.p.title)}|${slugify(x.loc)}`;
    titleCount.set(k, (titleCount.get(k) || 0) + 1);
  }

  for (const { raw, p, reason, loc, cityKey, city } of projects) {
    const slug = projectSlug(p.title, loc, Number(p.number));
    const url = `/projects/${slug}`;
    const name = displayProjectName(p.title);
    const idx = reason ? { index: false, reason: `not a project: ${reason}` } : projectIndexing(p);
    const title = reason ? '' : projectTitle(p, loc, city);
    const description = reason ? '' : projectDescription(p, loc, city);
    const price = realPrice(p.price);
    const rera = reraNumber(p.rera_number);
    const bhk = bhkLabel(p.configuration);
    const dev = filled(p.developer) ? displayDeveloperName(p.developer) : '';
    const dupKey = `${slugify(p.title)}|${slugify(loc)}`;
    const nameLower = (name || '').toLowerCase();
    const genericName = !name || name.split(/\s+/).length < 2 || (dev && slugify(name) === slugify(dev)) || /new project|project \d|^plot|^land/i.test(name);
    const slugStable = slugify(p.title) === slugify(name);

    const gaps = [
      !loc && 'locality not recognised',
      !dev && 'developer',
      !filled(p.type) && 'property type',
      !filled(p.configuration) && 'configuration',
      !price && 'price',
      !filled(p.sqft) && 'carpet area',
      !filled(p.possession_timeline) && 'possession',
      !rera && 'RERA number',
      !raw._has_image && 'photo',
      !filled(p.description) && !filled(p.key_usp) && 'description',
    ].filter(Boolean) as string[];

    const secondary = [
      loc && `${nameLower} ${loc.toLowerCase()}`,
      city && `${nameLower} ${city.split(' ')[0].toLowerCase()}`,
      price && `${nameLower} price`,
      bhk && `${nameLower} ${bhk.replace(/ and /g, ' ').replace(/,/g, '').toLowerCase()}`,
      rera && `${nameLower} rera number`,
      filled(p.possession_timeline) && `${nameLower} possession date`,
      dev && `${nameLower} ${dev.toLowerCase().split(' ')[0]}`,
      loc && `${nameLower} location`,
    ].filter(Boolean) as string[];
    const notTargeted = [
      !price && 'price (no published price)',
      'price per sq ft (no reliable per-sq-ft data)',
      'floor plan (no floor-plan data stored)',
      'amenities (no amenity data stored)',
      'reviews (no genuine review data)',
      !rera && 'RERA number (not on record)',
    ].filter(Boolean) as string[];

    const crawled = live.get(url);
    const issues = [
      reason && 'not a property project (no page; 404)',
      !reason && !idx.index && 'noindex: empty placeholder',
      !reason && (titleCount.get(dupKey) || 0) > 1 && 'same name+locality as another pin (possible duplicate record)',
      !reason && genericName && 'generic / ambiguous name',
      !reason && isAllCaps(p.title) && 'name stored in ALL CAPS (title-cased for display)',
      !reason && !slugStable && 'display name changes the slug (check)',
      !reason && cityKey === 'pune' && !hasCityHub(cityKey) && 'city unknown',
      !reason && !loc && filled(p.location) && `location text not matched to a known locality: "${String(p.location).slice(0, 60)}"`,
    ].filter(Boolean) as string[];

    rows.push({
      pin_number: Number(p.number),
      url: reason ? '' : url,
      name,
      developer: dev,
      locality: loc,
      city,
      property_type: p.type || '',
      status: p.status || '',
      configuration: p.configuration || '',
      price,
      carpet_area: filled(p.sqft) ? String(p.sqft) : '',
      possession: p.possession_timeline || '',
      rera_number: rera,
      has_photo: raw._has_image ? 'yes' : 'no',
      has_description: filled(p.description) || filled(p.key_usp) ? 'yes' : 'no',
      has_video: filled(p.youtube_video_url) ? 'yes' : 'no',
      hidden_fields: Object.entries(raw.field_visibility || {}).filter(([, v]) => v === false).map(([k]) => k).join(' '),
      source: raw.source || 'manual',
      indexable: idx.index ? 'yes' : 'no',
      index_reason: idx.reason,
      seo_title: title,
      seo_title_len: title ? title.length + ' — Mappingg'.length : 0,
      meta_description: description,
      meta_description_len: description.length,
      faq_count: reason ? 0 : projectFaqs(p, loc, city).length,
      primary_keyword: reason ? '' : nameLower,
      secondary_keywords: secondary.join(' | '),
      not_targeted: notTargeted.join(' | '),
      search_data: NO_DATA,
      data_gaps: gaps.join(' | '),
      data_gap_count: gaps.length,
      issues: issues.join(' | '),
      live_status: crawled ? crawled.status : 'not crawled',
      live_title: crawled ? crawled.title : '',
      action_status: reason ? 'excluded (not a project)' : gaps.length ? 'metadata generated from verified fields; data gaps need team input' : 'metadata generated from verified fields',
      updated_at: p.updated_at || '',
    });

    if (!reason && idx.index) {
      keywordRows.push({
        keyword: nameLower,
        target_url: url,
        page_type: 'project',
        intent: 'navigational / commercial',
        evidence_source: NO_DATA,
        reason: 'exact project name',
        existing_coverage: 'title, H1, description, schema',
        content_gap: gaps.slice(0, 4).join(', '),
        cannibalization_risk: (titleCount.get(dupKey) || 0) > 1 ? 'high: another pin has the same name and locality' : genericName ? 'medium: generic name shared with other pages' : 'low',
        priority: gaps.length <= 3 ? 'high' : 'medium',
        status: 'implemented',
      });
    }
  }

  // ---- hubs (locality / developer / city) from the same project rows
  const projRows = rows.filter((r) => r.url);
  const groups = (key: 'locality' | 'developer') => {
    const m = new Map<string, Row[]>();
    for (const r of projRows) {
      const values = key === 'locality' ? localitiesOf(pins.find((x: any) => Number(x.number) === r.pin_number)?.location).map(displayPlaceName) : [String(r.developer)];
      for (const v of values) if (v) m.set(v, [...(m.get(v) || []), r]);
    }
    return m;
  };
  const locGroups = groups('locality');
  const devGroups = groups('developer');
  const blogSlugs = posts.filter((p: any) => p.status === 'published').map((p: any) => String(p.slug));
  for (const [loc, rs] of locGroups) {
    const s = slugify(loc);
    const ok = localityIndexing(s, rs.length).index;
    const blog = blogSlugs.filter((b: string) => `-${b}-`.includes(`-${s}-`));
    keywordRows.push({
      keyword: `new projects in ${loc.toLowerCase()}`,
      target_url: `/locations/${s}`,
      page_type: 'locality',
      intent: 'commercial',
      evidence_source: NO_DATA,
      reason: `${rs.length} mapped project(s) in ${loc}`,
      existing_coverage: ok ? 'indexable locality page' : 'page is noindex (thin)',
      content_gap: ok ? '' : 'fewer than 3 projects and no area guide',
      cannibalization_risk: blog.length ? `medium: blog /blog/${blog[0]} targets the same area — keep the blog as the guide, this page as the live list, and cross-link` : 'low',
      priority: rs.length >= 10 ? 'high' : 'medium',
      status: ok ? 'implemented' : 'not targeted (noindex)',
    });
  }
  for (const [dev, rs] of devGroups) {
    const ok = developerIndexing(rs.length).index;
    keywordRows.push({
      keyword: `${dev.toLowerCase()} projects`,
      target_url: `/developers/${slugify(dev)}`,
      page_type: 'developer',
      intent: 'navigational / commercial',
      evidence_source: NO_DATA,
      reason: `${rs.length} mapped project(s)`,
      existing_coverage: ok ? 'indexable developer page' : 'page is noindex (thin)',
      content_gap: ok ? '' : 'fewer than 3 projects',
      cannibalization_risk: 'low',
      priority: rs.length >= 5 ? 'medium' : 'low',
      status: ok ? 'implemented' : 'not targeted (noindex)',
    });
  }
  const statics: [string, string, string, string][] = [
    ['mappingg', '/', 'navigational', 'brand'],
    ['real estate project map pune', '/map', 'commercial', 'core product: live project map'],
    ['new projects in pune', '/cities/pune', 'commercial', 'city hub'],
    ['new projects in mumbai', '/cities/mumbai', 'commercial', 'city hub'],
    ['under construction projects', '/status/under-construction', 'commercial', 'status hub'],
    ['ready to move flats', '/status/ready-to-move', 'commercial', 'status hub'],
    ['upcoming projects', '/status/upcoming', 'commercial', 'status hub'],
    ['real estate project api india', '/developer-api', 'informational', 'developer API docs'],
    ['mundhwa 3d map', '/mundhwa-map-3d', 'navigational', '3D map feature'],
  ];
  for (const [kw, url, intent, reason] of statics) {
    keywordRows.push({ keyword: kw, target_url: url, page_type: 'hub', intent, evidence_source: NO_DATA, reason, existing_coverage: 'title + H1', content_gap: '', cannibalization_risk: kw.includes('pune') && url === '/cities/pune' ? 'medium: /blog/upcoming-new-launch-projects-in-pune and /blog/best-areas-to-buy-property-in-pune overlap — blogs answer "which/why", hub lists projects' : 'low', priority: 'high', status: 'implemented' });
  }

  // ---- blog posts (stored article)
  const blogRows: Row[] = [];
  const thisYear = new Date().getFullYear();
  for (const post of posts) {
    const html: string = post.content || '';
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const words = text.split(' ').filter((w) => /\w/.test(w)).length;
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const years = [...new Set((text.match(/\b20(1\d|2\d)\b/g) || []).map(Number))];
    const staleYears = years.filter((y) => y < thisYear - 1);
    const kw = (post.seo_title || post.title || '').replace(/\s*[—|-]\s*Mappingg.*$/i, '').replace(/\s*[(:|—].*$/, '').trim().toLowerCase();
    const sameIntent = posts.filter((o: any) => o !== post && o.status === 'published' && kw && (o.seo_title || o.title || '').toLowerCase().includes(kw.split(' ').slice(0, 4).join(' ')));
    const h2 = (html.match(/<h2[\s>]/g) || []).length;
    blogRows.push({
      url: `/blog/${post.slug}`,
      status: post.status,
      title: post.title,
      seo_title: post.seo_title || '',
      seo_description_len: (post.seo_description || post.excerpt || '').length,
      primary_keyword: kw,
      intent: /new projects|flats|luxury|commercial|upcoming/i.test(post.title) ? 'commercial investigation' : 'informational',
      words,
      h2_sections: h2,
      has_h1_in_body: /<h1[\s>]/.test(html) ? 'yes (duplicates the page H1)' : 'no',
      internal_links: links.filter((l) => l.startsWith('/') || l.startsWith(SITE)).length,
      links_to_projects: links.filter((l) => l.includes('/projects/')).length,
      links_to_localities: links.filter((l) => l.includes('/locations/')).length,
      external_links: links.filter((l) => /^https?:/.test(l) && !l.startsWith(SITE)).length,
      has_faq_section: /faq|frequently asked/i.test(html) ? 'yes' : 'no',
      mentions_maharera: /maharera/i.test(text) ? 'yes' : 'no',
      year_mentions: years.join(' '),
      possibly_stale: staleYears.length ? `mentions ${staleYears.join(', ')}` : '',
      tags: (post.tags || []).join(' | '),
      author: post.author || '',
      published_at: post.published_at || '',
      updated_at: post.updated_at || '',
      cover_image: post.cover_image ? (String(post.cover_image).startsWith('data:') ? 'inline base64 (heavy)' : post.cover_image) : 'none',
      overlap_with: sameIntent.map((o: any) => `/blog/${o.slug}`).join(' '),
    });
    if (post.status === 'published') {
      keywordRows.push({
        keyword: kw,
        target_url: `/blog/${post.slug}`,
        page_type: 'blog',
        intent: /new projects|flats|luxury|commercial|upcoming/i.test(post.title) ? 'commercial investigation' : 'informational',
        evidence_source: NO_DATA,
        reason: 'article topic',
        existing_coverage: 'title, H1, article',
        content_gap: '',
        cannibalization_risk: sameIntent.length ? `medium: overlaps ${sameIntent.map((o: any) => o.slug).join(', ')}` : 'low',
        priority: 'medium',
        status: 'implemented',
      });
    }
  }

  // ---- write
  rows.sort((a, b) => Number(a.pin_number) - Number(b.pin_number));
  await writeCsv(path.join(dir, 'PROJECT-SEO-REPORT.csv'), rows);
  await writeCsv(path.join(dir, 'KEYWORD-URL-MAPPING.csv'), keywordRows);
  await writeCsv(path.join(dir, 'BLOG-CONTENT-REPORT.csv'), blogRows);

  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const proj = rows.filter((r) => r.url);
  const byCity = proj.reduce((a: Record<string, number>, r) => ((a[String(r.city)] = (a[String(r.city)] || 0) + 1), a), {});
  const summary = {
    public_pins: rows.length,
    property_projects: proj.length,
    not_projects: rows.length - proj.length,
    indexable_projects: count((r) => r.indexable === 'yes'),
    noindex_placeholders: count((r) => !!r.url && r.indexable === 'no'),
    by_city: byCity,
    missing: Object.fromEntries(['price', 'configuration', 'RERA number', 'photo', 'possession', 'carpet area', 'developer', 'description', 'locality not recognised'].map((g) => [g, proj.filter((r) => String(r.data_gaps).split(' | ').includes(g)).length])),
    with_rera: count((r) => !!r.url && !!r.rera_number),
    all_caps_names: count((r) => String(r.issues).includes('ALL CAPS')),
    duplicate_name_locality: count((r) => String(r.issues).includes('possible duplicate')),
    generic_names: count((r) => String(r.issues).includes('generic')),
    slug_changes: count((r) => String(r.issues).includes('changes the slug')),
    hidden_field_pins: count((r) => !!r.hidden_fields),
    title_over_72: count((r) => Number(r.seo_title_len) > 72),
    unique_titles: new Set(proj.map((r) => r.seo_title)).size,
    unique_descriptions: new Set(proj.map((r) => r.meta_description)).size,
    localities: locGroups.size,
    developers: devGroups.size,
    blog_posts: posts.length,
    published_posts: blogSlugs.length,
    keyword_rows: keywordRows.length,
  };
  await writeJson(path.join(dir, 'projects-summary.json'), summary);
  console.log(`[seo-projects] → ${path.relative(process.cwd(), dir)}`);
  console.log(JSON.stringify(summary, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
