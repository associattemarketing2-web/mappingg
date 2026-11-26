import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg';
import { canUseChat, gateway, GatewayError, viewer } from '@/lib/wa-linked';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The photo / video / audio / document of one message, streamed from the gateway (which fetches it from WhatsApp).
export async function GET(req: NextRequest) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const account = req.nextUrl.searchParams.get('account') || '';
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(account) || !/^[\w-]{4,80}$/.test(id)) return NextResponse.json({ error: { message: 'Bad request' } }, { status: 400 });
  const m = (await query<{ jid: string; media: { filename?: string } | null }>('SELECT jid, media FROM wl_messages WHERE account_id = $1 AND id = $2', [account, id])).rows[0];
  if (!m || !(await canUseChat(v, account, m.jid))) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });
  try {
    const res: Response = await gateway(`/accounts/${account}/media/${encodeURIComponent(id)}`, { raw: true, timeoutMs: 50_000 });
    const name = (m.media?.filename || 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    // Files come from customers: only plain photos / video / audio / PDF open in the browser; anything else
    // (HTML, SVG, scripts…) is downloaded, so it can never run inside the admin site.
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const inline = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp)|audio\/[\w.+-]+|application\/pdf)$/.test(type);
    return new Response(res.body, {
      headers: {
        'Content-Type': inline ? type : 'application/octet-stream',
        ...(res.headers.get('content-length') ? { 'Content-Length': res.headers.get('content-length')! } : {}),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
      },
    });
  } catch (e) {
    const status = e instanceof GatewayError ? e.status : 502;
    return NextResponse.json({ error: { message: (e as Error).message } }, { status });
  }
}
