import { getDb } from '@/lib/mongodb';
import { cachedRead } from '@/lib/data-cache';
import { logosByName, normDev } from '@/lib/developers';
import { getPinsByNumber, slugForProject, typeLabel } from '@/lib/seo/entities';
import { reraNumber } from '@/lib/seo/project-meta';
import { toCard, type ProjectCardData } from './cards';

// Everything the "Enquire now" quick view shows for one project. It merges the
// public pin (already filtered by the admin's field visibility) with the
// project's Projects Intake record when it has one (towers, floors, units,
// gallery, amenities…). Only real, filled-in values are returned — the popup
// leaves out any block that has no data. Sales contact numbers are never sent.

export interface QuickView extends ProjectCardData {
  type: string;
  usp: string;
  about: string;
  logo: string;
  photos: string[];
  video: string;
  brochure: string;
  facts: { k: string; v: string }[];
  configs: string[];
  highlights: string[];
  green: string;
}

type Doc = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const https = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v.trim()) ? v.trim() : '');
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

const readLogos = cachedRead('quickview-dev-logos', ['developers', 'pins'], 600, async () => Object.fromEntries(await logosByName()));
const readIntake = cachedRead('quickview-intake', ['projects'], 600, async (id: string): Promise<Doc | null> => {
  const db = await getDb();
  const p = await db.collection<Doc>('projects').findOne({ id, is_live: true });
  if (!p) return null;
  // Public fields only.
  const keep = ['towers', 'floors', 'total_units', 'land_area_acres', 'gallery_urls', 'cover_image_url', 'amenities', 'green_certification', 'green_rating', 'brochure_url', 'configurations', 'short_description', 'key_usps'];
  return Object.fromEntries(keep.map((k) => [k, p[k] ?? null]));
});

export async function getQuickView(number: number): Promise<QuickView | null> {
  const pin = (await getPinsByNumber(number))[0];
  if (!pin) return null;
  const card = toCard(pin);
  const raw = pin as typeof pin & { intake_project_id?: string; brochure_url?: string };
  const [logos, intake] = await Promise.all([
    readLogos().catch(() => ({} as Record<string, string>)),
    raw.intake_project_id ? readIntake(String(raw.intake_project_id)).catch(() => null) : Promise.resolve(null),
  ]);
  const logo = (card.developer && logos[normDev(card.developer)]) || '';

  // Real photos first (intake cover + gallery); the pin picture is often the developer logo.
  const photos = [https(intake?.cover_image_url), ...(Array.isArray(intake?.gallery_urls) ? intake!.gallery_urls.map(https) : [])].filter(Boolean);
  // …and when the pin picture IS the developer logo (same content hash), it isn't a project photo.
  const ver = (u: string) => /[?&]v=([0-9a-f]+)/.exec(u)?.[1] || u;
  if (card.image && !photos.includes(card.image) && !(logo && ver(card.image) === ver(logo))) photos.push(card.image);

  // RERA: the RERA field, else a visible custom field labelled "RERA…" (older pins keep it there).
  const cf = (pin as unknown as { custom_fields?: unknown }).custom_fields;
  const custom: Doc[] = Array.isArray(cf) ? cf : [];
  const rera = card.rera || reraNumber(str(custom.find((f) => f && f.visible !== false && /rera/i.test(str(f.label)))?.value));

  const facts: { k: string; v: string }[] = [];
  const land = pos(intake?.land_area_acres), towers = pos(intake?.towers), floors = pos(intake?.floors), units = pos(intake?.total_units);
  if (land) facts.push({ k: 'Land parcel', v: `${+land.toFixed(2)} ${land === 1 ? 'acre' : 'acres'}` });
  if (towers) facts.push({ k: 'Towers', v: String(towers) });
  if (floors) facts.push({ k: 'Floors', v: String(floors) });
  if (units) facts.push({ k: 'Total units', v: units.toLocaleString('en-IN') });

  const configs = Array.isArray(intake?.configurations) && intake!.configurations.length
    ? (intake!.configurations as unknown[]).map(str).filter(Boolean)
    : (card.bhk ? card.bhk.replace(/ BHK$/, '').split(', ').map((b) => `${b} BHK`) : []);

  const usp = str(pin.key_usp) || str(intake?.key_usps);
  const amenities = Array.isArray(intake?.amenities) ? (intake!.amenities as unknown[]).map(str).filter(Boolean) : [];
  const highlights = [
    card.locality && `${card.locality} location`,
    configs.length ? `${configs.join(', ')}` : '',
    amenities.length ? `${amenities.length} amenities` : '',
    ...usp.split(/\s*[|•;\n]\s*/).filter((s) => s && s.length <= 60),
  ].filter(Boolean).slice(0, 4) as string[];

  const yt = str(pin.youtube_video_url);
  return {
    ...card,
    rera,
    href: `/projects/${slugForProject(pin)}`,
    type: pin.type ? typeLabel(pin.type) : '',
    usp,
    about: str(pin.description) || str(intake?.short_description),
    logo,
    photos: photos.slice(0, 8),
    video: /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(yt) ? yt : '',
    brochure: https(intake?.brochure_url) || https(raw.brochure_url),
    facts,
    configs,
    highlights,
    green: [str(intake?.green_certification), str(intake?.green_rating)].filter(Boolean).join(' · '),
  };
}
