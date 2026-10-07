import { runDbOp } from './db-engine';
import { mediaUrl } from './pin-media';

// Picks one real Mantra project that has a YouTube video, for the home page's
// "Make every property easy to understand" card. The card mirrors the public
// map's project card (teaser-card in public/legacy/public-map.json), so the
// same fields and the admin's per-project "Public Card Visibility" apply.

export interface FeaturedProject {
  id: string;
  title: string;
  logo: string | null;
  videoId: string;
  developer?: string;
  location?: string;
  status: string;
  statusKey: string;
  type?: string;
  rera?: string;
  configuration?: string;
  price?: string;
  possession?: string;
  keyUsp?: string;
}

type Pin = Record<string, unknown> & { id: string };

// Only this developer's projects are featured on the home page card.
const FEATURED_DEVELOPER = /\bmantra\b/i;

const STATUS_LABEL: Record<string, string> = {
  available: 'Available', sold: 'Sold Out', construction: 'Under Construction', upcoming: 'Upcoming',
};

/** Same parsing as the public map's extractYouTubeId. */
export function youTubeId(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.hostname.replace('www.', '') === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export async function getFeaturedProject(): Promise<FeaturedProject | null> {
  try {
    // Light scan first (no images), then load only the chosen project in full.
    const list = await runDbOp(
      { table: 'pins', action: 'select', columns: 'id,title,developer,status,youtube_video_url,image,field_visibility' },
      false,
    );
    if (list.error || !Array.isArray(list.data)) return null;
    const candidates = (list.data as Pin[]).filter((p) => {
      const vis = (p.field_visibility || {}) as Record<string, unknown>;
      return FEATURED_DEVELOPER.test(String(p.developer || '')) && youTubeId(p.youtube_video_url) && str(p.title) && p.image && p.status !== 'sold' && vis.name !== false;
    });
    if (!candidates.length) return null;
    // A different project each time the page is regenerated (ISR, every 10 min).
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    const one = await runDbOp(
      { table: 'pins', action: 'select', filters: [{ op: 'eq', col: 'id', val: pick.id }], single: true },
      false,
    );
    if (one.error || !one.data) return null;
    const p = one.data as Pin;
    const vis = (p.field_visibility || {}) as Record<string, unknown>;
    const on = (id: string) => vis[id] !== false;
    const status = str(p.status) || 'available';
    const image = str(p.image);
    const configuration = [str(p.configuration), str(p.sqft)].filter(Boolean).join(' · ');
    const possession = status === 'upcoming'
      ? (str(p.launch_date) ? `Launching: ${str(p.launch_date)}` : undefined)
      : (str(p.possession_timeline) ? `Possession: ${str(p.possession_timeline)}` : undefined);

    return {
      id: p.id,
      title: str(p.title)!,
      // Shown at 128px — a 2x (256px) thumbnail instead of the full-size upload.
      logo: image ? (image.startsWith('data:') ? mediaUrl('pins', p.id, 'image', image, 256) : image.startsWith('/api/partners/storage?') ? image + '&w=256' : image) : null,
      videoId: youTubeId(p.youtube_video_url)!,
      developer: on('developer') ? str(p.developer) : undefined,
      location: on('location') ? str(p.location) : undefined,
      status: on('status') ? (STATUS_LABEL[status] || 'Available') : '',
      statusKey: STATUS_LABEL[status] ? status : 'available',
      type: on('type') ? str(p.type) : undefined,
      rera: on('rera') ? str(p.rera_number) : undefined,
      configuration: on('configuration') && configuration ? configuration : undefined,
      price: on('price') ? str(p.price) : undefined,
      possession: on('possession') ? possession : undefined,
      keyUsp: on('key_usp') ? str(p.key_usp) : undefined,
    };
  } catch {
    return null;
  }
}
