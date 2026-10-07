import type { Metadata } from 'next';
import { getCityGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /cities/<city> lives here; page.tsx renders the listing.
export async function generateMetadata({ params }: { params: { city: string } }): Promise<Metadata> {
  const g = await findGroup(getCityGroups, params.city);
  if (!g) return { title: 'City not found', robots: { index: false, follow: false } };
  return buildMetadata({
    title: `Real Estate Projects in ${g.label}`,
    description: `Explore ${g.count} real estate project${g.count === 1 ? '' : 's'} across ${g.label} — by locality, developer and status, with an interactive map on Mappingg.`,
    path: `/cities/${g.slug}`,
    keywords: [`real estate projects ${g.label}`, `property in ${g.label}`],
  });
}

export default function CityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
