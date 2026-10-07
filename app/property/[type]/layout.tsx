import type { Metadata } from 'next';
import { getTypeGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /property/<type> lives here; page.tsx renders the listing.
export async function generateMetadata({ params }: { params: { type: string } }): Promise<Metadata> {
  const g = await findGroup(getTypeGroups, params.type);
  if (!g) return { title: 'Not found', robots: { index: false, follow: false } };
  return buildMetadata({
    title: `${g.label} Projects in Pune & MMR`,
    description: `Explore ${g.count} ${g.label.toLowerCase()} project${g.count === 1 ? '' : 's'} across Pune and the Mumbai Metropolitan Region — locations, developers, pricing and status on Mappingg.`,
    path: `/property/${g.slug}`,
    keywords: [`${g.label.toLowerCase()} projects Pune`, `${g.label.toLowerCase()} property MMR`],
  });
}

export default function PropertyTypeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
