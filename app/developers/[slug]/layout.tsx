import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDeveloperGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /developers/<slug> lives here; page.tsx renders the listing.
// The not-found decision is made here, before the response starts streaming,
// so an unknown developer gets a real 404 status.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const g = await findGroup(getDeveloperGroups, params.slug);
  if (!g) notFound();
  return buildMetadata({
    title: `${g.label} — Projects in Pune & MMR`,
    description: `Explore ${g.count} project${g.count === 1 ? '' : 's'} by ${g.label} across Pune and the Mumbai Metropolitan Region — locations, configurations, pricing and current status on Mappingg.`,
    path: `/developers/${g.slug}`,
    keywords: [`${g.label} projects`, `${g.label} Pune`, `${g.label} real estate`],
  });
}

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
