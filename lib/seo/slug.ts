// SEO slug helpers. Slugs are lowercase, hyphenated and stable.

export function slugify(input: string): string {
  return (input || '')
    .toString()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A pin ("project") has no stored slug, but it does have a unique sequential
// `number`. We build a readable slug from the title (+ locality) and append the
// number so the URL stays unique and is trivially resolvable back to one pin.
export function projectSlug(title: string | undefined, locality: string | undefined, number: number): string {
  const base = [slugify(title || 'project'), slugify(locality || '')].filter(Boolean).join('-');
  return `${base || 'project'}-${number}`;
}

/** Pull the trailing pin number out of a project slug, or null if absent. */
export function projectNumberFromSlug(slug: string): number | null {
  const m = /-(\d+)$/.exec(slug || '');
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
