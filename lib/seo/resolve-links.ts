// Keeps internal links inside stored blog HTML pointing at live, final URLs,
// without editing the stored posts:
//  - /projects/<old-slug>: duplicate listings hidden by the clean-ups redirect to
//    the kept project, and renamed projects redirect to their new slug. Linking
//    the final URL directly saves crawlers a redirect hop on every such link.
//  - /locations/<slug> and /developers/<slug> (hubs restored 22 Nov 2026): kept
//    when that hub exists and is indexable (lib/seo/indexing.ts); otherwise the
//    link is dropped and its text kept. Their retired sub-pages
//    (/locations/<loc>/<facet>) and every /cities/… page: link dropped, text kept.
// Uses the cached public-pin list (one shared read); only links to pins that are
// no longer public need a duplicate lookup. Failures leave the HTML unchanged.

import { duplicateRedirectSlug, getDeveloperGroups, getLocalityGroups, getPublicPins, slugForProject } from './entities';
import { developerIndexing, localityIndexing } from './indexing';
import { projectNumberFromSlug } from './slug';

const HREF = /href="(?:https?:\/\/(?:www\.)?mappingg\.com)?\/projects\/([a-z0-9-]+)\/?"/g;
const ORIGIN = '(?:https?:\\/\\/(?:www\\.)?mappingg\\.com)?';
// Any link to a /cities page, or to a locality/developer sub-page (/locations/x/y).
const RETIRED_LINK = new RegExp(`<a\\b[^>]*href="${ORIGIN}\\/(?:cities(?:[/?#][^"]*)?|(?:locations|developers)\\/[a-z0-9-]+\\/[^"]+)"[^>]*>([\\s\\S]*?)<\\/a>`, 'g');
const HUB_LINK = new RegExp(`<a\\b[^>]*href="${ORIGIN}\\/(locations|developers)\\/([a-z0-9-]+)\\/?(?:[?#][^"]*)?"[^>]*>([\\s\\S]*?)<\\/a>`, 'g');

export async function resolveInternalLinks(html: string): Promise<string> {
  if (!html || !html.includes('href=')) return html;
  let out = html.replace(RETIRED_LINK, (_whole, text: string) => text);

  // Locality / developer hub links: keep the ones that lead to an indexable hub.
  if (/\/(?:locations|developers)\//.test(out)) {
    try {
      const [locs, devs] = await Promise.all([getLocalityGroups(), getDeveloperGroups()]);
      const okLoc = new Set(locs.filter((g) => localityIndexing(g.slug, g.count).index).map((g) => g.slug));
      const okDev = new Set(devs.filter((g) => developerIndexing(g.count).index).map((g) => g.slug));
      out = out.replace(HUB_LINK, (whole, kind: string, slug: string, text: string) =>
        (kind === 'locations' ? okLoc : okDev).has(slug) ? whole : text,
      );
    } catch {
      return out; // a DB hiccup must never break or blank an article
    }
  }

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
