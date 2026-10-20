// Project-page SEO text, built only from a project's own published fields.
// Shared by app/projects/[slug] (metadata + page) and scripts/seo-audit, so the
// audit reports exactly what the site renders.
//
// Rules:
// - Fields the admin switched off for the public card (pins.field_visibility[id]
//   === false, same switches as the live map and the API) are removed first.
// - A title only mentions a facet (price, BHK, RERA, possession) the page shows.
// - Nothing is guessed: no amenities, floor plans, reviews or prices are implied.

import { bhkOptions, formatBhk } from './locality-summary';
import { displayDeveloperName } from './developer-name';

/** Card field id (live map / admin) → pin column it controls. */
export const FIELD_VISIBILITY_COLUMNS: Record<string, string> = {
  developer: 'developer',
  type: 'type',
  status: 'status',
  configuration: 'configuration',
  price: 'price',
  possession: 'possession_timeline',
  key_usp: 'key_usp',
  rera: 'rera_number',
};

export interface ProjectFields {
  title?: string;
  developer?: string;
  type?: string;
  status?: string;
  configuration?: string;
  price?: string;
  possession_timeline?: string;
  key_usp?: string;
  description?: string;
  rera_number?: string;
  field_visibility?: Record<string, unknown> | null;
}

/**
 * A copy of the pin without the fields the admin hid from the public. The location
 * is not masked: it decides the URL and the pin's position is public on the map.
 */
export function applyFieldVisibility<T extends ProjectFields>(pin: T): T {
  const vis = pin.field_visibility;
  if (!vis || typeof vis !== 'object') return pin;
  let out: T | null = null;
  for (const [id, col] of Object.entries(FIELD_VISIBILITY_COLUMNS)) {
    if (vis[id] === false && (pin as Record<string, unknown>)[col] != null) {
      out = out || { ...pin };
      (out as Record<string, unknown>)[col] = '';
    }
  }
  return out || pin;
}

/** "SIGNATURE GLOBAL CITY 37D EXTN." → "Signature Global City 37D Extn." (display only; slugs ignore case). */
export const displayProjectName = (raw?: string): string => displayDeveloperName(raw);

const clean = (v?: unknown) => (v == null ? '' : String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

/** A real price ("₹ 1.73 Cr onwards", "Price on Request") — not other notes typed in the field. */
export function realPrice(price?: string): string {
  const p = clean(price);
  return p && /\d|request/i.test(p) ? p : '';
}

/** A plausible RERA registration id (MahaRERA P5…, Karnataka PRM/KA/…, HARERA, UP RERA UPRERA…). */
export function reraNumber(v?: string): string {
  const r = clean(v);
  if (!r || r.length < 6 || r.length > 80) return '';
  if (/^(n\/?a|na|nil|none|tbd|applied|awaited|pending|-+)$/i.test(r)) return '';
  return /\d{3,}/.test(r) ? r : '';
}

/**
 * The registry that issued a RERA number, from its format, with the registry's
 * website. Same rules as the live map's project panel (public/legacy/public-map.json).
 * Unknown formats return a generic name and no link — never a guess.
 */
export function reraRegistry(rera?: string): { name: string; url: string } {
  const n = clean(rera).split(/\s*[,;]\s*|\s+\/\s+|\s+/)[0] || '';
  if (/^P5\d{10}$|^P[RCM]\d{10,}$/i.test(n)) return { name: 'MahaRERA', url: 'https://maharera.maharashtra.gov.in/projects-search-result' };
  if (/^PRM\/KA\/RERA\//i.test(n)) return { name: 'RERA Karnataka', url: 'https://rera.karnataka.gov.in/' };
  if (/^(GGM\/|RC\/REP\/HARERA|HRERA)/i.test(n)) return { name: 'Haryana RERA', url: 'https://haryanarera.gov.in/' };
  if (/^UPRERA/i.test(n)) return { name: 'UP RERA', url: 'https://www.up-rera.in/' };
  if (/^P0\d{10}$/i.test(n)) return { name: 'Telangana RERA', url: 'https://rerait.telangana.gov.in/' };
  return { name: 'RERA', url: '' };
}

/** "2, 3 and 4 BHK" from the configuration field, or '' when it names no BHK. */
export function bhkLabel(configuration?: string): string {
  return formatBhk(bhkOptions(configuration).sort((a, b) => a - b));
}

/** Cut at a word boundary so a description never ends mid-word. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const head = cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).replace(/[\s,;:–—-]+$/, '');
  // Ending on a full sentence reads better than "….".
  return /[.!?]$/.test(head) ? head : `${head}…`;
}

// Google shows roughly 60–70 characters; the root layout appends " — Mappingg" (11),
// so 59 keeps the full title within ~70.
export const TITLE_BUDGET = 59;

/**
 * "Kolte Patil Life Republic in Hinjewadi, Pune | Price, 2 and 3 BHK, RERA".
 * Facets are added only when the page shows them, in order of buyer interest,
 * and dropped from the end until the title fits.
 */
export function projectTitle(p: ProjectFields, locality: string, city: string): string {
  const name = displayProjectName(p.title) || 'Project';
  const facets = [
    realPrice(p.price) ? 'Price' : '',
    bhkLabel(p.configuration),
    reraNumber(p.rera_number) ? 'RERA' : '',
    clean(p.possession_timeline) ? 'Possession' : '',
  ].filter(Boolean);
  const places = [
    [locality, city].filter(Boolean).join(', '),
    locality || city,
    '',
  ];
  for (const where of places) {
    const head = where ? `${name} in ${where}` : name;
    for (let n = facets.length; n >= 0; n--) {
      const t = n ? `${head} | ${facets.slice(0, n).join(', ')}` : head;
      if (t.length <= TITLE_BUDGET || (!where && n === 0)) {
        // A long name alone still beats a truncated facet list; keep a fallback suffix when room allows.
        const suffix = ' | Location & Details';
        if (n === 0 && !facets.length && t.length + suffix.length <= TITLE_BUDGET) return t + suffix;
        return t;
      }
    }
  }
  return name;
}

export function projectDescription(p: ProjectFields, locality: string, city: string): string {
  const name = displayProjectName(p.title) || 'This project';
  const where = [locality, city].filter(Boolean).join(', ');
  const bits = [
    clean(p.developer) ? `by ${displayDeveloperName(p.developer)}` : '',
    clean(p.configuration),
    statusText(p.status),
    realPrice(p.price),
    clean(p.possession_timeline) ? `possession ${clean(p.possession_timeline)}` : '',
  ].filter(Boolean);
  const rera = reraNumber(p.rera_number);
  const facts = `${name}${where ? ` in ${where}` : ''}${bits.length ? ` — ${bits.join(', ')}` : ''}.${rera ? ` RERA ${rera}.` : ''}`;
  // The developer's own text is used as-is only when it is a real sentence; short
  // notes like "Flexi Payment 25x4" are appended to the facts instead.
  const own = clean(p.key_usp || p.description);
  if (own.length >= 110) return clip(own, 160);
  let d = facts.length > 160 ? clip(facts.replace(/ RERA [^ ]+\.$/, ''), 160) : facts;
  if (own && `${d} ${own}`.length <= 160) d = `${d} ${own}`;
  const tail = ' See its location and nearby projects on the Mappingg map.';
  if (d.length + tail.length <= 160) d += tail;
  return d;
}

function statusText(s?: string): string {
  switch ((s || '').toLowerCase()) {
    case 'available': return 'ready to move';
    case 'construction':
    case 'under_construction': return 'under construction';
    case 'upcoming': return 'upcoming';
    case 'sold': return 'sold out';
    default: return '';
  }
}

const TYPE_WORDS: Record<string, string> = {
  residential: 'residential project',
  commercial: 'commercial project',
  plot: 'plotted development',
  plots: 'plotted development',
  villa: 'villa project',
  'mixed use': 'mixed-use project',
};

function kindOf(p: ProjectFields): string {
  const t = clean(p.type).toLowerCase().replace(/[_-]+/g, ' ');
  if (TYPE_WORDS[t]) return TYPE_WORDS[t];
  if (/plot/i.test(clean(p.configuration)) || /plot/.test(t)) return 'plotted development';
  if (/commercial|office|retail|shop/.test(t)) return 'commercial project';
  if (/resid|group housing|apartment|flat/.test(t)) return 'residential project';
  return 'real estate project';
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * A short overview written only from this project's own fields (and counts from
 * the map), for pages where the developer has not supplied a description. Each
 * sentence is skipped when its fact is missing, so nothing is padded or implied.
 */
export function projectSummary(
  p: ProjectFields,
  locality: string,
  city: string,
  ctx: { sameLocality?: number; sameDeveloper?: number } = {},
): string[] {
  const name = displayProjectName(p.title) || 'This project';
  const dev = clean(p.developer) ? displayDeveloperName(p.developer) : '';
  const status = statusText(p.status);
  const kind = kindOf(p);
  const where = [locality, city].filter(Boolean).join(', ');
  // Before a noun the status is hyphenated: "an under-construction plotted development".
  const adj = status.replace(/ /g, '-');
  const lead = `${adj ? `${article(adj)} ${adj} ` : `${article(kind)} `}${kind}`;
  const out: string[] = [];
  out.push(`${name} is ${lead}${dev ? ` by ${dev}` : ''}${where ? ` in ${where}` : ''}.`);

  // "Plot" / "Shop" as the whole configuration reads as "plots" / "shops".
  const rawConfig = clean(p.configuration);
  const config = /^(plot|shop|office|villa|row house|bungalow)s?$/i.test(rawConfig) ? `${rawConfig.toLowerCase().replace(/s$/, '')}s` : rawConfig;
  const price = realPrice(p.price);
  if (config && price) out.push(`It offers ${config}, with a listed price of ${price}.`);
  else if (config) out.push(`It offers ${config}; the developer has not published a price on Mappingg yet.`);
  else if (price) out.push(`Its listed price is ${price}.`);

  const rera = reraNumber(p.rera_number);
  const possession = clean(p.possession_timeline);
  if (rera && possession) out.push(`It is registered under RERA number ${rera}, with possession listed for ${possession}.`);
  else if (rera) out.push(`It is registered under RERA number ${rera}.`);
  else if (possession) out.push(`Possession is listed for ${possession}.`);

  const near = ctx.sameLocality || 0;
  const more = ctx.sameDeveloper || 0;
  const context = [
    near > 0 && locality ? `${near} other project${near === 1 ? '' : 's'} in ${locality}` : '',
    more > 0 && dev ? `${more} more by ${dev}` : '',
  ].filter(Boolean);
  out.push(
    `On the Mappingg live map you can see exactly where it is and any infrastructure we track nearby${context.length ? `, and compare it with ${context.join(' and ')}` : ''}.`,
  );
  return out;
}

/**
 * Questions answered only from fields shown on the page. A question is left out
 * when the page has no answer for it (no "price on request" style filler).
 */
export function projectFaqs(p: ProjectFields, locality: string, city: string): { q: string; a: string }[] {
  const name = displayProjectName(p.title) || 'this project';
  const price = realPrice(p.price);
  const rera = reraNumber(p.rera_number);
  const bhk = bhkLabel(p.configuration);
  const possession = clean(p.possession_timeline);
  const status = statusText(p.status);
  const dev = clean(p.developer) ? displayDeveloperName(p.developer) : '';
  const out: ({ q: string; a: string } | null)[] = [
    locality
      ? { q: `Where is ${name} located?`, a: `${name} is in ${locality}${city ? `, ${city}` : ''}. Its exact position, nearby projects and planned infrastructure are shown on the Mappingg live map.` }
      : null,
    dev ? { q: `Who is the developer of ${name}?`, a: `${name} is developed by ${dev}.` } : null,
    price ? { q: `What is the price of ${name}?`, a: `The listed price of ${name} is ${price}. Prices change often, so confirm the current price sheet with the developer before you decide.` } : null,
    bhk ? { q: `What configurations are available in ${name}?`, a: `${name} lists ${bhk} homes (${clean(p.configuration)}).` } : null,
    rera
      ? (() => {
          const reg = reraRegistry(rera);
          return {
            q: `What is the RERA number of ${name}?`,
            a: reg.url
              ? `${name} is listed with ${reg.name} registration number ${rera}. You can check it on the ${reg.name} website before booking.`
              : `${name} is listed with RERA registration number ${rera}. You can check it on the state RERA website before booking.`,
          };
        })()
      : null,
    status || possession
      ? {
          q: `What is the possession date of ${name}?`,
          a: possession
            ? `${name} lists possession ${possession}${status ? ` and is currently ${status}` : ''}. Check the RERA-registered completion date for the final commitment.`
            : `${name} is currently ${status}. The developer has not published a possession date on Mappingg yet.`,
        }
      : null,
  ];
  return out.filter((x): x is { q: string; a: string } => !!x);
}
