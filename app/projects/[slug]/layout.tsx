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
    // Only a real price ("₹ 1.73 Cr onwards", "Price on Request"), never other notes typed in the field.
    pin.price && /\d|request/i.test(pin.price) ? pin.price : '',
  ].map((s) => s.trim()).filter(Boolean).join(', ');
  const facts = `${name}${where ? ` in ${where}` : ''}${bits ? ` — ${bits}` : ''}.`;
  // The developer's own text is used as-is only when it is a real sentence; short
  // notes like "Flexi Payment 25x4" are appended to the facts instead of replacing them.
  const own = (pin.key_usp || pin.description || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const description =
    own.length >= 110
      ? clip(own, 160)
      : clip(own && `${facts} ${own}`.length <= 160 ? `${facts} ${own}` : `${facts} View location, configuration, pricing and project details on Mappingg.`, 160);
  return buildMetadata({
    title,
    description,
    path: `/projects/${canonicalSlug}`,
    image: pin.image && /^(https?:|\/api\/)/.test(pin.image) ? pin.image : undefined,
    type: 'article',
    keywords: [name, pin.developer, loc, city, pin.type].filter(Boolean) as string[],
  });
}

/** Cut at a word boundary so a description never ends mid-word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).replace(/[\s,;:–—-]+$/, '')}…`;
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
