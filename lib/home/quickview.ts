import { getDb } from '@/lib/mongodb';
import { cachedRead } from '@/lib/data-cache';
import { logosByName, normDev } from '@/lib/developers';
import { getPinsByNumber, slugForProject, typeLabel } from '@/lib/seo/entities';
import { reraNumber } from '@/lib/seo/project-meta';
import { toCard, type ProjectCardData } from './cards';

// Everything a project's details view shows: the "Enquire now" popup on the
// home page and the details panel on the live map. It merges the public pin
// (already filtered by the admin's field visibility) with the project's
// Projects Intake record when it has one (towers, floors, units, gallery,
// unit-type table, floor plans, payment plan, 360° tour…). Only real, filled-in
// values are returned — the views leave out any block with no data. Sales
// contact numbers are never sent.

export interface UnitRow { config: string; area: string; price: string }

export interface QuickView extends ProjectCardData {
  type: string;
  usp: string;
  about: string;
  logo: string;
  photos: string[];
  video: string;
  brochure: string;
  floorPlans: string[];
  paymentPlan: string;
  tour360: string;
  facts: { k: string; v: string }[];
  configs: string[];
  units: UnitRow[];
  highlights: string[];
  green: string;
}

type Doc = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
/** A public file link: an https URL, or a published Projects Intake file (/api/partners/storage?bucket=project-media…&public=1). */
const mediaUrl = (v: unknown) => {
  const s = str(v);
  if (/^https:\/\//.test(s)) return s;
  if (/^\/api\/partners\/storage\?bucket=project-media&[^"'<>\s]*public=1/.test(s)) return s;
  return '';
};
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const list = (v: unknown) => (Array.isArray(v) ? v : []);

const readLogos = cachedRead('quickview-dev-logos', ['developers', 'pins'], 600, async () => Object.fromEntries(await logosByName()));
const readIntake = cachedRead('quickview-intake', ['projects'], 600, async (id: string): Promise<Doc | null> => {
  const db = await getDb();
  const p = await db.collection<Doc>('projects').findOne({ id, is_live: true });
  if (!p) return null;
  // Public fields only.
  const keep = ['towers', 'floors', 'total_units', 'land_area_acres', 'gallery_urls', 'cover_image_url', 'amenities',
    'green_certification', 'green_rating', 'brochure_url', 'configurations', 'short_description', 'key_usps',
    'unit_mix', 'floor_plan_urls', 'payment_plan_url', 'tour_360_url', 'youtube_url', 'area_unit'];
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
  let logo = (card.developer && logos[normDev(card.developer)]) || '';

  // Intake covers are often just the developer's logo (file named after the developer).
  const devWords = normDev(card.developer).split(' ').filter((w) => w.length > 2);
  const cover = mediaUrl(intake?.cover_image_url);
  const coverIsLogo = !!cover && devWords.length > 0 && devWords.every((w) => decodeURIComponent(cover).toLowerCase().includes(w));
  if (coverIsLogo && !logo) logo = cover;

  // Real photos first (intake cover + gallery)…
  const photos = [coverIsLogo ? '' : cover, ...list(intake?.gallery_urls).map(mediaUrl)].filter(Boolean);
  // …and the pin picture, unless it IS the developer logo (same content hash).
  const ver = (u: string) => /[?&]v=([0-9a-f]+)/.exec(u)?.[1] || u;
  if (card.image && !photos.includes(card.image) && !(logo && ver(card.image) === ver(logo))) photos.push(card.image);

  // RERA: the RERA field, else a visible custom field labelled "RERA…" (older pins keep it there).
  const cf = (pin as unknown as { custom_fields?: unknown }).custom_fields;
  const custom = list(cf) as Doc[];
  const rera = card.rera || reraNumber(str(custom.find((f) => f && f.visible !== false && /rera/i.test(str(f.label)))?.value));

  const facts: { k: string; v: string }[] = [];
  const land = pos(intake?.land_area_acres), towers = pos(intake?.towers), floors = pos(intake?.floors), units = pos(intake?.total_units);
  if (land) facts.push({ k: 'Land parcel', v: `${+land.toFixed(2)} ${land === 1 ? 'Acre' : 'Acres'}` });
  if (towers) facts.push({ k: 'No. of towers', v: `${towers} ${towers === 1 ? 'Tower' : 'Towers'}` });
  if (floors) facts.push({ k: 'No. of floors', v: `${floors} Floors` });
  if (units) facts.push({ k: 'Total units', v: `${units.toLocaleString('en-IN')} Units` });

  const configs = list(intake?.configurations).length
    ? list(intake?.configurations).map(str).filter(Boolean)
    : (card.bhk ? card.bhk.replace(/ BHK$/, '').split(', ').map((b) => `${b} BHK`) : []);

  // Unit-type table from the intake ("Unit types, carpet area & price"); values shown as entered.
  const unitRows: UnitRow[] = list(intake?.unit_mix)
    .map((r) => r as Doc)
    .map((r) => ({ config: str(r.config).slice(0, 60), area: str(r.area).slice(0, 60), price: str(r.price).slice(0, 60) }))
    .filter((r) => r.config)
    .slice(0, 12);

  const usp = str(pin.key_usp) || str(intake?.key_usps);
  const amenities = list(intake?.amenities).map(str).filter(Boolean);
  const highlights = [
    card.locality && `Prime ${card.locality} location`,
    amenities.length ? `${amenities.length}+ lifestyle amenities` : '',
    configs.length ? `Spacious ${configs.join(', ')}` : '',
    ...usp.split(/\s*[|•;\n]\s*/).filter((s) => s && s.length <= 60),
  ].filter(Boolean).slice(0, 4) as string[];

  const ytOk = (u: string) => (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(u) ? u : '');
  const greenCert = str(intake?.green_certification);
  return {
    ...card,
    rera,
    href: `/projects/${slugForProject(pin)}`,
    type: pin.type ? typeLabel(pin.type) : '',
    usp,
    about: str(pin.description) || str(intake?.short_description),
    logo,
    photos: photos.slice(0, 10),
    video: ytOk(str(pin.youtube_video_url)) || ytOk(str(intake?.youtube_url)),
    brochure: mediaUrl(intake?.brochure_url) || mediaUrl(raw.brochure_url),
    floorPlans: list(intake?.floor_plan_urls).map(mediaUrl).filter(Boolean).slice(0, 10),
    paymentPlan: mediaUrl(intake?.payment_plan_url),
    tour360: /^https:\/\//.test(str(intake?.tour_360_url)) ? str(intake?.tour_360_url) : '',
    facts,
    configs,
    units: unitRows,
    highlights,
    green: greenCert && !/^none$/i.test(greenCert) ? [`${greenCert} certified`, str(intake?.green_rating) && `${str(intake?.green_rating)} rating`].filter(Boolean).join(' · ') : '',
  };
}
