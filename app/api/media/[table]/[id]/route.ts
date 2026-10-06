import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getStaffUser } from '@/lib/auth';
import { MEDIA_FIELDS } from '@/lib/pin-media';
import { cacheGet, encodeShared, mediaKey, versionMatches, type Encoded } from '@/lib/media-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Serves an image stored inside a map document (pin logo/brochure, infra icon)
// as a real image file: /api/media/<table>/<id>?f=<field>&v=<hash>[&w=<px>].
// URLs carry a content hash, so responses are cached for a year; ?w= returns a
// small thumbnail (map markers only need ~96px). Only whitelisted public map
// tables/fields are reachable. Encoded results are cached in-process (see
// lib/media-cache.ts), so repeat requests skip the database and sharp.
const CACHE_FOREVER = 'public, max-age=31536000, s-maxage=31536000, immutable';
const notFound = () => new NextResponse('Not found', { status: 404 });

function imageResponse({ bytes, mime }: Encoded, cacheControl: string) {
  return new NextResponse(bytes, {
    headers: { 'Content-Type': mime, 'Content-Length': String(bytes.length), 'Cache-Control': cacheControl },
  });
}

export async function GET(req: NextRequest, { params }: { params: { table: string; id: string } }) {
  const fields = MEDIA_FIELDS[params.table];
  const field = req.nextUrl.searchParams.get('f') || '';
  if (!fields || !fields.includes(field)) return notFound();
  const w = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('w') || '', 10) || 0, 0), 1600);
  const v = req.nextUrl.searchParams.get('v') || '';
  const key = mediaKey(params.table, params.id, field, v, w);

  // Only versioned (public, content-addressed) entries are ever cached.
  const cached = v ? cacheGet(key) : undefined;
  if (cached) return imageResponse(cached, CACHE_FOREVER);

  const db = await getDb();
  const doc = await db.collection<{ _id: string; [k: string]: unknown }>(params.table)
    .findOne({ id: params.id }, { projection: { [field]: 1, hidden: 1 } });
  // Images of pins hidden from the public map are staff-only (and never cached publicly).
  const isHiddenPin = params.table === 'pins' && doc?.hidden === true;
  if (isHiddenPin && !(await getStaffUser())) return notFound();
  const value = doc?.[field];
  if (typeof value !== 'string' || !value) return notFound();

  // Older rows may hold a plain URL instead of inline data — just send the browser there.
  if (!value.startsWith('data:')) {
    return /^https?:\/\//.test(value) ? NextResponse.redirect(value, 302) : notFound();
  }

  const encoded = await encodeShared(key, value, w, !isHiddenPin && versionMatches(value, v));
  if (!encoded) return notFound();
  return imageResponse(encoded, isHiddenPin ? 'private, no-store' : CACHE_FOREVER);
}
