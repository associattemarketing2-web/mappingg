import { getPublicPins, primaryLocality, slugForProject, type Pin } from '../seo/entities';
import { formatLakh, parseAreaSqft, parsePriceLakh } from '../home/finder';

// Buyer Premium "insights": figures DERIVED from Mappingg's own public listing
// data, never invented. For each project the buyer saved or is comparing:
// listed price and area, an indicative ₹/sq ft (lowest listed price ÷ smallest
// listed area — only when both parse cleanly and the admin left them visible),
// and how that compares with other listed projects in the same locality.

export interface ProjectInsight {
  id: string; title: string; href: string; locality: string; price: string; area: string; possession: string; rera: boolean;
  psf: number | null; localityMedianPsf: number | null; localityCount: number; vsLocality: number | null; status: string;
}

const visible = (p: Pin, key: string) => (p.field_visibility as Record<string, unknown> | null | undefined)?.[key] !== false;

function psfOf(p: Pin): number | null {
  if (!visible(p, 'price') || !visible(p, 'configuration')) return null;
  const price = parsePriceLakh(p.price);
  const area = parseAreaSqft(p.sqft);
  if (!price || !area || area.min < 200 || area.min > 20000) return null;
  const v = Math.round((price.min * 100_000) / area.min);
  return v >= 1000 && v <= 200_000 ? v : null; // outside this band the parse is almost certainly wrong
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export async function projectInsights(pinIds: string[]): Promise<ProjectInsight[]> {
  if (!pinIds.length) return [];
  const pins = await getPublicPins();
  const byLocality = new Map<string, number[]>();
  for (const p of pins) {
    const v = psfOf(p);
    const loc = primaryLocality(p);
    if (v && loc) byLocality.set(loc, [...(byLocality.get(loc) || []), v]);
  }
  const want = new Set(pinIds);
  return pins.filter((p) => want.has(String(p.id))).map((p) => {
    const loc = primaryLocality(p);
    const psf = psfOf(p);
    const peers = byLocality.get(loc) || [];
    const med = peers.length >= 3 ? median(peers) : null;
    const price = visible(p, 'price') ? parsePriceLakh(p.price) : null;
    const area = visible(p, 'configuration') ? parseAreaSqft(p.sqft) : null;
    return {
      id: String(p.id), title: p.title || `Project #${p.number}`, href: `/projects/${slugForProject(p)}`, locality: loc,
      price: price ? (price.min === price.max ? formatLakh(price.min) : `${formatLakh(price.min)} – ${formatLakh(price.max)}`) : '',
      area: area ? `${area.min.toLocaleString('en-IN')}${area.max !== area.min ? ` – ${area.max.toLocaleString('en-IN')}` : ''} sq ft` : '',
      possession: visible(p, 'possession') ? String(p.possession_timeline || '').slice(0, 40) : '',
      rera: visible(p, 'rera') && !!String(p.rera_number || '').trim(),
      psf, localityMedianPsf: med, localityCount: peers.length,
      vsLocality: psf && med ? Math.round(((psf - med) / med) * 100) : null,
      status: String(p.status || ''),
    };
  });
}
