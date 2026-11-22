import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import {
  getPinBySlug,
  duplicateRedirectSlug,
  primaryLocality,
  cityOf,
  slugForProject,
  CITY_LABELS,
} from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { projectIndexing } from '@/lib/seo/indexing';
import { projectDescription, projectTitle } from '@/lib/seo/project-meta';
import { getProjectPhotos, sized } from '@/lib/seo/project-media';
import { publicImageUrl } from '@/lib/seo/public-media';

// SEO metadata for /projects/<slug> lives here; page.tsx renders the project.
// Not-found and redirect decisions are made here, before the response starts
// streaming, so they produce a real 404 / 308 status.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const pin = await getPinBySlug(params.slug);
  if (!pin) {
    // A duplicate listing that was hidden in favour of another: send its old URL there.
    const kept = await duplicateRedirectSlug(params.slug);
    if (kept) permanentRedirect(`/projects/${kept}`);
    notFound();
  }
  // Only the number identifies a project, so /projects/<anything>-<n> resolves.
  // Send every variant (old title, typo, renamed project) to the one canonical URL.
  const canonicalSlug = slugForProject(pin);
  if (params.slug !== canonicalSlug) permanentRedirect(`/projects/${canonicalSlug}`);
  const loc = primaryLocality(pin);
  const city = CITY_LABELS[cityOf(pin)];
  // Share image: the official cover photo when we have one, else the pin image
  // (usually the developer logo) — always at its crawlable /media/ address.
  const photos = await getProjectPhotos(pin.intake_project_id);
  const logo = pin.image && /^(https?:|\/api\/)/.test(pin.image) ? publicImageUrl(pin.image) : undefined;
  // Title and description only name facts this page shows (lib/seo/project-meta.ts).
  return buildMetadata({
    title: projectTitle(pin, loc, city),
    description: projectDescription(pin, loc, city),
    path: `/projects/${canonicalSlug}`,
    image: photos.cover ? sized(photos.cover, 1200) : logo,
    type: 'article',
    // Empty placeholder projects (no location, price, configuration or description) aren't indexed yet.
    noIndex: !projectIndexing(pin).index,
    follow: true,
  });
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
