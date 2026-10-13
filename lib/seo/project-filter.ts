// Which public pins are real property projects (for /projects pages, project
// counts on locality/developer pages, project schema and the sitemap).
//
// Not every pin on the map is a project: there are office markers (e.g. our own
// advisory office) and land parcels offered for sale/JV. Those stay on the map —
// nothing is deleted — but they don't get project pages or count as projects.
// Rules are content-based so new pins are classified automatically.

export interface ClassifiablePin {
  title?: string;
  type?: string;
  price?: string;
  configuration?: string;
}

const NON_PROJECT_TYPES = new Set(['land parcel', 'land', 'office', 'advisory']);
const OFFICE_TITLE = /\b(advisory|head office|our office|corporate office)\b/i;
const URL_LIKE = /(^|\s)(https?:\/\/|www\.)|\.(com|in|co\.in|net|org)\b/i;
const PHONE_ONLY = /^\+?\d[\d\s-]{8,}$/;

/** Why a pin is not a project, or null when it is one. */
export function nonProjectReason(p: ClassifiablePin): string | null {
  const type = (p.type || '').trim().toLowerCase();
  if (NON_PROJECT_TYPES.has(type)) return `type "${p.type}" is not a property project`;
  if (OFFICE_TITLE.test(p.title || '')) return 'office / advisory marker, not a project';
  const price = (p.price || '').trim();
  const cfg = (p.configuration || '').trim();
  if (price && URL_LIKE.test(price) && !/₹|\d\s*(cr|lac|lakh|l\b)/i.test(price)) return 'price field holds a website, not a price (office marker)';
  if (cfg && PHONE_ONLY.test(cfg)) return 'configuration field holds a phone number (office marker)';
  return null;
}

export const isPropertyProject = (p: ClassifiablePin): boolean => nonProjectReason(p) === null;
