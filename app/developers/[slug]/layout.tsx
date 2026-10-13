import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDeveloperGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { developerIndexing } from '@/lib/seo/indexing';
import { displayDeveloperName } from '@/lib/seo/developer-name';

// SEO metadata for /developers/<slug> lives here; page.tsx renders the listing.
// The not-found decision is made here, before the response starts streaming,
// so an unknown developer gets a real 404 status.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const g = await findGroup(getDeveloperGroups, params.slug);
  if (!g) notFound();
  const name = displayDeveloperName(g.label);
  return buildMetadata({
    title: `${name} — Projects in Pune & MMR`,
    description: `Explore ${g.count} project${g.count === 1 ? '' : 's'} by ${name} across Pune and the Mumbai Metropolitan Region — locations, configurations, pricing and current status on Mappingg.`,
    path: `/developers/${g.slug}`,
    keywords: [`${name} projects`, `${name} Pune`, `${name} real estate`],
    // Developers with fewer than 3 projects stay reachable but aren't indexed.
    noIndex: !developerIndexing(g.count).index,
    follow: true,
  });
}

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
