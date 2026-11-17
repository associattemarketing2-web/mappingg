import { NextRequest, NextResponse } from 'next/server';
import { getEntitlements, hasFeature, limitOf } from '@/lib/subscriptions/entitlements';
import { guardFeature } from '@/lib/subscriptions/guards';
import { archiveCpLead, countCpLeads, createCpLead, leadsCsv, listCpLeads, updateCpLead } from '@/lib/subscriptions/features';
import { NO_STORE, errorResponse, fail, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A channel partner's own client leads (private: every query is scoped to the
// signed-in CP — no other CP, and no buyer/developer, can read them).
//   GET    ?archived=1 · ?format=csv (CRM plans)  — list (always allowed: your own data is never locked away)
//   POST   { name, phone, email, pin_id, budget, requirement, city, notes }   — needs the plan's lead feature + limit
//   PATCH  { id, ...fields, status, priority, follow_up_at, note }             — priority / follow-ups / timeline need CRM
//   DELETE ?id=…[&restore=1]                                                   — archive (never a hard delete)

async function cp() {
  const a = await requireAccount();
  if ('res' in a) return a;
  if (a.user.role !== 'agent') return { res: fail('Lead management is for channel partner accounts.', 403, 'wrong_role') };
  return a;
}

export async function GET(req: NextRequest) {
  const a = await cp();
  if ('res' in a) return a.res;
  try {
    const ent = await getEntitlements(a.user);
    const leads = await listCpLeads(a.user.id, { archived: req.nextUrl.searchParams.get('archived') === '1' });
    const crm = !ent.enforced || hasFeature(ent, 'cp_crm');
    const visibility = !ent.enforced || hasFeature(ent, 'cp_lead_visibility');
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      if (!crm) return fail('CSV export is part of the CRM on Pro Max.', 402, 'feature_not_in_plan');
      return new NextResponse(leadsCsv(leads), { headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="my-leads.csv"' } });
    }
    return ok({
      leads: visibility ? leads : leads.map((l) => ({ ...l, activity: [] })),
      plan: {
        can_add: !ent.enforced || hasFeature(ent, 'cp_leads'), crm, visibility,
        limit: limitOf(ent, 'cp_max_leads'), used: await countCpLeads(a.user.id), enforced: ent.enforced,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const a = await cp();
  if ('res' in a) return a.res;
  const limited = rateLimit(`cp-leads:${a.user.id}`, 60, 60_000);
  if (limited) return limited;
  const gate = await guardFeature(a.user, 'cp_leads');
  if (gate) return gate;
  try {
    const ent = await getEntitlements(a.user);
    const lim = limitOf(ent, 'cp_max_leads');
    if (ent.enforced && lim != null && (await countCpLeads(a.user.id)) >= lim) {
      return fail(`Your plan keeps up to ${lim} active leads. Archive old ones or upgrade to Pro Max for unlimited leads.`, 402, 'limit_reached');
    }
    return ok(await createCpLead(a.user.id, await readJson(req)), 201);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const a = await cp();
  if ('res' in a) return a.res;
  const gate = await guardFeature(a.user, 'cp_leads');
  if (gate) return gate;
  const b = await readJson(req);
  if (!b.id) return fail('Missing id');
  try {
    const ent = await getEntitlements(a.user);
    return ok(await updateCpLead(a.user.id, String(b.id), b, { crm: !ent.enforced || hasFeature(ent, 'cp_crm') }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const a = await cp();
  if ('res' in a) return a.res;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return fail('Missing id');
  try {
    await archiveCpLead(a.user.id, id, req.nextUrl.searchParams.get('restore') !== '1');
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
