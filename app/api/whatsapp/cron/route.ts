import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { processDue } from '@/lib/wa-schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sends scheduled WhatsApp messages that have come due. Call it every minute
// from any scheduler (e.g. cron-job.org, free) so scheduled messages go out on
// time even when nobody has s-admin open and no WhatsApp traffic arrives:
//   https://www.mappingg.com/api/whatsapp/cron?token=<WHATSAPP_WEBHOOK_SECRET>
// (or header "Authorization: Bearer <CRON_SECRET>"). Safe to call as often as you like.
function same(secret: string | undefined, given: string): boolean {
  if (!secret || !given) return false;
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = req.nextUrl.searchParams.get('token') || '';
  const ok = same(process.env.CRON_SECRET, bearer) || same(process.env.WHATSAPP_WEBHOOK_SECRET, token) || same(process.env.WHATSAPP_WEBHOOK_SECRET, bearer);
  if (!ok) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const r = await processDue({ budgetMs: 50_000 });
  return NextResponse.json({ data: { sent: r.results.filter((x) => x.ok).length, failed: r.results.filter((x) => !x.ok).length, pending: r.pending } }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;
