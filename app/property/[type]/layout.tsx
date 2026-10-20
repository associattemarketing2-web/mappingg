import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTypeGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { typeMeta } from '@/lib/seo/listing-meta';

// SEO metadata for /property/<type> lives here; page.tsx renders the listing
// (and overrides title/canonical for ?page=N).
export async function generateMetadata({ params }: { params: { type: string } }): Promise<Metadata> {
  const g = await findGroup(getTypeGroups, params.type);
  if (!g) notFound();
  return buildMetadata(typeMeta(g));
}

export default function PropertyTypeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
