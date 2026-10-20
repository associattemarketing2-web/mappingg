import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import { getPublicPins, citiesPhrase } from '@/lib/seo/entities';

// SEO metadata for /projects lives here; page.tsx renders the content.
// The cities in the title come from the mapped projects, so it stays true as coverage grows.
export async function generateMetadata(): Promise<Metadata> {
  const pins = await getPublicPins();
  const where = citiesPhrase(pins, 3);
  return buildSectionMetadata({
    title: `Real Estate Projects in ${where}`,
    description: `Browse ${pins.length} real estate projects in ${citiesPhrase(pins, 5)} by city, locality, developer and status, with prices, RERA numbers and possession dates.`,
    path: '/projects',
  });
}

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
