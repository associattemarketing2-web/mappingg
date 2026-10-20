import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDeveloperGroups, findGroup, citiesPhrase } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { developerIndexing } from '@/lib/seo/indexing';
import { displayDeveloperName } from '@/lib/seo/developer-name';
import { clip, TITLE_BUDGET } from '@/lib/seo/project-meta';

// SEO metadata for /developers/<slug> lives here; page.tsx renders the listing.
// The not-found decision is made here, before the response starts streaming,
// so an unknown developer gets a real 404 status.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const g = await findGroup(getDeveloperGroups, params.slug);
  if (!g) notFound();
  const name = displayDeveloperName(g.label);
  // The cities this developer's mapped projects are actually in.
  const where = citiesPhrase(g.pins);
  const full = `${name} Projects in ${where}`;
  return buildMetadata({
    title: full.length <= TITLE_BUDGET ? full : `${name} Projects`,
    description: clip(`${g.count} project${g.count === 1 ? '' : 's'} by ${name} in ${where}: locations, prices, RERA numbers and status on the Mappingg live map.`, 160),
    path: `/developers/${g.slug}`,
    // Developers with fewer than 3 projects stay reachable but aren't indexed.
    noIndex: !developerIndexing(g.count).index,
    follow: true,
  });
}

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
