import { localitiesOf } from '../locality';
import { abs } from '../seo/config';
import { slugify, projectSlug } from '../seo/slug';
import { cityFrom, CITY_LABELS } from '../seo/city';
import { displayDeveloperName } from '../seo/developer-name';
import { isPropertyProject } from '../seo/project-filter';

// Explicit, allow-listed response shapes. A serializer only ever copies the
// fields named here — never a whole database row — so internal fields (hidden,
// pending_review, rejected, source, owner_user_id, intake ids, brochures,
// custom fields, editor settings…) can't leak, even through nested objects.
//
// Per-field visibility: admins can hide a field from a project's public card
// (pins.field_visibility[<id>] === false). The API honours the same switches
// as the live map's card and compare table (app/api/my/compare/route.ts).

/** A pin row as loaded by data.ts (only these columns are ever read). */
export interface PinRow {
  id: string;
  number?: number | string;
  title?: string;
  type?: string;
  status?: string;
  price?: string;
  configuration?: string;
  sqft?: string | number;
  possession_timeline?: string;
  launch_date?: string;
  developer?: string;
  location?: string;
  key_usp?: string;
  description?: string;
  rera_number?: string;
  lat?: number | string;
  lng?: number | string;
  youtube_video_url?: string;
  /** Already converted to a URL by withMediaUrls (or an http URL). */
  image?: string;
  image_url?: string;
  field_visibility?: Record<string, unknown>;
  hidden?: unknown;
  pending_review?: unknown;
  rejected?: unknown;
  updated_at?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const url = (v: unknown): string | null => {
  const s = str(v);
  if (!s || s.startsWith('data:')) return null;
  return /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? abs(s) : null;
};

/** Public on the site: not switched off, not awaiting review, not rejected. */
export function isPublicPin(p: Pick<PinRow, 'hidden' | 'pending_review' | 'rejected'>): boolean {
  const on = (v: unknown) => v === true || v === 'true';
  return !on(p.hidden) && !on(p.pending_review) && !on(p.rejected);
}

export const visible = (p: PinRow, id: string) => (p.field_visibility || {})[id] !== false;

/** DB status → stable API value. */
export function apiStatus(s?: string): 'upcoming' | 'under_construction' | 'ready_to_move' | 'sold' | null {
  switch ((s || '').toLowerCase()) {
    case 'upcoming': return 'upcoming';
    case 'construction':
    case 'under_construction': return 'under_construction';
    case 'available': return 'ready_to_move';
    case 'sold': return 'sold';
    default: return null;
  }
}
export const STATUS_LABELS = { upcoming: 'Upcoming', under_construction: 'Under construction', ready_to_move: 'Ready to move', sold: 'Sold out' } as const;

export const pinNumber = (p: PinRow) => num(p.number);
export const primaryLocalityOf = (p: PinRow) => localitiesOf(p.location)[0] || '';
export const projectSlugOf = (p: PinRow) => projectSlug(p.title, primaryLocalityOf(p), pinNumber(p) || 0);
export const coordsOf = (p: PinRow) => {
  const lat = num(p.lat), lng = num(p.lng);
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
export const cityKeyOf = (p: PinRow) => cityFrom(p.location, num(p.lat) ?? undefined, num(p.lng) ?? undefined);
export const developerNameOf = (p: PinRow) => (visible(p, 'developer') ? displayDeveloperName(p.developer) || null : null);
export const isProject = (p: PinRow) => isPropertyProject({ title: p.title, type: p.type, price: p.price, configuration: p.configuration });

export interface ApiProjectSummary {
  id: number;
  slug: string;
  url: string;
  name: string | null;
  developer: { id: string; name: string } | null;
  property_type: string | null;
  status: ReturnType<typeof apiStatus>;
  status_label: string | null;
  configuration: string | null;
  price: string | null;
  possession: string | null;
  locality: { id: string; name: string } | null;
  city: { id: string; name: string };
  coordinates: { lat: number; lng: number } | null;
  image_url: string | null;
  updated_at: string | null;
}

export interface ApiProject extends ApiProjectSummary {
  description: string | null;
  highlights: string | null;
  address: string | null;
  area_sqft: string | null;
  launch_date: string | null;
  rera_number: string | null;
  video_url: string | null;
}

export function serializeProjectSummary(p: PinRow): ApiProjectSummary {
  const n = pinNumber(p) || 0;
  const slug = projectSlugOf(p);
  const status = visible(p, 'status') ? apiStatus(p.status) : null;
  const dev = developerNameOf(p);
  const loc = visible(p, 'location') ? primaryLocalityOf(p) : '';
  const city = cityKeyOf(p);
  return {
    id: n,
    slug,
    url: abs(`/projects/${slug}`),
    name: visible(p, 'name') ? str(p.title) : null,
    developer: dev ? { id: slugify(dev), name: dev } : null,
    property_type: visible(p, 'type') ? str(p.type) : null,
    status,
    status_label: status ? STATUS_LABELS[status] : null,
    configuration: visible(p, 'configuration') ? str(p.configuration) : null,
    price: visible(p, 'price') ? str(p.price) : null,
    possession: visible(p, 'possession') ? str(p.possession_timeline) : null,
    locality: loc ? { id: slugify(loc), name: loc } : null,
    city: { id: city, name: CITY_LABELS[city] },
    coordinates: coordsOf(p),
    image_url: url(p.image) || url(p.image_url),
    updated_at: str(p.updated_at),
  };
}

export function serializeProject(p: PinRow): ApiProject {
  const rera = visible(p, 'rera') ? str(p.rera_number) : null;
  return {
    ...serializeProjectSummary(p),
    description: str(p.description),
    highlights: visible(p, 'key_usp') ? str(p.key_usp) : null,
    address: visible(p, 'location') ? str(p.location) : null,
    area_sqft: visible(p, 'configuration') ? str(p.sqft) : null,
    launch_date: visible(p, 'possession') ? str(p.launch_date) : null,
    // As listed by the developer. Mappingg does not certify it; verify on MahaRERA.
    rera_number: rera && /^[A-Z]{1,3}[A-Z0-9/-]{6,}$/i.test(rera) ? rera : null,
    video_url: /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(p.youtube_video_url || '') ? p.youtube_video_url!.trim() : null,
  };
}

/** Lightweight marker for /map/pins (same idea as the public map's /api/map/pins). */
export function serializeMapPin(p: PinRow) {
  const s = serializeProjectSummary(p);
  return {
    id: s.id, slug: s.slug, url: s.url, name: s.name, developer: s.developer?.name ?? null, status: s.status,
    property_type: s.property_type, locality: s.locality?.name ?? null, coordinates: s.coordinates!,
  };
}

export interface BlogRow {
  id: string; slug: string; title: string; excerpt?: string; content?: string; cover_image?: string; tags?: string[];
  author?: string; status?: string; published_at?: string | null; created_at?: string; updated_at?: string;
  seo_title?: string; seo_description?: string;
}

export function serializeBlogSummary(b: BlogRow) {
  const words = (b.content || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return {
    id: b.id,
    slug: b.slug,
    url: abs(`/blog/${b.slug}`),
    title: b.title,
    excerpt: str(b.excerpt),
    description: str(b.seo_description) || str(b.excerpt),
    tags: Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === 'string').slice(0, 20) : [],
    author: str(b.author) || 'Mappingg Team',
    cover_image_url: url(b.cover_image),
    reading_minutes: Math.max(1, Math.round(words / 200)),
    published_at: str(b.published_at) || str(b.created_at),
    updated_at: str(b.updated_at),
  };
}

export function serializeBlog(b: BlogRow) {
  return { ...serializeBlogSummary(b), content_html: b.content || '' };
}

export interface InfraRow { id: string; title?: string; type?: string; lat?: number | string; lng?: number | string; updated_at?: string }

export function serializeInfra(m: InfraRow, labels: Record<string, string>) {
  const lat = num(m.lat), lng = num(m.lng);
  const type = str(m.type) || 'other';
  return {
    id: m.id,
    name: str(m.title),
    type,
    type_label: labels[type] || type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    coordinates: lat != null && lng != null ? { lat, lng } : null,
    updated_at: str(m.updated_at),
  };
}
