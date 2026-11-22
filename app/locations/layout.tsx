import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import { getPublicPins, getLocalityGroups, citiesPhrase } from '@/lib/seo/entities';

// SEO metadata for /locations lives here; page.tsx renders the content.
export async function generateMetadata(): Promise<Metadata> {
  const [pins, locs] = await Promise.all([getPublicPins(), getLocalityGroups()]);
  const top = locs.slice(0, 4).map((l) => l.label).join(', ');
  return buildSectionMetadata({
    title: `Real Estate by Locality in ${citiesPhrase(pins, 3)}`,
    description: `Real estate projects locality by locality${top ? ` — ${top} and more` : ''}, with every project on the Mappingg live map.`,
    path: '/locations',
  });
}

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
