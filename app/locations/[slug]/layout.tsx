import type { Metadata } from 'next';
import { getLocalityGroups, findGroup, cityOf, CITY_LABELS } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /locations/<slug> lives here; page.tsx renders the listing.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const g = await findGroup(getLocalityGroups, params.slug);
  if (!g) return { title: 'Locality not found', robots: { index: false, follow: false } };
  const city = g.pins[0] ? CITY_LABELS[cityOf(g.pins[0])] : '';
  return buildMetadata({
    title: `Real Estate Projects in ${g.label}${city ? `, ${city}` : ''}`,
    description: `Explore ${g.count} real estate project${g.count === 1 ? '' : 's'} in ${g.label}${city ? `, ${city}` : ''} — developers, configurations, pricing, status and an interactive map of the area on Mappingg.`,
    path: `/locations/${g.slug}`,
    keywords: [`real estate ${g.label}`, `property in ${g.label}`, `projects in ${g.label}`],
  });
}

export default function LocationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
