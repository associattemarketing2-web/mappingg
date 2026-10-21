import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { trimLogo } from '@/lib/media-cache';
import { query } from '@/lib/pg';
import { usingMongo } from '@/lib/mongodb';
import { loadPartnersFile, partnersGridfs } from '@/lib/partners-media';
import { getStaffUser } from '@/lib/auth';
import { tokenIsValid } from '@/lib/partners-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Partner media (submission + project images, brochures, RERA QR). Stored as
// rows in the `partners_media` table (bytea), keyed by "<bucket>/<path>". This
// used to be a MongoDB GridFS bucket.
const BUCKETS = new Set(['submission-media', 'project-media']);
const MAX_BYTES = 25 * 1024 * 1024;
// Vercel rejects a request (and an unstreamed response) over 4.5 MB before it
// reaches this function (413 FUNCTION_PAYLOAD_TOO_LARGE), which is why brochure
// PDFs failed with a server error. Bigger files are sent in parts (the browser
// splits them — public/partners/partners-shim.js), each part kept as its own
// temporary row until the last one arrives and the file is put back together.
const MAX_PARTS = Math.ceil(MAX_BYTES / (3 * 1024 * 1024)) + 1;
const partKey = (uploadId: string, i: number) => `.parts/${uploadId}/${i}`;

function key(bucket: string, path: string) { return `${bucket}/${path}`; }

const gridfs = partnersGridfs;
const loadFile = loadPartnersFile;

async function saveFile(filename: string, contentType: string, metadata: Record<string, string>, buf: Buffer) {
  if (usingMongo()) {
    const bucket = await gridfs();
    for (const f of await bucket.find({ filename }).toArray()) await bucket.delete(f._id);
    await new Promise<void>((resolve, reject) => {
      const up = bucket.openUploadStream(filename, { metadata: { ...metadata, contentType } });
      up.on('finish', () => resolve()).on('error', reject);
      up.end(buf);
    });
    return;
  }
  // Overwrite semantics: drop any existing versions of this exact key first.
  await query(`DELETE FROM "partners_media" WHERE filename = $1`, [filename]);
  await query(
    `INSERT INTO "partners_media" (filename, content_type, metadata, data)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [filename, contentType, JSON.stringify(metadata), buf],
  );
}

async function deleteFile(filename: string) {
  if (usingMongo()) {
    const bucket = await gridfs();
    for (const f of await bucket.find({ filename }).toArray()) await bucket.delete(f._id);
    return;
  }
  await query(`DELETE FROM "partners_media" WHERE filename = $1`, [filename]);
}

// Small WebP thumbnails (?w=96 for map markers) of public project images, kept
// in-process so repeat marker loads skip the database and sharp entirely.
const THUMBS = new Map<string, Uint8Array<ArrayBuffer>>();
const MAX_THUMBS = 2000;
// trim crops the empty border around a logo first (see trimLogo).
async function thumbnail(bytes: Buffer, width: number, trim = false): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const src = trim ? await trimLogo(bytes).catch(() => bytes) : bytes;
    return new Uint8Array(await sharp(src).rotate()
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

  let buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ data: null, error: { message: 'File is larger than 25 MB.' } }, { status: 413 });
  }

  // One part of a bigger file: part / parts / uploadId (see the note at the top).
  const parts = Number(form.get('parts') || 1);
  if (parts > 1) {
    const part = Number(form.get('part'));
    const uploadId = String(form.get('uploadId') || '');
    if (!Number.isInteger(parts) || parts > MAX_PARTS || !Number.isInteger(part) || part < 0 || part >= parts || !/^[A-Za-z0-9-]{8,64}$/.test(uploadId)) {
      return NextResponse.json({ data: null, error: { message: 'Invalid upload part' } }, { status: 400 });
    }
    const partName = key(bucketName, partKey(uploadId, part));
    if (part < parts - 1) {
      await saveFile(partName, 'application/octet-stream', { bucket: bucketName, path, part: String(part) }, buf);
      return NextResponse.json({ data: { path, part }, error: null });
    }
    // Last part: put the file back together from the earlier ones.
    const chunks: Buffer[] = [];
    for (let i = 0; i < parts - 1; i++) {
      const prev = await loadFile(key(bucketName, partKey(uploadId, i)));
      if (!prev) return NextResponse.json({ data: null, error: { message: 'Upload was interrupted — please try again.' } }, { status: 409 });
      chunks.push(prev.data);
    }
    chunks.push(buf);
    buf = Buffer.concat(chunks);
    for (let i = 0; i < parts - 1; i++) await deleteFile(key(bucketName, partKey(uploadId, i))).catch(() => {});
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ data: null, error: { message: 'File is larger than 25 MB.' } }, { status: 413 });
    }
  }

  const filename = key(bucketName, path);
  await saveFile(filename, contentType, { bucket: bucketName, path }, buf);

  return NextResponse.json({ data: { path }, error: null });
}

// ----------------------------------------------------------------- serve
const STREAM_OVER = 4 * 1024 * 1024;
const STREAM_PIECE = 256 * 1024;
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
  const trim = w > 0 && req.nextUrl.searchParams.get('trim') === '1';
  const thumbKey = `${filename}@${w}${trim ? 't' : ''}`;
  const hit = publicMedia && w ? THUMBS.get(thumbKey) : undefined;
  if (hit) {
    return new NextResponse(hit, { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(hit.byteLength), 'Cache-Control': publicCache } });
  }

  const fileDoc = await loadFile(filename);
  if (!fileDoc) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });

  const body = fileDoc.data;
  const ct = fileDoc.content_type || 'application/octet-stream';
  if (publicMedia && w && ct.startsWith('image/') && ct !== 'image/svg+xml') {
    const small = await thumbnail(body, w, trim);
    if (small) {
      if (THUMBS.size >= MAX_THUMBS) THUMBS.delete(THUMBS.keys().next().value as string);
      THUMBS.set(thumbKey, small);
      return new NextResponse(small, { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(small.byteLength), 'Cache-Control': publicCache } });
    }
  }
  const headers: Record<string, string> = { 'Content-Type': ct, 'Cache-Control': isPublic ? publicCache : 'private, no-store' };
  // Files over Vercel's 4.5 MB response limit (brochure PDFs) are streamed in pieces.
  if (body.byteLength > STREAM_OVER) {
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (at >= body.byteLength) { ctrl.close(); return; }
        ctrl.enqueue(new Uint8Array(body.subarray(at, at + STREAM_PIECE)));
        at += STREAM_PIECE;
      },
    });
    return new NextResponse(stream, { status: 200, headers });
  }
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(body.byteLength) },
  });
}
