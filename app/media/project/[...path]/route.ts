import { NextRequest, NextResponse } from 'next/server';
import { GET as storageGet } from '@/app/api/partners/storage/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /media/project/<path>[?w=<px>] — the crawlable public address of an official
// project photo (robots.txt keeps /api/ blocked, so the original
// /api/partners/storage?bucket=project-media&path=…&public=1 address could never
// be indexed by Google Images). It forwards to that same handler with the same
// rules: only the public project-media bucket, and only image files — brochure
// PDFs and every other bucket have no /media/ address.
const IMAGE = /\.(?:jpe?g|png|webp|avif|gif)$/i;

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = (params.path || []).join('/');
  if (!path || !IMAGE.test(path) || path.includes('..')) return new NextResponse('Not found', { status: 404 });
  const target = new URL('/api/partners/storage', req.url);
  target.searchParams.set('bucket', 'project-media');
  target.searchParams.set('path', path);
  target.searchParams.set('public', '1');
  const w = req.nextUrl.searchParams.get('w');
  if (w && /^\d{1,4}$/.test(w)) target.searchParams.set('w', w);
  const trim = req.nextUrl.searchParams.get('trim');
  if (trim === '1') target.searchParams.set('trim', '1');
  return storageGet(new NextRequest(target, { headers: req.headers }));
}
