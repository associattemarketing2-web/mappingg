import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { pushConfigured, pushToUser, removeSubscription, saveSubscription } from '@/lib/web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Device notifications for the admin bell (see lib/web-push.ts).
//   GET    → { configured, publicKey }
//   POST   { subscription }            → turn alerts on for this browser
//   POST   { test: true }              → send a test alert to my devices
//   DELETE { endpoint }                → turn alerts off for this browser
const err = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });

async function staff() {
  const me = await getCurrentUser();
  return me && (me.role === 'admin' || me.role === 'employee') ? me : null;
}

export async function GET() {
  if (!(await staff())) return err('Not authorized', 401);
  return NextResponse.json({ data: { configured: pushConfigured(), publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '' } });
}

export async function POST(req: Request) {
  const me = await staff();
  if (!me) return err('Not authorized', 401);
  if (!pushConfigured()) return err('Push keys are not set on the server (VAPID_PRIVATE_KEY / NEXT_PUBLIC_VAPID_PUBLIC_KEY).', 503);
  const b = await req.json().catch(() => ({}));
  if (b?.test) {
    const sent = await pushToUser(me.id, { title: 'Mappingg — notifications are on ✅', body: 'New leads, sign-ups and projects will pop up here, even when the site is closed.', url: '/dashboard/s-admin', tag: 'mappingg-test' });
    return NextResponse.json({ data: { sent } });
  }
  const sub = b?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return err('Invalid subscription', 400);
  const ua = req.headers.get('user-agent') || '';
  const device = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'Browser';
  await saveSubscription({
    user_id: me.id, email: me.email, role: me.role,
    sub: { endpoint: String(sub.endpoint), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
    device,
  });
  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(req: Request) {
  if (!(await staff())) return err('Not authorized', 401);
  const b = await req.json().catch(() => ({}));
  if (b?.endpoint) await removeSubscription(String(b.endpoint));
  return NextResponse.json({ data: { ok: true } });
}
