import { query } from '@/lib/pg';
import { usingMongo } from '@/lib/mongodb';
import { cachedRead } from '@/lib/data-cache';
import { publicImageUrl } from './public-media';

// Official project photos for the SEO project pages.
//
// A public pin is linked to its published project record through
// pins.intake_project_id → projects.id. The project record holds the photos
// the team collected from the developer's official site (cover_image_url,
// gallery_urls), stored in the public project-media bucket. The pin's own
// `image` is usually the developer's LOGO, so it stays only as the fallback.
//
// One query loads every live project's photos (≈1k rows, a few URLs each) and
// the result is shared through the data cache; project and pin writes clear it
// (bustTable('projects') in lib/partners-engine.ts, invalidateTable('pins')).

export interface ProjectPhotos {
  /** Public, crawlable cover image path (/media/project/…), if any. */
  cover?: string;
  /** Public gallery image paths (cover first, no duplicates), max 12. */
  gallery: string[];
}

const MAX_GALLERY = 12;

const readAllPhotos = cachedRead('seo-project-photos', ['projects', 'pins'], 3600, async (): Promise<Record<string, ProjectPhotos>> => {
  if (usingMongo()) return {};
  const { rows } = await query<{ id: string; cover: string | null; gallery: unknown }>(
    `SELECT id, doc->>'cover_image_url' AS cover, doc->'gallery_urls' AS gallery
       FROM projects
      WHERE (doc->>'is_live') = 'true'
        AND (coalesce(doc->>'cover_image_url', '') <> ''
             OR (jsonb_typeof(doc->'gallery_urls') = 'array' AND jsonb_array_length(doc->'gallery_urls') > 0))`,
  );
  const out: Record<string, ProjectPhotos> = {};
  for (const r of rows) {
    const urls = [r.cover, ...(Array.isArray(r.gallery) ? r.gallery : [])]
      .filter((u): u is string => typeof u === 'string' && !!u.trim())
      .map((u) => publicImageUrl(u.trim()))
      // Only images that have a crawlable public address (project-media bucket).
      .filter((u): u is string => !!u && u.startsWith('/media/project/'));
    const gallery = [...new Set(urls)].slice(0, MAX_GALLERY);
    if (!gallery.length) continue;
    const cover = r.cover ? publicImageUrl(r.cover.trim()) : undefined;
    out[r.id] = { cover: cover && cover.startsWith('/media/project/') ? cover : gallery[0], gallery };
  }
  return out;
});

/** Official photos for the project a pin is linked to (empty when none). */
export async function getProjectPhotos(intakeProjectId?: string | null): Promise<ProjectPhotos> {
  if (!intakeProjectId) return { gallery: [] };
  try {
    const all = await readAllPhotos();
    return all[intakeProjectId] || { gallery: [] };
  } catch (e) {
    // Photos are an enhancement: a failed read must never break the project page.
    console.warn('[seo] project photos read failed:', (e as Error)?.message || e);
    return { gallery: [] };
  }
}

/** Same photo, resized by the storage handler (WebP thumbnail). */
export const sized = (path: string, width: number): string => `${path}${path.includes('?') ? '&' : '?'}w=${width}`;
