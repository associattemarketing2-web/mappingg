import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isStaffRole } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { deviceOf, isBot, locate, recordEvents, sourceOf, visitorId, type SiteEvent } from '@/lib/site-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Receives page views, clicks and "still here" heartbeats from components/SiteTracker.tsx
// (sent with navigator.sendBeacon). Anonymous and cookieless — see lib/site-analytics.ts.
const path = z.string().max(300).regex(/^\//);
const eventSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('pv'), p: path, r: z.string().max(500).optional(), u: z.string().max(60).optional(), w: z.number().int().min(0).max(10000).optional() }),
  z.object({ k: z.literal('click'), p: path, l: z.string().max(80), h: z.string().max(200).optional() }),
  z.object({ k: z.literal('hb'), p: path }),
  z.object({ k: z.literal('search'), p: path, l: z.string().min(1).max(80) }),
]);
const bodySchema = z.object({ e: z.array(eventSchema).min(1).max(20) });

const ok = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') || '';
  if (isBot(ua)) return ok();
  if (rateLimit(`track:${clientIp(req)}`, 300, 10 * 60_000)) return ok();

  let raw: unknown;
  try { raw = JSON.parse(await req.text()); } catch { return ok(); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return ok();

  // The team's own browsing would skew the numbers — skip signed-in staff.
  const user = await getCurrentUser().catch(() => null);
  if (user && isStaffRole(user.role)) return ok();

  const ip = clientIp(req);
  const vid = visitorId(ip, ua);
  const host = new URL(process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).hostname;
  const at = new Date().toISOString();
  const geo = await locate(ip); // country / state / city — the IP itself is not stored
  const events: SiteEvent[] = parsed.data.e.map((e): SiteEvent => {
    const p = e.p.split('?')[0].slice(0, 200) || '/';
    if (e.k === 'pv') {
      // Only the first page of a visit says where it came from.
      const landing = e.r !== undefined || e.u !== undefined;
      return { at, kind: 'pv', path: p, vid, source: landing ? sourceOf(e.r || '', e.u || '', host) || undefined : undefined, device: deviceOf(ua, e.w), ...geo };
    }
    if (e.k === 'click') return { at, kind: 'click', path: p, vid, label: e.l.trim().slice(0, 80), href: e.h?.slice(0, 200), device: deviceOf(ua), ...geo };
    if (e.k === 'search') return { at, kind: 'search', path: p, vid, label: e.l.replace(/s+/g, ' ').trim().slice(0, 80), device: deviceOf(ua), ...geo };
    return { at, kind: 'hb', path: p, vid, ...geo };
  });
  try { await recordEvents(events); } catch (err) { console.warn('[track]', err instanceof Error ? err.message : err); }
  return ok();
}
