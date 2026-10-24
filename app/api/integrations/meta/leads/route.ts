import { NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { handleMetaWebhook, metaConfigured, signatureValid, verifyChallenge, META_SOURCE } from '@/lib/lead-sources/meta';
import { logRun, logRunThrottled } from '@/lib/lead-sources/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Meta Lead Ads webhook.
//  GET  — the subscription handshake (hub.verify_token must match META_WEBHOOK_VERIFY_TOKEN).
//  POST — `leadgen` changes, signed with X-Hub-Signature-256 (HMAC of the raw body with META_APP_SECRET).

const MAX_BODY = 256 * 1024;

export async function GET(req: NextRequest) {
  const challenge = verifyChallenge(req.nextUrl.searchParams);
  if (challenge === null) return new NextResponse('Forbidden', { status: 403 });
  await logRun({ source: META_SOURCE, action: 'webhook', ok: true, is_test: true, detail: { note: 'Webhook subscription verified by Meta' } });
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(`meta-webhook:${clientIp(req)}`, 300, 60_000);
  if (limited) return limited;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  if (!metaConfigured()) {
    await logRunThrottled({ source: META_SOURCE, action: 'webhook', ok: false, error: 'Webhook received but the Meta credentials are not set on the server.' }, 'meta:not-configured');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!signatureValid(raw, req.headers.get('x-hub-signature-256'))) {
    await logRunThrottled({ source: META_SOURCE, action: 'webhook', ok: false, error: 'Rejected a webhook with a missing or invalid signature. Check META_APP_SECRET matches the app sending webhooks.', detail: { kind: 'failed' } }, 'meta:bad-signature');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }
  let body: Parameters<typeof handleMetaWebhook>[0];
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  // Always 200 once verified: failures are logged and recovered by "Run sync",
  // so Meta doesn't disable the subscription after repeated errors.
  await handleMetaWebhook(body);
  return NextResponse.json({ ok: true });
}
