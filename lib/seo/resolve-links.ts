// Keeps internal links inside stored blog HTML pointing at live, final URLs,
// without editing the stored posts:
//  - /projects/<old-slug>: duplicate listings hidden by the clean-ups redirect to
//    the kept project, and renamed projects redirect to their new slug. Linking
//    the final URL directly saves crawlers a redirect hop on every such link.
//  - /locations/…, /cities/… and /developers/… pages no longer exist: the link
//    is dropped and its text kept.
// Uses the cached public-pin list (one shared read); only links to pins that are
// no longer public need a duplicate lookup. Failures leave the HTML unchanged.

import { duplicateRedirectSlug, getPublicPins, slugForProject } from './entities';
import { projectNumberFromSlug } from './slug';

const HREF = /href="(?:https?:\/\/(?:www\.)?mappingg\.com)?\/projects\/([a-z0-9-]+)\/?"/g;
const REMOVED_LINK = /<a\b[^>]*href="(?:https?:\/\/(?:www\.)?mappingg\.com)?\/(?:locations|cities|developers)(?:[/?#][^"]*)?"[^>]*>([\s\S]*?)<\/a>/g;

export async function resolveInternalLinks(html: string): Promise<string> {
  if (!html || !html.includes('href=')) return html;
  let out = html.replace(REMOVED_LINK, (_whole, text: string) => text);
  const slugs = [...out.matchAll(HREF)].map((m) => m[1]);
  if (!slugs.length) return out;

  const finalSlug = new Map<string, string>();
  try {
    const pins = await getPublicPins();
    const byNumber = new Map<number, string[]>();
    for (const p of pins) byNumber.set(p.number, [...(byNumber.get(p.number) || []), slugForProject(p)]);
    for (const slug of slugs) {
      if (finalSlug.has(slug)) continue;
      const n = projectNumberFromSlug(slug);
      if (n == null) continue;
      const live = byNumber.get(n);
      if (live) {
        if (!live.includes(slug)) finalSlug.set(slug, live[0]);
      } else {
        const kept = await duplicateRedirectSlug(slug);
        if (kept) finalSlug.set(slug, kept);
      }
    }
  } catch {
    return out; // a DB hiccup must never break or blank an article
  }

  out = out.replace(HREF, (whole, slug: string) => (finalSlug.has(slug) ? `href="/projects/${finalSlug.get(slug)}"` : whole));
  return out;
}
