// Facts about a locality computed from its projects' own data (nothing guessed):
// project counts, listed starting prices, BHK options, developers, possession years.
// Used for the data paragraph and the price FAQ on /locations/<slug>.

export interface SummaryPin {
  type?: string; status?: string; price?: string; configuration?: string;
  developer?: string; possession_timeline?: string;
}

export interface LocalitySummary {
  projects: number;
  residential: number;
  commercial: number;
  /** Lowest and highest listed starting price, in lakh rupees (null when no project lists a price). */
  minLakhs: number | null;
  maxLakhs: number | null;
  priced: number;
  bhk: number[];
  developers: string[];
  readyNow: number;
  possessionYears: [number, number] | null;
}

/**
 * The starting price of a listing, in lakh rupees: "₹ 1.25 Cr Onwards" → 125,
 * "₹ 98 Lacs - ₹ 1.35 Cr" → 98, "₹ 92 – 139 L" → 92, "Price on Request" → null.
 */
export function startingPriceLakhs(price?: string): number | null {
  const s = (price || '').replace(/,/g, '').toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(cr|crore|l\b|lac|lacs|lakh|lakhs)?/);
  if (!m) return null;
  let unit: string | undefined = m[2];
  if (!unit) {
    // "₹ 92 – 139 L": the unit comes after the range.
    const later = s.slice((m.index || 0) + m[0].length).match(/\b(cr|crore|l|lac|lacs|lakh|lakhs)\b/);
    unit = later?.[1];
  }
  if (!unit) return null;
  const n = Number(m[1]);
  const lakhs = Math.round((unit.startsWith('c') ? n * 100 : n) * 100) / 100;
  return lakhs >= 5 && lakhs <= 50000 ? lakhs : null; // ignore obvious typos
}

/** "2 / 2.5 / 3 BHK" → [2, 2.5, 3]. Only reads strings that mention BHK or BED. */
export function bhkOptions(configuration?: string): number[] {
  const s = configuration || '';
  if (!/bhk|bed/i.test(s)) return [];
  return [...new Set((s.match(/\d+(?:\.5)?/g) || []).map(Number).filter((n) => n >= 1 && n <= 6))];
}

const isCommercial = (t?: string) => /commercial|office|retail|shop/i.test(t || '');

export function summarizeLocality(pins: SummaryPin[]): LocalitySummary {
  const prices = pins.map((p) => startingPriceLakhs(p.price)).filter((n): n is number => n != null);
  const bhk = [...new Set(pins.flatMap((p) => bhkOptions(p.configuration)))].sort((a, b) => a - b);
  const years = pins.flatMap((p) => ((p.possession_timeline || '').match(/\b20(2\d|3\d)\b/g) || []).map(Number));
  const counts = new Map<string, number>();
  for (const p of pins) if (p.developer?.trim()) counts.set(p.developer.trim(), (counts.get(p.developer.trim()) || 0) + 1);
  return {
    projects: pins.length,
    residential: pins.filter((p) => !isCommercial(p.type)).length,
    commercial: pins.filter((p) => isCommercial(p.type)).length,
    minLakhs: prices.length ? Math.min(...prices) : null,
    maxLakhs: prices.length ? Math.max(...prices) : null,
    priced: prices.length,
    bhk,
    developers: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
    readyNow: pins.filter((p) => (p.status || '').toLowerCase() === 'available' || /ready/i.test(p.possession_timeline || '')).length,
    possessionYears: years.length ? [Math.min(...years), Math.max(...years)] : null,
  };
}

/** 98 → "₹98 Lacs", 125 → "₹1.25 Cr". */
export function formatLakhs(l: number): string {
  if (l >= 100) return `₹${(Math.round(l) / 100).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  return `₹${Math.round(l)} Lacs`;
}

/** "2, 3 and 4 BHK" */
export function formatBhk(list: number[]): string {
  if (!list.length) return '';
  const parts = list.map(String);
  return (parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`) + ' BHK';
}
