import { NextRequest } from 'next/server';
import { guardFeature } from '@/lib/subscriptions/guards';
import { cancelOwnServiceRequest, createServiceRequest, listServiceRequests, SERVICE_TYPES } from '@/lib/subscriptions/features';
import { errorResponse, fail, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { notifyAdmin, esc } from '@/lib/mailer';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Buyer Premium requests for a person: property expert, legal document review,
// vastu consultation, portfolio review. A request is only a booking — the
// Mappingg team schedules it and updates the status; nothing is shown as done
// until they mark it so. GET lists your own; POST creates; DELETE ?id cancels.
const FEATURE: Record<string, string> = { expert: 'buyer_expert_assist', legal: 'buyer_legal_info', vastu: 'buyer_vastu', portfolio: 'buyer_portfolio' };

async function buyer() {
  const a = await requireAccount();
  if ('res' in a) return a;
  if (a.user.role !== 'buyer') return { res: fail('These services are for buyer accounts.', 403, 'wrong_role') };
  return a;
}

export async function GET() {
  const a = await buyer();
  if ('res' in a) return a.res;
  try {
    return ok(await listServiceRequests(a.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const a = await buyer();
  if ('res' in a) return a.res;
  const limited = rateLimit(`buyer-svc:${a.user.id}`, 10, 60 * 60_000);
  if (limited) return limited;
  const b = await readJson(req);
  const type = String(b.type || '');
  if (!(type in SERVICE_TYPES)) return fail('Choose what you need help with.');
  const gate = (await guardFeature(a.user, 'buyer_expert_assist')) || (await guardFeature(a.user, FEATURE[type]));
  if (gate) return gate;
  try {
    const r = await createServiceRequest(a.user.id, b);
    notifyAdmin(`Buyer Premium request: ${SERVICE_TYPES[type as keyof typeof SERVICE_TYPES]} — ${a.user.email}`, {
      title: 'New Buyer Premium request',
      body: [`${esc(a.user.email)} asked for <b>${esc(SERVICE_TYPES[type as keyof typeof SERVICE_TYPES])}</b>.`],
      rows: [['Project', r.project_title], ['Preferred', [r.preferred_date, r.preferred_time].filter(Boolean).join(' ')], ['Phone', r.contact_phone], ['Message', r.message]],
      cta: { label: 'Open requests', href: '/dashboard/s-admin?tab=subscriptions' },
    }, a.user.email);
    return ok(r, 201);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const a = await buyer();
  if ('res' in a) return a.res;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return fail('Missing id');
  try {
    await cancelOwnServiceRequest(a.user.id, id);
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
