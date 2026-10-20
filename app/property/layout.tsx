import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import { getPublicPins, citiesPhrase } from '@/lib/seo/entities';

// SEO metadata for /property lives here; page.tsx renders the content.
export async function generateMetadata(): Promise<Metadata> {
  const where = citiesPhrase(await getPublicPins(), 3);
  return buildSectionMetadata({
    title: `Property Types in ${where}`,
    description: `Explore real estate by property type in ${where} — residential, commercial, plots and more, with projects, locations and status on Mappingg.`,
    path: '/property',
  });
}

export default function PropertyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
