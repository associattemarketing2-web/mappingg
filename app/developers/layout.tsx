import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import { getPublicPins, citiesPhrase } from '@/lib/seo/entities';

// SEO metadata for /developers lives here; page.tsx renders the content.
export async function generateMetadata(): Promise<Metadata> {
  const where = citiesPhrase(await getPublicPins(), 3);
  return buildSectionMetadata({
    title: `Real Estate Developers in ${where}`,
    description: `Browse real estate developers building in ${where}, and explore each builder's projects, locations, RERA numbers and current status on Mappingg.`,
    path: '/developers',
  });
}

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
