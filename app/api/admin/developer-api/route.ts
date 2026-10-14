import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { LIMITS, SCOPE_LIST, SCOPES, APP_STATUSES } from '@/lib/api-platform/config';
import * as store from '@/lib/api-platform/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Super-admin → Developer API. Owner only (role 'admin'), checked here on the
// server for every request — the tab being hidden in the UI is not the guard.
// This route is authenticated by the session cookie; Developer API keys are
// never accepted here.
//
// GET                    → applications, keys (no secrets), usage, security events
// GET ?id=<app>          → one application: keys, 30-day usage, recent requests, audit trail
// GET ?export=csv[&id=]  → usage report CSV (no secrets, no contact details)
// POST {action: ...}     → create | update | status | rotate | revoke_key
// A new key's secret is in the response to create/rotate ONLY, once.

const noStore = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const fail = (message: string, status = 400) => json({ error: { message } }, status);

async function owner() {
  const u = await getCurrentUser();
  return u && u.role === 'admin' ? u : null;
}

/** Cookie-authenticated writes must come from our own pages. */
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!(await owner())) return fail('Not authorized', 401);
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  try {
    if (sp.get('export') === 'csv') {
      const apps = new Map((await store.listApps()).map((a) => [a.id, a]));
      const rows = await store.dailyUsage(id, Number(sp.get('days')) || LIMITS.logRetentionDays);
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['app_id', 'app_name', 'organization', 'day_utc', 'endpoint', 'requests', 'errors', 'rate_limited', 'records', 'avg_ms']]
        .concat(rows.map((r) => [r.app_id, apps.get(r.app_id)?.name, apps.get(r.app_id)?.organization, r.day, r.route, r.requests, r.errors, r.rate_limited, r.records, r.avg_ms].map(String)));
      return new NextResponse(lines.map((l) => l.map(cell).join(',')).join('\n') + '\n', {
        headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="mappingg-api-usage${id ? `-${id}` : ''}.csv"` },
      });
    }
    if (id) {
      const app = await store.getApp(id);
      if (!app) return fail('Not found', 404);
      const [all, usage, events, audit] = await Promise.all([store.listApps(), store.dailyUsage(id, 30), store.recentEvents({ appId: id, limit: 50 }), store.auditTrail(id)]);
      return json({ data: { app, keys: all.find((a) => a.id === id)?.keys || [], usage, events, audit } });
    }
    const [apps, usage, security] = await Promise.all([store.listApps(), store.usageSummary(), store.recentEvents({ securityOnly: true, limit: 30 })]);
    return json({ data: { apps, usage, security, scopes: SCOPES, limits: LIMITS } });
  } catch (e) {
    console.error('[admin/developer-api]', (e as Error).message);
    return fail('Could not load the Developer API data', 500);
  }
}

const appFields = {
  name: z.string().trim().min(2).max(120),
  organization: z.string().trim().max(160).optional(),
  contact_email: z.string().trim().email().max(200),
  website: z.union([z.literal(''), z.string().trim().url().max(300).refine((u) => /^https?:\/\//i.test(u), 'must be http(s)')]).optional(),
  purpose: z.string().trim().max(1000).optional(),
  scopes: z.array(z.enum(SCOPE_LIST as [string, ...string[]])).max(SCOPE_LIST.length),
  rate_per_minute: z.coerce.number().int().min(1).max(LIMITS.maxRatePerMinute),
  daily_quota: z.coerce.number().int().min(1).max(LIMITS.maxDailyQuota),
  max_page_size: z.coerce.number().int().min(1).max(LIMITS.maxPageSize),
  // POST /enquiries limits; only used when the app has the enquiries:submit scope.
  enquiry_rate_per_minute: z.coerce.number().int().min(1).max(LIMITS.maxEnquiryPerMinute).optional(),
  enquiry_daily_quota: z.coerce.number().int().min(1).max(LIMITS.maxEnquiryDailyQuota).optional(),
  expires_at: z.union([z.null(), z.literal(''), z.string().datetime({ offset: true })]).optional(),
};

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), ...appFields }),
  z.object({ action: z.literal('update'), id: z.string().max(40), ...appFields }),
  z.object({ action: z.literal('status'), id: z.string().max(40), status: z.enum(APP_STATUSES) }),
  z.object({ action: z.literal('rotate'), id: z.string().max(40), grace_hours: z.coerce.number().int().min(0).max(LIMITS.maxRotationGraceHours) }),
  z.object({ action: z.literal('revoke_key'), id: z.string().max(40), key_id: z.string().regex(/^[0-9a-f]{16}$/) }),
]);

export async function POST(req: NextRequest) {
  const user = await owner();
  if (!user) return fail('Not authorized', 401);
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: { message: 'Invalid input', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } }, 400);
  const b = parsed.data;
  const actor = user.email;
  try {
    switch (b.action) {
      case 'create': {
        const { action: _a, ...input } = b;
        const out = await store.createApp({ ...input, expires_at: input.expires_at || null }, actor);
        return json({ data: { app: out.app, key: out.key, secret: out.secret } }, 201);
      }
      case 'update': {
        const { action: _a, id, ...input } = b;
        const app = await store.updateApp(id, { ...input, expires_at: input.expires_at || null }, actor);
        return app ? json({ data: { app } }) : fail('Not found', 404);
      }
      case 'status': {
        const app = await store.setAppStatus(b.id, b.status, actor);
        return app ? json({ data: { app } }) : fail('Not found', 404);
      }
      case 'rotate': {
        const out = await store.rotateKey(b.id, b.grace_hours, actor);
        return out ? json({ data: { key: out.key, secret: out.secret } }, 201) : fail('Not found or revoked', 404);
      }
      case 'revoke_key':
        return (await store.revokeKey(b.id, b.key_id, actor)) ? json({ data: { ok: true } }) : fail('Key not found or already revoked', 404);
    }
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/cannot be re-enabled/.test(msg)) return fail(msg, 409);
    console.error('[admin/developer-api]', msg);
    return fail('Could not save', 500);
  }
}
