import type { Metadata } from 'next';
import { getStatusGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /status/<status> lives here; page.tsx renders the listing.
export async function generateMetadata({ params }: { params: { status: string } }): Promise<Metadata> {
  const g = await findGroup(getStatusGroups, params.status);
  if (!g) return { title: 'Not found', robots: { index: false, follow: false } };
  return buildMetadata({
    title: `${g.label} Projects in Pune & MMR`,
    description: `Explore ${g.count} ${g.label.toLowerCase()} real estate project${g.count === 1 ? '' : 's'} across Pune and the Mumbai Metropolitan Region — locations, developers, pricing and configurations on Mappingg.`,
    path: `/status/${g.slug}`,
    keywords: [`${g.label.toLowerCase()} projects Pune`, `${g.label.toLowerCase()} property Pune`],
  });
}

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
