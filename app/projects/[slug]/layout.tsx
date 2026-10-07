import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import {
  getPinBySlug,
  primaryLocality,
  cityOf,
  statusLabel,
  slugForProject,
  CITY_LABELS,
} from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

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
  const name = pin.title || `Project #${pin.number}`;
  const where = [loc, city].filter(Boolean).join(', ');
  const title = where ? `${name} in ${where} | Price, Location & Details` : `${name} | Price, Location & Details`;
  const bits = [
    pin.developer ? `by ${pin.developer}` : '',
    pin.configuration || '',
    pin.status ? statusLabel(pin.status) : '',
  ].filter(Boolean).join(', ');
  const description =
    (pin.key_usp || pin.description || '').toString().slice(0, 150).trim() ||
    `Explore ${name}${where ? ` in ${where}` : ''}${bits ? ` — ${bits}` : ''}. View location, configuration, pricing and project details on Mappingg.`;
  return buildMetadata({
    title,
    description,
    path: `/projects/${canonicalSlug}`,
    image: pin.image && /^(https?:|\/api\/)/.test(pin.image) ? pin.image : undefined,
    type: 'article',
    keywords: [name, pin.developer, loc, city, pin.type].filter(Boolean) as string[],
  });
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
