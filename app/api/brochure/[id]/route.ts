import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isStaffRole, type SessionUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { loadPartnersFile } from '@/lib/partners-media';
import { verificationOf } from '@/lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A project's brochure (PDF or image, the pin's `brochure_url`) for the live
// map's "Brochure" button: /api/brochure/<pin id>[?download=1].
//   - Approved agents / channel partners and staff may view and download it.
//   - Everyone else (buyers, developers, visitors) may only view it: the map
//     draws it in its own viewer with no download button, and ?download=1 is
//     refused. Public pin reads never carry the file's own URL (see
//     app/api/db), so this route is the only way to it.
const STREAM_OVER = 4 * 1024 * 1024;
const STREAM_PIECE = 256 * 1024;
const notFound = () => NextResponse.json({ error: { message: 'No brochure for this project.' } }, { status: 404 });

/** Agents / channel partners (once approved) and staff may download brochures. */
async function canDownloadBrochure(user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  if (isStaffRole(user.role)) return true;
  if (user.role !== 'agent') return false;
  const doc = await (await getDb()).collection('users')
    .findOne({ email: user.email.toLowerCase() }, { projection: { role: 1, verification: 1, verified: 1 } });
  return !!doc && verificationOf(doc) === 'approved';
}

async function loadBrochure(url: string, origin: string): Promise<{ type: string; data: Buffer } | null> {
  // Uploaded through Projects Intake: /api/partners/storage?bucket=…&path=…&public=1
  if (url.startsWith('/api/partners/storage')) {
    const q = new URL(url, origin).searchParams;
    const bucket = q.get('bucket'), path = q.get('path');
    if (bucket !== 'project-media' || !path) return null;
    const f = await loadPartnersFile(`${bucket}/${path}`);
    return f ? { type: f.content_type || 'application/octet-stream', data: f.data } : null;
  }
  // Older pins point at a file in public storage.
  if (/^https:\/\//.test(url)) {
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) return null;
    return { type: res.headers.get('content-type') || 'application/octet-stream', data: Buffer.from(await res.arrayBuffer()) };
  }
  return null;
}

function fileName(title: string, type: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  const ext = type.includes('pdf') ? 'pdf' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.startsWith('image/') ? 'jpg' : 'bin';
  return `${base}-brochure.${ext}`;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const download = req.nextUrl.searchParams.get('download') === '1';
  if (download && !(await canDownloadBrochure(user))) {
    return NextResponse.json({ error: { message: 'Brochure download is only for channel partners.' } }, { status: 403 });
  }

  const pin = await (await getDb()).collection('pins')
    .findOne({ id: params.id }, { projection: { brochure_url: 1, title: 1, hidden: 1 } });
  const url = typeof pin?.brochure_url === 'string' ? pin.brochure_url.trim() : '';
  if (!pin || !url || (pin.hidden === true && !isStaffRole(user?.role))) return notFound();

  const file = await loadBrochure(url, req.nextUrl.origin);
  if (!file) return notFound();
  const type = file.type.split(';')[0].trim();
  if (type !== 'application/pdf' && !type.startsWith('image/')) return notFound();

  const name = fileName(String(pin.title || ''), type);
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const body = file.data;
  // Over Vercel's 4.5 MB response limit: stream it in pieces.
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
  return new NextResponse(new Uint8Array(body), { status: 200, headers: { ...headers, 'Content-Length': String(body.byteLength) } });
}
