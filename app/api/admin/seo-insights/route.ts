import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { query } from '@/lib/pg';
import { hasPermission } from '@/lib/staff';
import { countPosts } from '@/lib/blog';
import { getPublicSettings } from '@/lib/site-settings';
import sitemap from '@/app/sitemap';
import { lastWeeks, perWeek } from '@/lib/insights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Data for the "SEO & Health" charts. Everything here is measured from the
// site's own data (no external analytics): how complete each public project
// page is, what's on the map, content growth, enquiries and sitemap coverage.
const WEEKS = 12;

type Pin = Record<string, unknown> & { hasImage?: boolean; hasBrochure?: boolean };
const filled = (v: unknown) => (typeof v === 'string' ? v.trim().length > 0 : v != null && v !== false);

/** "Mundhwa, Pune" → "Mundhwa"; normalises case so "kharadi" and "Kharadi" group. */
function areaOf(location: unknown): string {
  const first = String(location || '').split(/[,|/-]/)[0].trim().replace(/\s+/g, ' ');
  if (!first) return '';
  return first.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET() {
  if (!(await hasPermission('seo'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const db = await getDb();

  // Pins without the heavy base64 images — just whether they have one. Computed
  // in SQL so the image bytes never leave the database.
  const pins = (await query<{ d: Pin }>(
    `SELECT jsonb_build_object(
       'title', doc->'title', 'description', doc->'description', 'developer', doc->'developer',
       'location', doc->'location', 'price', doc->'price', 'status', doc->'status',
       'type', doc->'type', 'key_usp', doc->'key_usp', 'rera_number', doc->'rera_number',
       'custom_fields', doc->'custom_fields', 'possession_timeline', doc->'possession_timeline',
       'launch_date', doc->'launch_date', 'created_at', doc->'created_at', 'hidden', doc->'hidden',
       'hasImage', (coalesce(length(doc->>'image'), 0) > 0),
       'hasBrochure', (coalesce(length(doc->>'brochure_image'), 0) > 0)
     ) AS d FROM "pins"`,
  )).rows.map((r) => r.d);
  const pub = pins.filter((p) => p.hidden !== true);

  // Project-page completeness: share of public projects that have each detail.
  const hasRera = (p: Pin) => filled(p.rera_number) ||
    (Array.isArray(p.custom_fields) && p.custom_fields.some((cf: { label?: string; value?: string }) => /rera/i.test(cf?.label || '') && filled(cf?.value)));
  const checks: [string, (p: Pin) => boolean][] = [
    ['Project name', (p) => filled(p.title)],
    ['Location', (p) => filled(p.location)],
    ['Developer', (p) => filled(p.developer)],
    ['Logo / image', (p) => !!p.hasImage],
    ['Price', (p) => filled(p.price) || p.status === 'sold'],
    ['MahaRERA number', hasRera],
    ['Possession / launch date', (p) => filled(p.possession_timeline) || filled(p.launch_date) || p.status === 'available' || p.status === 'sold'],
    ['Key USP', (p) => filled(p.key_usp)],
    ['Description', (p) => filled(p.description)],
  ];
  const completeness = checks.map(([label, fn]) => ({ label, count: pub.filter(fn).length, total: pub.length }));
  const avgCompleteness = pub.length
    ? Math.round((completeness.reduce((a, c) => a + c.count, 0) / (completeness.length * pub.length)) * 100)
    : 0;

  const STATUS = ['available', 'construction', 'upcoming', 'sold'];
  const byStatus = STATUS.map((key) => ({ key, count: pub.filter((p) => (p.status || 'available') === key).length }));

  const areaCounts = new Map<string, number>();
  for (const p of pub) { const a = areaOf(p.location); if (a) areaCounts.set(a, (areaCounts.get(a) || 0) + 1); }
  const sortedAreas = [...areaCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topAreas = sortedAreas.slice(0, 8).map(([area, count]) => ({ area, count }));
  const otherAreas = sortedAreas.slice(8).reduce((a, [, c]) => a + c, 0);
  const noLocation = pub.filter((p) => !areaOf(p.location)).length;

  const weeks = lastWeeks(WEEKS);
  const [mapLeads, contactLeads] = await Promise.all([
    db.collection('leads').find({}, { projection: { created_at: 1 } }).toArray(),
    db.collection('contact_leads').find({}, { projection: { created_at: 1 } }).toArray(),
  ]);
  const newProjects = perWeek(pins.map((p) => p.created_at), weeks);
  const enquiries = perWeek([...mapLeads, ...contactLeads].map((l) => l.created_at), weeks);

  const [posts, settings, urls] = await Promise.all([countPosts(), getPublicSettings(), sitemap()]);
  const blogUrls = urls.filter((u) => /\/blog\/[^/]+$/.test(u.url)).length;

  const health = [
    { label: 'Database connection', ok: true },
    { label: 'Sitemap.xml & robots.txt', ok: urls.length > 0 },
    { label: 'Search Console verification', ok: !!settings.search_console_verification, fix: 'Add it in Settings' },
    { label: 'Google Tag Manager', ok: !!settings.gtm_container_id, fix: 'Add it in Settings' },
    { label: 'At least 3 published blog posts', ok: posts.published >= 3, fix: `${posts.published} published so far` },
    { label: 'Project pages ≥ 80% complete', ok: avgCompleteness >= 80, fix: `${avgCompleteness}% complete` },
    { label: 'Every public project has a location', ok: noLocation === 0, fix: `${noLocation} without a location` },
  ];

  return NextResponse.json({
    data: {
      score: { passed: health.filter((h) => h.ok).length, total: health.length },
      health,
      projects: { public: pub.length, hidden: pins.length - pub.length },
      completeness, avgCompleteness,
      byStatus,
      areas: { top: topAreas, other: otherAreas, distinct: areaCounts.size },
      newProjects, enquiries,
      sitemap: { total: urls.length, pages: urls.length - blogUrls, blog: blogUrls },
      posts,
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
