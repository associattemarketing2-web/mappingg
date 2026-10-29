// Pure helpers behind the home-page finder, the /projects filters and the
// "Projects near you" carousel. No database or Next.js imports, so they are
// unit-tested directly (tests/home-finder.test.ts).
//
// Project prices and areas are free text typed by admins and developers
// ("₹ 98 Lacs - ₹ 1.35 Cr", "₹ 160 – 375 L", "713 – 1,139 Sq Ft (carpet)").
// We only read a value when its unit is explicit: "₹ 2.31 Onwards" (no unit),
// deposits, leasing notes and stray phone numbers are left unparsed, so a
// project is never put in a budget band it might not belong to.

export interface Range { min: number; max: number }

const num = (s: string) => parseFloat(s.replace(/,/g, ''));

/** Price range in lakh (₹1 Cr = 100 L), or null when the text has no reliable price. */
export function parsePriceLakh(price?: string | null): Range | null {
  const raw = (price || '').toLowerCase();
  if (!raw || /deposit|leas|rent|request|\+\d{6,}/.test(raw)) return null;
  // "(3 BHK)" notes are not prices.
  const t = raw.replace(/\([^)]*\)/g, ' ').replace(/\d(?:\.\d)?\s*bhk/g, ' ');
  // Each number with its unit, if any: "0.7 – 1.7 cr" → [0.7, ''], [1.7, 'cr'].
  const parts = [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(cr(?:ore)?s?|l(?:ac|akh)?s?|lacs?)?\b/g)]
    .map((m) => ({ v: num(m[1]), unit: m[2] || '' }));
  if (!parts.length || parts.length > 2) return null;
  // A unit-less number takes the next number's unit ("₹ 1 – 2.5 Cr").
  const last = parts[parts.length - 1].unit;
  if (!last) return null;
  const lakh = parts.map((p) => (p.unit || last).startsWith('c') ? p.v * 100 : p.v);
  const min = Math.min(...lakh), max = Math.max(...lakh);
  // Residential prices only: ₹5 L – ₹500 Cr. Anything else is a typo or not a sale price.
  if (!(min >= 5 && max <= 50_000)) return null;
  return { min, max };
}

/** Area range in sq ft, or null. Bare numbers count only next to an explicit "sq ft". */
export function parseAreaSqft(sqft?: string | number | null): Range | null {
  const t = String(sqft ?? '').toLowerCase();
  if (!/sq\.?\s*f/.test(t)) return null;
  const vals = [...t.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => num(m[0]));
  if (!vals.length || vals.length > 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  // Flats and villas: 150 – 15,000 sq ft. Larger numbers are plots or land parcels.
  if (!(min >= 150 && max <= 15_000)) return null;
  return { min, max };
}

/** True when the area text says it is carpet area (RERA's unit), so it can be labelled that way. */
export const isCarpetArea = (sqft?: string | number | null) => /carpet/i.test(String(sqft ?? ''));

/** BHK sizes offered, e.g. "2 / 2.5 / 3 BHK" → [2, 2.5, 3]. Only numbers tied to "BHK" count. */
export function bhkSizes(configuration?: string | null): number[] {
  const t = configuration || '';
  const out = new Set<number>();
  for (const m of t.matchAll(/((?:\d(?:\.\d)?\s*(?:\/|,|&|and)\s*)*\d(?:\.\d)?)\s*\+?\s*bhk/gi)) {
    for (const n of m[1].match(/\d(?:\.\d)?/g) || []) {
      const v = parseFloat(n);
      if (v >= 1 && v <= 10) out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Filter buckets: "1", "2", "3", "4" (4 and above). 2.5 BHK counts as 2. */
export const BHK_OPTIONS = [
  { slug: '1', label: '1 BHK' },
  { slug: '2', label: '2 BHK' },
  { slug: '3', label: '3 BHK' },
  { slug: '4', label: '4+ BHK' },
] as const;

export function hasBhk(configuration: string | undefined, slug: string): boolean {
  const want = parseInt(slug, 10);
  if (!want) return false;
  return bhkSizes(configuration).some((v) => (want >= 4 ? v >= 4 : Math.floor(v) === want));
}

export const BUDGET_OPTIONS = [
  { slug: 'under-50-lakh', label: 'Under ₹50 L', min: 0, max: 50 },
  { slug: '50-lakh-1-crore', label: '₹50 L – ₹1 Cr', min: 50, max: 100 },
  { slug: '1-2-crore', label: '₹1 – 2 Cr', min: 100, max: 200 },
  { slug: '2-5-crore', label: '₹2 – 5 Cr', min: 200, max: 500 },
  { slug: 'above-5-crore', label: 'Above ₹5 Cr', min: 500, max: Infinity },
] as const;

export const SIZE_OPTIONS = [
  { slug: 'under-600', label: 'Under 600 sq ft', min: 0, max: 600 },
  { slug: '600-1000', label: '600 – 1,000 sq ft', min: 600, max: 1000 },
  { slug: '1000-1500', label: '1,000 – 1,500 sq ft', min: 1000, max: 1500 },
  { slug: 'above-1500', label: 'Above 1,500 sq ft', min: 1500, max: Infinity },
] as const;

/** A project fits a band when any part of its range falls inside it (min inclusive, max exclusive). */
const overlaps = (r: Range, band: { min: number; max: number }) => r.min < band.max && r.max >= band.min;

export function inBudget(price: string | undefined, slug: string): boolean {
  const band = BUDGET_OPTIONS.find((b) => b.slug === slug);
  const r = parsePriceLakh(price);
  return !!(band && r && overlaps(r, band));
}

export function inSize(sqft: string | number | undefined, slug: string): boolean {
  const band = SIZE_OPTIONS.find((b) => b.slug === slug);
  const r = parseAreaSqft(sqft);
  return !!(band && r && overlaps(r, band));
}

/** "₹ 98 L – 1.35 Cr" style label for a parsed range. */
export function formatLakh(v: number): string {
  if (v >= 100) return `₹${+(v / 100).toFixed(2)} Cr`;
  return `₹${+v.toFixed(2)} L`;
}

/** Every word of the query appears in the text (case/accents/punctuation-insensitive). */
export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = ` ${norm(fields.filter(Boolean).join(' '))} `;
  return words.every((w) => hay.includes(` ${w}`));
}

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Valid WGS84 coordinates, rounded to 3 decimals (~100 m) — enough for "near you", and never stored. */
export function coarseCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = typeof lat === 'number' ? lat : parseFloat(String(lat ?? ''));
  const b = typeof lng === 'number' ? lng : parseFloat(String(lng ?? ''));
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: Math.round(a * 1000) / 1000, lng: Math.round(b * 1000) / 1000 };
}
