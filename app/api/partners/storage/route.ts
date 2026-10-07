import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { query } from '@/lib/pg';
import { getStaffUser } from '@/lib/auth';
import { tokenIsValid } from '@/lib/partners-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Partner media (submission + project images, brochures, RERA QR). Stored as
// rows in the `partners_media` table (bytea), keyed by "<bucket>/<path>". This
// used to be a MongoDB GridFS bucket.
const BUCKETS = new Set(['submission-media', 'project-media']);
const MAX_BYTES = 25 * 1024 * 1024;

function key(bucket: string, path: string) { return `${bucket}/${path}`; }

// Small WebP thumbnails (?w=96 for map markers) of public project images, kept
// in-process so repeat marker loads skip the database and sharp entirely.
const THUMBS = new Map<string, Uint8Array<ArrayBuffer>>();
const MAX_THUMBS = 2000;
async function thumbnail(bytes: Buffer, width: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await sharp(bytes).rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer());
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- upload
export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ data: null, error: { message: 'Invalid upload' } }, { status: 400 });
  }
  const bucketName = String(form.get('bucket') || '');
  const path = String(form.get('path') || '');
  const file = form.get('file');
  const contentType = String(form.get('contentType') || '') || (file instanceof File ? file.type : '') || 'application/octet-stream';

  if (!BUCKETS.has(bucketName) || !path || !(file instanceof File)) {
    return NextResponse.json({ data: null, error: { message: 'Missing bucket, path or file' } }, { status: 400 });
  }

  // Authorize: a signed-in admin may upload anywhere; a builder may upload only
  // under their own active link folder (submission-media/links/<token>/…).
  const user = await getStaffUser();
  let allowed = !!user;
  if (!allowed) {
    const token = req.nextUrl.searchParams.get('t');
    if (token && bucketName === 'submission-media' && path.startsWith(`links/${token}/`)) {
      allowed = await tokenIsValid(token);
    }
  }
  if (!allowed) return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ data: null, error: { message: 'File is larger than 25 MB.' } }, { status: 413 });
  }

  const filename = key(bucketName, path);
  // Overwrite semantics: drop any existing versions of this exact key first.
  await query(`DELETE FROM "partners_media" WHERE filename = $1`, [filename]);
  await query(
    `INSERT INTO "partners_media" (filename, content_type, metadata, data)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [filename, contentType, JSON.stringify({ bucket: bucketName, path }), buf],
  );

  return NextResponse.json({ data: { path }, error: null });
}

// ----------------------------------------------------------------- serve
export async function GET(req: NextRequest) {
  const bucketName = req.nextUrl.searchParams.get('bucket') || '';
  const path = req.nextUrl.searchParams.get('path') || '';
  const isPublic = req.nextUrl.searchParams.get('public') === '1';
  if (!BUCKETS.has(bucketName) || !path) {
    return NextResponse.json({ error: { message: 'Missing bucket or path' } }, { status: 400 });
  }

  // project-media is public (shown on the live map); everything else is private.
  if (!(isPublic && bucketName === 'project-media')) {
    if (!(await getStaffUser())) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }

  const filename = key(bucketName, path);
  const publicMedia = isPublic && bucketName === 'project-media';
  const w = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('w') || '', 10) || 0, 0), 1600);
  // Public images rarely change: let browsers reuse them for a day and refresh
  // in the background for a week (was 1 hour, which Lighthouse flagged).
  const publicCache = 'public, max-age=86400, stale-while-revalidate=604800';
  const thumbKey = `${filename}@${w}`;
  const hit = publicMedia && w ? THUMBS.get(thumbKey) : undefined;
  if (hit) {
    return new NextResponse(hit, { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(hit.byteLength), 'Cache-Control': publicCache } });
  }

  const res = await query<{ content_type: string; data: Buffer }>(
    `SELECT content_type, data FROM "partners_media" WHERE filename = $1 ORDER BY upload_date DESC LIMIT 1`,
    [filename],
  );
  const fileDoc = res.rows[0];
  if (!fileDoc) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });

  const body = fileDoc.data;
  const ct = fileDoc.content_type || 'application/octet-stream';
  if (publicMedia && w && ct.startsWith('image/') && ct !== 'image/svg+xml') {
    const small = await thumbnail(body, w);
    if (small) {
      if (THUMBS.size >= MAX_THUMBS) THUMBS.delete(THUMBS.keys().next().value as string);
      THUMBS.set(thumbKey, small);
      return new NextResponse(small, { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(small.byteLength), 'Cache-Control': publicCache } });
    }
  }
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': ct,
      'Content-Length': String(body.byteLength),
      'Cache-Control': isPublic ? publicCache : 'private, no-store',
    },
  });
}
