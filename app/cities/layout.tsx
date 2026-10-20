import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import { getCityGroups } from '@/lib/seo/entities';

// SEO metadata for /cities lives here; page.tsx renders the content.
export async function generateMetadata(): Promise<Metadata> {
  const cities = await getCityGroups();
  const names = cities.map((c) => c.label.replace(' & MMR', ''));
  return buildSectionMetadata({
    title: 'Real Estate Projects by City',
    description: `Real estate projects city by city${names.length ? ` — ${names.join(', ')}` : ''}: localities, developers and every project on the Mappingg live map.`,
    path: '/cities',
  });
}

export default function CitiesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
