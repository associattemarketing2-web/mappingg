import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStatusGroups, findGroup, citiesPhrase } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { TITLE_BUDGET } from '@/lib/seo/project-meta';

// SEO metadata for /status/<status> lives here; page.tsx renders the listing.
export async function generateMetadata({ params }: { params: { status: string } }): Promise<Metadata> {
  const g = await findGroup(getStatusGroups, params.status);
  if (!g) notFound();
  const where = citiesPhrase(g.pins);
  const title = `${g.label} Projects in ${where}`;
  return buildMetadata({
    title: title.length <= TITLE_BUDGET ? title : `${g.label} Projects in ${citiesPhrase(g.pins, 2)}`,
    description: `Explore ${g.count} ${g.label.toLowerCase()} real estate project${g.count === 1 ? '' : 's'} in ${where} — locations, developers, pricing and configurations on Mappingg.`,
    path: `/status/${g.slug}`,
  });
}

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
