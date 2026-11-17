import { NextRequest, NextResponse } from 'next/server';
import { isAvailable } from '@/lib/subscriptions/db';
import { handleWebhook } from '@/lib/subscriptions/lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/webhook — Razorpay webhook. The raw body is verified
// against RAZORPAY_WEBHOOK_SECRET (X-Razorpay-Signature) before it is parsed;
// each event id is stored once, so retries and duplicates are acknowledged
// without being processed twice. No session / cookies are involved.
export async function POST(req: NextRequest) {
  if (!isAvailable()) return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ ok: false }, { status: 413 });
  const r = await handleWebhook(raw, req.headers.get('x-razorpay-signature'), req.headers.get('x-razorpay-event-id'));
  return NextResponse.json({ ok: r.status < 300, outcome: r.outcome }, { status: r.status });
}
