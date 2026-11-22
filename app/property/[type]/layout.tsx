import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTypeGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { typeMeta } from '@/lib/seo/listing-meta';
import { typeIndexing } from '@/lib/seo/indexing';

// SEO metadata for /property/<type> lives here; page.tsx renders the listing
// (and overrides title/canonical for ?page=N).
export async function generateMetadata({ params }: { params: { type: string } }): Promise<Metadata> {
  const g = await findGroup(getTypeGroups, params.type);
  if (!g) notFound();
  // One-off type spellings with 1–2 projects stay reachable but aren't indexed.
  return buildMetadata({ ...typeMeta(g), noIndex: !typeIndexing(g.count).index, follow: true });
}

export default function PropertyTypeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
