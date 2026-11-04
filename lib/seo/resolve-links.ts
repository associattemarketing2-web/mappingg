// Keeps internal links inside stored blog HTML pointing at live, final URLs,
// without editing the stored posts:
//  - /projects/<old-slug>: duplicate listings hidden by the clean-ups redirect to
//    the kept project, and renamed projects redirect to their new slug. Linking
//    the final URL directly saves crawlers a redirect hop on every such link.
//  - /locations/<slug> for a locality with no public project any more (it would
//    404): the link is dropped and its text kept.
// Uses the cached public-pin list (one shared read); only links to pins that are
// no longer public need a duplicate lookup. Failures leave the HTML unchanged.

import { duplicateRedirectSlug, getLocalityGroups, getPublicPins, slugForProject } from './entities';
import { projectNumberFromSlug } from './slug';

const HREF = /href="(?:https?:\/\/(?:www\.)?mappingg\.com)?\/(projects|locations)\/([a-z0-9-]+)\/?"/g;
const LOCATION_LINK = /<a\b[^>]*href="(?:https?:\/\/(?:www\.)?mappingg\.com)?\/locations\/([a-z0-9-]+)\/?"[^>]*>([\s\S]*?)<\/a>/g;

export async function resolveInternalLinks(html: string): Promise<string> {
  if (!html || !html.includes('href=')) return html;
  const refs = [...html.matchAll(HREF)].map((m) => ({ kind: m[1], slug: m[2] }));
  if (!refs.length) return html;

  const finalSlug = new Map<string, string>();
  let localities: Set<string> | null = null;
  try {
    const pins = await getPublicPins();
    const byNumber = new Map<number, string[]>();
    for (const p of pins) byNumber.set(p.number, [...(byNumber.get(p.number) || []), slugForProject(p)]);
    for (const r of refs) {
      if (r.kind !== 'projects' || finalSlug.has(r.slug)) continue;
      const n = projectNumberFromSlug(r.slug);
      if (n == null) continue;
      const live = byNumber.get(n);
      if (live) {
        if (!live.includes(r.slug)) finalSlug.set(r.slug, live[0]);
      } else {
        const kept = await duplicateRedirectSlug(r.slug);
        if (kept) finalSlug.set(r.slug, kept);
      }
    }
    if (refs.some((r) => r.kind === 'locations')) localities = new Set((await getLocalityGroups()).map((g) => g.slug));
  } catch {
    return html; // a DB hiccup must never break or blank an article
  }

  let out = html.replace(HREF, (whole, kind: string, slug: string) =>
    kind === 'projects' && finalSlug.has(slug) ? `href="/projects/${finalSlug.get(slug)}"` : whole,
  );
  if (localities && localities.size) {
    const known = localities;
    out = out.replace(LOCATION_LINK, (whole, slug: string, text: string) => (known.has(slug) ? whole : text));
  }
  return out;
}
