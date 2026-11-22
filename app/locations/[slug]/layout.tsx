import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocalityGroups, findGroup, cityOf, CITY_LABELS } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { localityIndexing } from '@/lib/seo/indexing';
import { clip } from '@/lib/seo/project-meta';
import { formatBhk, formatLakhs, summarizeLocality } from '@/lib/seo/locality-summary';

// SEO metadata for /locations/<slug> lives here; page.tsx renders the listing.
// The not-found decision is made here, before the response starts streaming,
// so an unknown locality gets a real 404 status.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const g = await findGroup(getLocalityGroups, params.slug);
  if (!g) notFound();
  const city = g.pins[0] ? CITY_LABELS[cityOf(g.pins[0])] : '';
  const place = `${g.label}${city ? `, ${city}` : ''}`;
  // Only facts the page itself shows (same summary helper as the page).
  const sum = summarizeLocality(g.pins);
  const facts = [
    sum.bhk.length ? `${formatBhk(sum.bhk)} homes` : '',
    sum.minLakhs != null ? `listed prices from ${formatLakhs(sum.minLakhs)}` : '',
  ].filter(Boolean).join(', ');
  return buildMetadata({
    title: `Flats & New Projects in ${place}`,
    description: clip(
      `${g.count} real estate project${g.count === 1 ? '' : 's'} in ${place}${facts ? ` — ${facts}` : ''}. Developers, RERA numbers, possession dates and a live map on Mappingg.`,
      160,
    ),
    path: `/locations/${g.slug}`,
    // Thin localities stay reachable but aren't indexed (lib/seo/indexing.ts).
    noIndex: !localityIndexing(g.slug, g.count).index,
    follow: true,
  });
}

export default function LocationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
