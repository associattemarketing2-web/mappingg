import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStatusGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { statusMeta } from '@/lib/seo/listing-meta';

// SEO metadata for /status/<status> lives here; page.tsx renders the listing
// (and overrides title/canonical for ?page=N).
export async function generateMetadata({ params }: { params: { status: string } }): Promise<Metadata> {
  const g = await findGroup(getStatusGroups, params.status);
  if (!g) notFound();
  return buildMetadata(statusMeta(g));
}

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
