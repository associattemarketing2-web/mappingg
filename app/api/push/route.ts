import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isStaffRole } from '@/lib/auth';
import { hasSubscription, pushConfigured, pushPublicKey, pushTest, removeSubscription, saveSubscription } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phone push notifications for the team (lib/push.ts, components/PushToggle.tsx).
//   GET  ?endpoint=…                         → { configured, key, subscribed }
//   POST { action: 'subscribe', subscription } → this device gets notifications
//   POST { action: 'unsubscribe', endpoint }   → it no longer does
//   POST { action: 'test' }                    → a test notification to the signed-in teammate's devices

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });

async function staff() {
  const me = await getCurrentUser();
  return me && isStaffRole(me.role) ? me : null;
}

export async function GET(req: NextRequest) {
  if (!(await staff())) return fail('Not authorized', 401);
  const endpoint = req.nextUrl.searchParams.get('endpoint') || '';
  return NextResponse.json({
    data: { configured: pushConfigured(), key: pushPublicKey(), subscribed: endpoint ? await hasSubscription(endpoint).catch(() => false) : false },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('subscribe'),
    subscription: z.object({
      endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Bad endpoint'),
      keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
    }),
  }),
  z.object({ action: z.literal('unsubscribe'), endpoint: z.string().max(1000) }),
  z.object({ action: z.literal('test') }),
]);

export async function POST(req: NextRequest) {
  const me = await staff();
  if (!me) return fail('Not authorized', 401);
  if (!pushConfigured()) return fail('Push notifications are not set up on the server (WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY).', 503);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid request');
  const d = parsed.data;
  if (d.action === 'subscribe') {
    const ua = req.headers.get('user-agent') || '';
    const device = /android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iPhone' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : 'Browser';
    await saveSubscription({ email: me.email, role: me.role }, d.subscription, device);
    return NextResponse.json({ data: { ok: true } });
  }
  if (d.action === 'unsubscribe') {
    await removeSubscription(d.endpoint);
    return NextResponse.json({ data: { ok: true } });
  }
  return NextResponse.json({ data: { devices: await pushTest(me.email) } });
}
