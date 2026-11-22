import { SITE_URL, SITE } from '@/lib/seo/config';
import { EMAIL, SOCIALS, WHATSAPP_DISPLAY } from '@/lib/contact';
import {
  getPublicPins,
  getLocalityGroups,
  getDeveloperGroups,
  getStatusGroups,
  cityOf,
  CITY_LABELS,
  type CityKey,
} from '@/lib/seo/entities';
import { developerIndexing, localityIndexing } from '@/lib/seo/indexing';
import { listPublished } from '@/lib/blog';

// /llms.txt — a plain-text brief for AI assistants (https://llmstxt.org).
// Generated from the live project data (it used to be a hand-written file that
// still said "184 projects, Pune & MMR" long after coverage had grown), and
// regenerated at most once an hour like the sitemap. Every number is a count of
// what is actually on the public site.
export const revalidate = 3600;
export const dynamic = 'force-static';

export async function GET() {
  const [pins, locs, devs, statuses, posts] = await Promise.all([
    getPublicPins(),
    getLocalityGroups(),
    getDeveloperGroups(),
    getStatusGroups(),
    listPublished({ strict: true }).catch(() => []),
  ]);

  const byCity = new Map<CityKey, number>();
  for (const p of pins) byCity.set(cityOf(p), (byCity.get(cityOf(p)) || 0) + 1);
  const cities = [...byCity.entries()].sort((a, b) => b[1] - a[1]);
  const hubs = locs.filter((g) => localityIndexing(g.slug, g.count).index);
  const topLocs = (city: CityKey) =>
    hubs.filter((g) => g.pins[0] && cityOf(g.pins[0]) === city).slice(0, 10).map((g) => `${g.label} (${g.count})`);
  const devHubs = devs.filter((g) => developerIndexing(g.count).index);
  const asOf = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.name} (${SITE_URL.replace(/^https?:\/\//, '')}) is a live, interactive map of real estate projects in India, built and maintained by ${SITE.legalName}, Pune. Every project is pinned at its location and colour-coded by status, with a public page per project listing the facts we hold: developer, configuration, carpet area, price, possession and RERA registration where published.`,
    '',
    '## Key facts',
    '',
    `- As of ${asOf}: ${pins.length} property projects on the public site, in ${cities.map(([c, n]) => `${CITY_LABELS[c]} ${n}`).join(', ')}.`,
    `- By status: ${statuses.map((s) => `${s.label} ${s.count}`).join(', ')}.`,
    `- ${pins.filter((p) => (p.rera_number || '').trim()).length} projects list a RERA registration number.`,
    ...cities.slice(0, 4).map(([c]) => {
      const top = topLocs(c);
      return top.length ? `- Main localities in ${CITY_LABELS[c]}: ${top.join(', ')}` : '';
    }).filter(Boolean),
    '- Each project page shows only the details we have on record; missing details (for example a price the developer has not published) are left out, never estimated.',
    '- Browsing the project pages is free. On the live map, guests can open a few project cards; a free account opens every project.',
    '- Audience: home buyers and investors, channel partners, developers.',
    '',
    '## Main pages',
    '',
    `- [Live map](${SITE_URL}/map): every project on one interactive map, with infrastructure (metro, roads, schools, hospitals)`,
    `- [All projects](${SITE_URL}/projects): the full list, ${pins.length} projects`,
    `- [Localities](${SITE_URL}/locations): ${hubs.length} locality pages with their projects, price ranges and configurations`,
    `- [Developers](${SITE_URL}/developers): ${devHubs.length} developer pages`,
    ...statuses.map((s) => `- [${s.label} projects](${SITE_URL}/status/${s.slug}): ${s.count} projects`),
    `- [Blog](${SITE_URL}/blog): ${posts.length} buyer guides (locality comparisons, prices, RERA, taxes, documents)`,
    `- [How we source project data](${SITE_URL}/data-sources)`,
    `- [Sitemap](${SITE_URL}/sitemap.xml)`,
    '',
    '## Contact',
    '',
    `- Email: ${EMAIL}`,
    `- WhatsApp: ${WHATSAPP_DISPLAY}`,
    ...SOCIALS.map((s) => `- [${s.name}](${s.href})`),
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
