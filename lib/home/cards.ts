import { runDbOp } from '@/lib/db-engine';
import { cachedRead } from '@/lib/data-cache';
import { withMediaUrls } from '@/lib/pin-media';
import { isPropertyProject } from '@/lib/seo/project-filter';
import { reraNumber } from '@/lib/seo/project-meta';
import {
  withDisplayName, primaryLocality, cityOf, slugForProject, statusLabel, type Pin,
} from '@/lib/seo/entities';
import { CITY_SHORT } from '@/lib/seo/city';
import { parsePriceLakh, parseAreaSqft, isCarpetArea, formatLakh, bhkSizes } from './finder';

// Project cards for the home page ("Featured", "Projects near you") and the
// /api/nearby endpoint. One cached read of the public pins with their cover
// image (as a versioned /api/media URL, never base64), shared by every visitor
// and cleared on every pin write (lib/data-cache.ts) — the home page adds no
// per-visit database reads.

export interface ProjectCardData {
  number: number;
  href: string;
  title: string;
  locality: string;
  city: string;
  developer: string;
  /** Shown only when the price text parsed cleanly (lib/home/finder.ts). */
  price: string;
  bhk: string;
  /** "796 – 1,072 sq ft" with "carpet" only when the source says carpet area. */
  area: string;
  status: string;
  possession: string;
  rera: string;
  image: string;
  featured: boolean;
  residential: boolean;
  lat: number | null;
  lng: number | null;
}

type CardPin = Pin & { highlighted?: boolean; image_meta?: unknown };

const COLUMNS =
  'id,number,title,type,status,price,configuration,sqft,possession_timeline,developer,location,rera_number,field_visibility,lat,lng,highlighted,image,image_meta';

const NON_RESIDENTIAL = /(commercial|office|retail|shop|warehouse|industrial|plot|land)/i;

const sqftLabel = (n: number) => n.toLocaleString('en-IN');

export function toCard(p: CardPin): ProjectCardData {
  const price = parsePriceLakh(p.price);
  const area = parseAreaSqft(p.sqft);
  const sizes = bhkSizes(p.configuration);
  const cityKey = cityOf(p);
  const lat = Number(p.lat), lng = Number(p.lng);
  return {
    number: p.number,
    href: `/projects/${slugForProject(p)}`,
    title: p.title || `Project #${p.number}`,
    locality: primaryLocality(p),
    city: CITY_SHORT[cityKey] || '',
    developer: p.developer || '',
    price: price ? (price.min === price.max ? `${formatLakh(price.min)}${/onward|\+/i.test(p.price || '') ? ' onwards' : ''}` : `${formatLakh(price.min)} – ${formatLakh(price.max)}`) : '',
    bhk: sizes.length ? `${sizes.join(', ')} BHK` : '',
    area: area ? `${area.min === area.max ? sqftLabel(area.min) : `${sqftLabel(area.min)} – ${sqftLabel(area.max)}`} sq ft${isCarpetArea(p.sqft) ? ' carpet' : ''}` : '',
    status: statusLabel(p.status),
    possession: (p.possession_timeline || '').trim().slice(0, 40),
    rera: reraNumber(p.rera_number),
    image: typeof p.image === 'string' && /^(\/api\/media\/|https:\/\/)/.test(p.image) ? p.image : '',
    featured: p.highlighted === true,
    residential: !NON_RESIDENTIAL.test(p.type || ''),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

const readCards = cachedRead('home-project-cards', ['pins'], 600, async (): Promise<ProjectCardData[]> => {
  const res = await runDbOp({ table: 'pins', action: 'select', columns: COLUMNS, order: { col: 'number', ascending: true } }, false);
  if (res.error || !Array.isArray(res.data)) throw new Error(`pins read failed: ${res.error?.message || 'no data'}`);
  return (res.data as CardPin[])
    .filter(isPropertyProject)
    .map((row) => toCard(withDisplayName(withMediaUrls('pins', row, { width: 480 }) as CardPin)));
});

/** Every public project as a card; [] when the database is unreachable (the page still renders). */
export async function getProjectCards(): Promise<ProjectCardData[]> {
  try {
    return await readCards();
  } catch (e) {
    console.warn('[home] project cards unavailable:', (e as Error)?.message || e);
    return [];
  }
}

/** How complete a card is — used to put well-documented projects first. */
export const completeness = (c: ProjectCardData) =>
  (c.price ? 3 : 0) + (c.image ? 2 : 0) + (c.bhk ? 1 : 0) + (c.area ? 1 : 0) + (c.rera ? 1 : 0) + (c.possession ? 1 : 0);
