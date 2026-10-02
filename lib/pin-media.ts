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

/** Short content hash, so the URL (and the browser cache) changes only when the image does. */
export function mediaVersion(dataUrl: string): string {
  return createHash('sha1').update(dataUrl).digest('base64url').slice(0, 12);
}

export function mediaUrl(table: string, id: string, field: string, dataUrl: string): string {
  return `/api/media/${table}/${encodeURIComponent(id)}?f=${field}&v=${mediaVersion(dataUrl)}`;
}

/** Replaces inline data: URLs on rows of `table` with their cacheable image URLs. Other values pass through. */
export function withMediaUrls<T>(table: string, data: T): T {
  const fields = MEDIA_FIELDS[table];
  if (!fields) return data;
  const fix = (row: unknown) => {
    if (!row || typeof row !== 'object') return row;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string') return row;
    let out: Record<string, unknown> | null = null;
    for (const field of fields) {
      const v = r[field];
      if (typeof v === 'string' && v.startsWith('data:')) {
        out = out || { ...r };
        out[field] = mediaUrl(table, r.id, field, v);
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
