// A map pin → a Projects Intake submission, so every project can be edited in the
// one full form (all intake fields), from wherever it is opened in the super-admin.
//
// Only values that the intake form can hold *exactly* are moved into its
// structured fields; anything else (a price like "₹ 98 Lacs – ₹ 1.35 Cr", a
// possession like "Ready", an uploaded pin photo) stays on the pin and is listed
// under "Additional details" for reference. Publishing such a submission updates
// the same pin and never blanks a value the form left empty (keepPinValues).
// Pure functions — no database access here (see lib/partners-engine.ts).

import { localitiesOf } from './locality';
import { cityFrom } from './seo/city';

type Doc = Record<string, any>;

/** The intake form's option lists (public/partners/shared/fields.js OPTIONS). */
export const INTAKE_CONFIGURATIONS = ['Studio', '1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '5+ BHK',
  'Villa', 'Row House', 'Penthouse', 'Duplex', 'Plot', 'Shop', 'Office', 'Showroom', 'Co-working', 'Warehouse', 'Land'];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const s = (v: unknown) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** "Dec 2027" / "December 2027" / "2027-12" → "2027-12"; anything else → null. */
export function toMonth(v: unknown): string | null {
  const t = s(v).toLowerCase();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = /^([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(t);
  if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
  return null;
}

/** Pin status → intake construction / sales status (inverse of intake-pins mapStatus). */
export function toStatuses(status?: string): { construction_status: string | null; sales_status: string | null } {
  switch (s(status).toLowerCase()) {
    case 'available': return { construction_status: 'Ready to Move', sales_status: null };
    case 'construction':
    case 'under_construction': return { construction_status: 'Under Construction', sales_status: null };
    case 'upcoming': return { construction_status: 'Upcoming', sales_status: null };
    case 'sold': return { construction_status: null, sales_status: 'Sold Out' };
    default: return { construction_status: null, sales_status: null };
  }
}

/**
 * Configuration text → intake options, only when every part is recognised
 * ("2 BHK / 3 BHK", "2, 3 BHK & Shops", "Plot"). Otherwise null (kept on the pin).
 */
export function toConfigurations(v: unknown): string[] | null {
  const t = s(v);
  if (!t) return null;
  const out = new Set<string>();
  // "2, 3 & 4 BHK" → each number + BHK
  const bhk = /((?:\d(?:\.5)?\s*(?:,|&|and|\/)\s*)*\d(?:\.5)?)\s*bhk/gi;
  let rest = t.replace(bhk, (_m, nums: string) => {
    for (const n of nums.split(/\s*(?:,|&|and|\/)\s*/)) {
      const k = Number(n) >= 5 ? '5+ BHK' : `${n} BHK`;
      if (!INTAKE_CONFIGURATIONS.includes(k)) return _m; // e.g. 6.5 BHK — leave unmatched
      out.add(k);
    }
    return ' ';
  });
  for (const opt of INTAKE_CONFIGURATIONS) {
    if (/BHK$/.test(opt)) continue;
    const re = new RegExp(`\\b${opt.replace(/[-/]/g, '.')}s?\\b`, 'i');
    if (re.test(rest)) { out.add(opt); rest = rest.replace(new RegExp(`\\b${opt.replace(/[-/]/g, '.')}s?\\b`, 'gi'), ' '); }
  }
  // Anything left other than separators means we did not understand it all.
  if (rest.replace(/[\s,&/+|.-]|\band\b/gi, '')) return null;
  return out.size ? [...out] : null;
}

const UNITS: Record<string, string> = { cr: 'Crore', crore: 'Crore', crores: 'Crore', l: 'Lakh', lac: 'Lakh', lacs: 'Lakh', lakh: 'Lakh', lakhs: 'Lakh' };

/**
 * Price text → intake price fields, only for forms the intake can show the same way:
 * "Price on Request", "₹ 1.25 Cr Onwards", "₹ 92 – 139 L", "₹1.1 - 1.5 Cr".
 * Mixed units ("₹ 98 Lacs – ₹ 1.35 Cr") and notes ("Only for leasing") → null.
 */
export function toPrice(v: unknown): Doc | null {
  const t = s(v);
  if (!t) return null;
  if (/^price on request$|^on request$/i.test(t)) return { price_on_request: true };
  const n = '(\\d+(?:\\.\\d+)?)';
  const unit = '(cr|crores?|l|lacs?|lakhs?)';
  let m = new RegExp(`^(?:₹|rs\\.?|inr)?\\s*${n}\\s*${unit}\\.?\\s*(?:onwards|\\+)?$`, 'i').exec(t);
  if (m) return { currency: 'INR', price_min: Number(m[1]), price_max: null, price_unit: UNITS[m[2].toLowerCase()], price_on_request: false };
  m = new RegExp(`^(?:₹|rs\\.?|inr)?\\s*${n}\\s*(?:-|–|to)\\s*(?:₹|rs\\.?)?\\s*${n}\\s*${unit}\\.?$`, 'i').exec(t);
  if (m && Number(m[1]) < Number(m[2])) return { currency: 'INR', price_min: Number(m[1]), price_max: Number(m[2]), price_unit: UNITS[m[3].toLowerCase()], price_on_request: false };
  return null;
}

/** Carpet area text → min/max in sq ft: "1200", "1,050 - 1,450 sq ft", "850 sqft". */
export function toArea(v: unknown): Doc | null {
  const t = s(v).replace(/,/g, '');
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(?:sq\.?\s*ft\.?|sqft|sft)?$/i.exec(t);
  if (!m) return null;
  return { area_unit: 'sq ft', carpet_area_min: Number(m[1]), carpet_area_max: m[2] ? Number(m[2]) : null };
}

const CITY_NAMES: Record<string, string> = {
  pune: 'Pune', mumbai: 'Mumbai', bengaluru: 'Bengaluru', delhi: 'Delhi NCR', hyderabad: 'Hyderabad', nashik: 'Nashik', dubai: 'Dubai',
};

/**
 * The submission fields for a pin, plus `kept`: pin values the form could not hold
 * exactly (they stay on the pin and are listed under Additional details).
 */
export function pinToSubmission(pin: Doc): { fields: Doc; kept: { label: string; value: string }[] } {
  const kept: { label: string; value: string }[] = [];
  const keep = (label: string, value: unknown) => { const v = s(value); if (v) kept.push({ label, value: v }); };

  const cityKey = cityFrom(pin.location, pin.lat, pin.lng);
  const locality = localitiesOf(pin.location)[0] || null;
  const price = toPrice(pin.price);
  if (!price) keep('Price (as on the map)', pin.price);
  const configurations = toConfigurations(pin.configuration);
  if (!configurations) keep('Configuration (as on the map)', pin.configuration);
  const area = toArea(pin.sqft);
  if (!area) keep('Carpet / built-up area (as on the map)', pin.sqft);
  const possession = toMonth(pin.possession_timeline);
  if (!possession) keep('Possession (as on the map)', pin.possession_timeline);
  const launch = toMonth(pin.launch_date);
  if (!launch) keep('Launch (as on the map)', pin.launch_date);
  keep("What's available (as on the map)", pin.whats_available);

  const rera = s(pin.rera_number).split(/\s*[,;]\s*|\s+\/\s+|\s+/).filter((x) => x.length >= 6 && /\d{3,}/.test(x));
  if (s(pin.rera_number) && !rera.length) keep('RERA field (as on the map)', pin.rera_number);

  const fields: Doc = {
    project_name: s(pin.title) || null,
    developer_name: s(pin.developer) || null,
    project_type: s(pin.type) || null,
    ...toStatuses(pin.status),
    country: cityKey === 'dubai' ? 'United Arab Emirates' : 'India',
    city: CITY_NAMES[cityKey] || null,
    locality,
    address: s(pin.location) || null,
    lat: Number.isFinite(Number(pin.lat)) ? Number(pin.lat) : null,
    lng: Number.isFinite(Number(pin.lng)) ? Number(pin.lng) : null,
    ...(price || {}),
    configurations: configurations || [],
    ...(area || {}),
    possession_date_target: possession,
    launch_date: launch,
    rera_numbers: rera,
    key_usps: s(pin.key_usp) || null,
    short_description: s(pin.description) || null,
    youtube_url: s(pin.youtube_video_url) || null,
    featured: pin.highlighted === true,
  };
  return { fields, kept };
}

/**
 * Pin values to write when publishing a submission that was opened from an
 * existing pin: a value the form left empty never blanks what the pin shows.
 * (Normal intake publishing is unchanged and does not use this.)
 */
export function keepPinValues(fields: Doc, existing: Doc): Doc {
  const out: Doc = { ...fields };
  for (const [k, v] of Object.entries(fields)) {
    const empty = v == null || (typeof v === 'string' && !v.trim());
    if (empty && existing[k] != null && String(existing[k]).trim() !== '') delete out[k];
  }
  return out;
}
