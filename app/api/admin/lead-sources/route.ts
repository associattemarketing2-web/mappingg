import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { listSources, COMMON_PORTALS, DEFAULT_PORTAL_SCOPE } from '@/lib/lead-sources/sources';
import { loadBuyerRows, summarize } from '@/lib/lead-sources/buyer-intel';
import { googleConfigured, googleKey, GOOGLE_SOURCE } from '@/lib/lead-sources/google-ads';
import { metaConfigured, runMetaSync, subscribePage, testMetaConnection, META_SOURCE } from '@/lib/lead-sources/meta';
import { importSchema, previewCsv, runCsvImport, MAX_CSV_BYTES } from '@/lib/lead-sources/csv-import';
import { deletePortal, listPortals, PORTAL_PERMISSIONS, recentLog, upsertPortal, lastOk } from '@/lib/lead-sources/store';
import { slugify } from '@/lib/seo/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Super admin → Buyer leads. Owner only (role 'admin'), re-checked on every request.
// GET                   → sources (status, counts, setup) + buyer rows + summary
// GET ?log=<source|all> → recent sync-log entries (no personal data)
// POST {action}         → test | sync | subscribe | csv_preview | csv_import |
//                         portal_save | portal_delete | portal_seed
// Secrets are never returned: credentials are reported as set / not set only.

const noStore = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const fail = (message: string, status = 400) => json({ error: { message } }, status);

async function owner() {
  const u = await getCurrentUser();
  return u && u.role === 'admin' ? u : null;
}
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!(await owner())) return fail('Not authorized', 401);
  const log = req.nextUrl.searchParams.get('log');
  try {
    if (log) return json({ data: await recentLog(log === 'all' ? null : log, 100) });
    const [sources, rows] = await Promise.all([listSources(), loadBuyerRows()]);
    return json({ data: { sources, rows, summary: summarize(rows) } });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not load buyer leads', 500);
  }
}

const portalSchema = z.object({
  id: z.string().trim().max(60).optional(),
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().max(300).url().refine((u) => /^https?:\/\//.test(u), 'Use an http(s) URL'),
  data_scope: z.string().trim().max(300).default(''),
  terms_url: z.union([z.literal(''), z.string().trim().max(300).url()]).default(''),
  permission: z.enum(PORTAL_PERMISSIONS),
  permission_note: z.string().trim().max(1000).default(''),
  evidence_url: z.union([z.literal(''), z.string().trim().max(300).url()]).default(''),
}).strict();

export async function POST(req: NextRequest) {
  const me = await owner();
  if (!me) return fail('Not authorized', 401);
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  if (Number(req.headers.get('content-length') || 0) > MAX_CSV_BYTES + 64 * 1024) return fail('The file is too large (max 5 MB).', 413);
  const body = await req.json().catch(() => null) as Record<string, any> | null;
  if (!body || typeof body.action !== 'string') return fail('Invalid request');
  const actor = me.email;

  try {
    switch (body.action) {
      case 'test': {
        if (body.source === META_SOURCE) {
          if (!metaConfigured()) return fail('Meta is not configured: set the environment variables listed under "Required credentials" first.');
          return json({ data: await testMetaConnection(actor) });
        }
        if (body.source === GOOGLE_SOURCE) {
          // Google gives no API to call without a Google Ads developer token, so this checks
          // our side and reports whether Google has reached the webhook yet.
          const configured = googleConfigured();
          const lastWebhook = await lastOk(GOOGLE_SOURCE, 'webhook');
          return json({ data: {
            ok: configured && !!lastWebhook,
            checks: [
              { ok: configured, text: configured ? 'Webhook key is set on the server.' : googleKey() ? 'Webhook key is too short — use at least 16 characters.' : 'GOOGLE_ADS_LEAD_WEBHOOK_KEY is not set on the server.' },
              { ok: !!lastWebhook, text: lastWebhook ? `Google Ads last reached the webhook successfully on ${new Date(lastWebhook).toUTCString()}.` : 'Google Ads has not reached the webhook yet. Use "Send test data" in the lead form\'s webhook settings.' },
            ],
          } });
        }
        return fail('This source has no connection test.');
      }
      case 'subscribe': {
        if (!metaConfigured()) return fail('Meta is not configured.');
        return json({ data: await subscribePage(actor) });
      }
      case 'sync': {
        if (body.source !== META_SOURCE) return fail('Run sync is only available for Meta lead ads (the other sources push leads to us as they happen).');
        if (!metaConfigured()) return fail('Meta is not configured.');
        return json({ data: await runMetaSync(actor) });
      }
      case 'csv_preview': {
        if (typeof body.csv !== 'string' || !body.csv.trim()) return fail('Choose a CSV file.');
        if (body.csv.length > MAX_CSV_BYTES) return fail('The file is too large (max 5 MB).');
        return json({ data: previewCsv(body.csv) });
      }
      case 'csv_import': {
        const { action: _a, ...rest } = body; void _a;
        const parsed = importSchema.safeParse(rest);
        if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join('; '));
        return json({ data: await runCsvImport(parsed.data, actor) });
      }
      case 'portal_save': {
        const parsed = portalSchema.safeParse(body.portal);
        if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        const p = parsed.data;
        const id = p.id || slugify(p.name);
        if (!id) return fail('Give the portal a name.');
        return json({ data: await upsertPortal({ ...p, id }, actor) });
      }
      case 'portal_delete': {
        if (typeof body.id !== 'string') return fail('Missing id');
        return json({ data: { ok: await deletePortal(body.id) } });
      }
      case 'portal_seed': {
        const have = new Set((await listPortals()).map((p) => p.id));
        let added = 0;
        for (const p of COMMON_PORTALS) {
          if (have.has(p.id)) continue;
          await upsertPortal({ ...p, data_scope: DEFAULT_PORTAL_SCOPE, terms_url: '', permission: 'not_reviewed', permission_note: '', evidence_url: '' }, actor);
          added++;
        }
        return json({ data: { added } });
      }
      default:
        return fail('Unknown action');
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed', 500);
  }
}
