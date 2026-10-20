import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCityGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { cityMeta } from '@/lib/seo/listing-meta';

// SEO metadata for /cities/<city> lives here; page.tsx renders the listing
// (and overrides title/canonical for ?page=N).
export async function generateMetadata({ params }: { params: { city: string } }): Promise<Metadata> {
  const g = await findGroup(getCityGroups, params.city);
  if (!g) notFound();
  return buildMetadata(cityMeta(g));
}

export default function CityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
