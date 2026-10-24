import { NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { handleGoogleWebhook } from '@/lib/lead-sources/google-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Google Ads lead form webhook. Authenticated by the shared key Google puts in
// the body (`google_key`), checked in lib/lead-sources/google-ads.ts.

const MAX_BODY = 64 * 1024;

export async function POST(req: NextRequest) {
  const limited = rateLimit(`gads-webhook:${clientIp(req)}`, 120, 60_000);
  if (limited) return limited;
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const r = await handleGoogleWebhook(body);
  return NextResponse.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
}
