import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import {
  getPinBySlug,
  primaryLocality,
  cityOf,
  slugForProject,
  CITY_LABELS,
} from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { projectIndexing } from '@/lib/seo/indexing';
import { projectDescription, projectTitle } from '@/lib/seo/project-meta';

// SEO metadata for /projects/<slug> lives here; page.tsx renders the project.
// Not-found and redirect decisions are made here, before the response starts
// streaming, so they produce a real 404 / 308 status.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const pin = await getPinBySlug(params.slug);
  if (!pin) notFound();
  // Only the number identifies a project, so /projects/<anything>-<n> resolves.
  // Send every variant (old title, typo, renamed project) to the one canonical URL.
  const canonicalSlug = slugForProject(pin);
  if (params.slug !== canonicalSlug) permanentRedirect(`/projects/${canonicalSlug}`);
  const loc = primaryLocality(pin);
  const city = CITY_LABELS[cityOf(pin)];
  // Title and description only name facts this page shows (lib/seo/project-meta.ts).
  return buildMetadata({
    title: projectTitle(pin, loc, city),
    description: projectDescription(pin, loc, city),
    path: `/projects/${canonicalSlug}`,
    image: pin.image && /^(https?:|\/api\/)/.test(pin.image) ? pin.image : undefined,
    type: 'article',
    // Empty placeholder projects (no location, price, configuration or description) aren't indexed yet.
    noIndex: !projectIndexing(pin).index,
    follow: true,
  });
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
