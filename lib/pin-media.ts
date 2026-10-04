import { createHash } from 'node:crypto';

// Pin logos/brochures and infrastructure icons are stored inside their
// documents as base64 data: URLs (~5 MB across all pins). Shipping them inside
// every JSON list made the maps download all of it on every load — painfully
// slow on iPads and phones. Instead, API responses carry a short,
// content-versioned URL that /api/media/[table]/[id] serves as a real,
// long-cached image file.

/** Tables and fields whose data: URLs are served via /api/media. */
export const MEDIA_FIELDS: Record<string, readonly string[]> = {
  pins: ['image', 'brochure_image'],
  infra_markers: ['icon_image'],
};

// Backward-compatible CDN metadata written into a pin's JSONB `doc` by the
// image migration. When `status === 'completed'` the public pages serve
// `imageUrl`/`thumbnailUrl` straight from the CDN; until then they fall back to
// the base64-backed /api/media route, so nothing ever breaks mid-migration.
export interface ImageMeta {
  imageUrl?: string;
  thumbnailUrl?: string;
  storageKey?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  fileSize?: number;
  alt?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  migratedAt?: string;
}

/** Resolve the best image URL for a migrated pin's `image`, or null if not migrated. */
function cdnImageFor(row: Record<string, unknown>, width?: number): string | null {
  const meta = row.image_meta as ImageMeta | undefined;
  if (!meta || meta.status !== 'completed' || !meta.imageUrl) return null;
  // Prefer the smaller thumbnail for small requests (cards/markers).
  if (width && width <= 500 && meta.thumbnailUrl) return meta.thumbnailUrl;
  return meta.imageUrl;
}

/** Short content hash, so the URL (and the browser cache) changes only when the image does. */
export function mediaVersion(dataUrl: string): string {
  return createHash('sha1').update(dataUrl).digest('base64url').slice(0, 12);
}

export function mediaUrl(table: string, id: string, field: string, dataUrl: string, width?: number): string {
  const w = width ? `&w=${Math.round(width)}` : '';
  return `/api/media/${table}/${encodeURIComponent(id)}?f=${field}&v=${mediaVersion(dataUrl)}${w}`;
}

/**
 * Replaces inline data: URLs on rows of `table` with their cacheable image URLs.
 * Other values pass through. Pass `{ width }` to request an optimized, resized
 * WebP (served by /api/media) instead of the full-size original — used by the
 * public SEO pages so project covers aren't multi-MB.
 */
export function withMediaUrls<T>(table: string, data: T, opts: { width?: number } = {}): T {
  const fields = MEDIA_FIELDS[table];
  if (!fields) return data;
  const fix = (row: unknown) => {
    if (!row || typeof row !== 'object') return row;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string') return row;
    let out: Record<string, unknown> | null = null;
    // Migrated pins: serve the CDN image instead of the base64 /api/media route.
    if (table === 'pins') {
      const cdn = cdnImageFor(r, opts.width);
      if (cdn) {
        out = { ...r };
        out.image = cdn;
      }
    }
    for (const field of fields) {
      if (out && field === 'image' && out.image !== r.image) continue; // already set from CDN
      const v = r[field];
      if (typeof v === 'string' && v.startsWith('data:')) {
        out = out || { ...r };
        out[field] = mediaUrl(table, r.id, field, v, opts.width);
      }
    }
    return out || row;
  };
  return (Array.isArray(data) ? data.map(fix) : fix(data)) as T;
}

/** Decodes a base64 data: URL into its bytes and mime type, or null if it isn't one. */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { mime, bytes };
}
