import { NextRequest, NextResponse } from 'next/server';
import { getMediaMeta, readParts } from '@/lib/wa-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Public link of a file uploaded in s-admin → WhatsApp, fetched by WhatsApp when
// the message goes out. Streamed, so files over Vercel's 4.5 MB response limit work.
// Uploads come from staff, but anything that a browser could run (HTML, SVG, scripts…) is still served as a download.
const INLINE = /^(image\/(jpeg|png)|video\/(mp4|3gpp)|audio\/[\w.+-]+|application\/pdf|text\/plain)$/i;

export async function GET(_req: NextRequest, { params }: { params: { id: string; name: string } }) {
  const m = await getMediaMeta(params.id).catch(() => null);
  if (!m || !m.complete) return new NextResponse('Not found', { status: 404 });
  const parts = readParts(m);
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await parts.next();
        if (done) ctrl.close(); else ctrl.enqueue(value);
      } catch (e) { ctrl.error(e); }
    },
  });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': INLINE.test(m.mime) ? m.mime : 'application/octet-stream',
      'Content-Length': String(m.size),
      'Content-Disposition': `${INLINE.test(m.mime) ? 'inline' : 'attachment'}; filename="${m.name.replace(/["\\\r\n]/g, '')}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
