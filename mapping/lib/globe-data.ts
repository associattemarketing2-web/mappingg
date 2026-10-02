import { getSeoProjects } from './seo-data';

// Aggregates live projects by country (and the top areas within each) so the
// hero globe can show real numbers — "which country has how many projects, and
// where" — instead of decorative dots. Projects currently carry only a free-text
// `location` (e.g. "Mundhwa, Pune"), so we infer the country from it and default
// to India (where every current project is). International keywords are mapped
// too, so partner projects abroad will appear automatically once added.

export interface GlobeCountry {
  name: string;
  code: string;
  flag: string;
  count: number;
  lat: number;
  lon: number;
  areas: { name: string; count: number }[];
}
export interface GlobeData {
  total: number;
  countries: GlobeCountry[];
}

type CountryDef = { name: string; code: string; flag: string; lat: number; lon: number; kw: string[] };

// Representative coordinates (country centroid-ish) + detection keywords.
const COUNTRIES: CountryDef[] = [
  { name: 'United Arab Emirates', code: 'AE', flag: '🇦🇪', lat: 24.2, lon: 54.4, kw: ['dubai', 'uae', 'emirates', 'abu dhabi', 'sharjah'] },
  { name: 'United Kingdom', code: 'GB', flag: '🇬🇧', lat: 54.0, lon: -2.0, kw: ['london', 'uk', 'united kingdom', 'england'] },
  { name: 'United States', code: 'US', flag: '🇺🇸', lat: 39.0, lon: -98.0, kw: ['usa', 'united states', 'new york', 'california'] },
  { name: 'Singapore', code: 'SG', flag: '🇸🇬', lat: 1.35, lon: 103.8, kw: ['singapore'] },
];
const INDIA: CountryDef = { name: 'India', code: 'IN', flag: '🇮🇳', lat: 22.0, lon: 79.0, kw: [] };

function countryOf(location?: string): CountryDef {
  const s = (location || '').toLowerCase();
  for (const c of COUNTRIES) if (c.kw.some((k) => s.includes(k))) return c;
  return INDIA; // every current project is in Pune / MMR, India
}

function areaOf(location?: string): string {
  const first = String(location || '').split(/[,|/]/)[0].trim().replace(/\s+/g, ' ');
  if (!first) return '';
  return first.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export async function getGlobeData(): Promise<GlobeData> {
  const projects = await getSeoProjects();
  // Count only projects that are actually live on the map (exclude sold).
  const live = projects.filter((p) => (p.status || '').toLowerCase() !== 'sold');

  const byCode = new Map<string, GlobeCountry & { _areas: Map<string, number> }>();
  for (const p of live) {
    const c = countryOf(p.location);
    let entry = byCode.get(c.code);
    if (!entry) {
      entry = { name: c.name, code: c.code, flag: c.flag, count: 0, lat: c.lat, lon: c.lon, areas: [], _areas: new Map() };
      byCode.set(c.code, entry);
    }
    entry.count += 1;
    const a = areaOf(p.location);
    if (a) entry._areas.set(a, (entry._areas.get(a) || 0) + 1);
  }

  const countries: GlobeCountry[] = [...byCode.values()]
    .map(({ _areas, ...rest }) => ({
      ...rest,
      areas: [..._areas.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.count - a.count);

  return { total: live.length, countries };
}
