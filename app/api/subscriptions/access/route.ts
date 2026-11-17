import { NextRequest } from 'next/server';
import { getEntitlements, suggestUpgrade, validateProjectAccess } from '@/lib/subscriptions/entitlements';
import { publicPin } from '@/lib/subscriptions/projects';
import { errorResponse, fail, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/access { pin_id } — a CP / buyer opening a project's
// full details. Counts the project once per period (weekly for CPs, per the
// plan for buyers) and refuses when the plan's limit or city is exceeded.
// The same check runs inside /api/my/enquire and /api/project-quickview, so
// calling those directly can't get around it.
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const limited = rateLimit(`sub-access:${a.user.id}`, 120, 60_000);
  if (limited) return limited;
  const b = await readJson(req);
  const pin = await publicPin(String(b.pin_id || '').slice(0, 100));
  if (!pin) return fail('Project not found', 404);
  try {
    const ent = await getEntitlements(a.user);
    const r = await validateProjectAccess(ent, pin);
    if (!r.allowed) {
      const up = await suggestUpgrade(ent);
      return fail(r.message || 'Upgrade to open more projects.', 402, r.code, { upgrade: up, usage: 'usage' in r ? r.usage : undefined });
    }
    return ok({ allowed: true, would_block: r.wouldBlock, usage: 'usage' in r ? r.usage : null });
  } catch (e) {
    return errorResponse(e);
  }
}
