import { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { canEditProjects } from '@/lib/verification';
import { getEntitlements, hasFeature, limitOf } from '@/lib/subscriptions/entitlements';
import { guardFeature } from '@/lib/subscriptions/guards';
import { countMedia, devMediaPrefix, listMedia, MEDIA_KINDS, submitMedia, type MediaKind } from '@/lib/subscriptions/features';
import { errorResponse, fail, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { logActivity } from '@/lib/activity';
import { notifyAdmin, esc } from '@/lib/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A developer's project media on a paid plan: brochure, floor plans, gallery
// photos (uploaded through /api/partners/storage into their own folder) and a
// highlighted YouTube video (Large Bulk). Each item is reviewed by Mappingg
// before it shows on the live map — the project itself stays live meanwhile.
//   GET  ?pin=<id>  — submissions for one of your projects + what your plan allows
//   POST { pin_id, kind, path | url, title }

async function developer() {
  const a = await requireAccount();
  if ('res' in a) return a;
  if (a.user.role !== 'developer') return { res: fail('Only developer accounts manage project media.', 403, 'wrong_role') };
  return a;
}

async function ownPin(userId: string, pinId: string) {
  return (await getDb()).collection('pins').findOne({ id: pinId, owner_user_id: userId }, { projection: { id: 1, title: 1 } });
}

export async function GET(req: NextRequest) {
  const a = await developer();
  if ('res' in a) return a.res;
  const pinId = String(req.nextUrl.searchParams.get('pin') || '').slice(0, 100);
  if (!pinId || !(await ownPin(a.user.id, pinId))) return fail('Project not found', 404);
  try {
    const ent = await getEntitlements(a.user);
    const allowed = Object.fromEntries(Object.entries(MEDIA_KINDS).map(([k, f]) => [k, !ent.enforced || hasFeature(ent, f, { projectId: pinId })]));
    return ok({
      items: await listMedia({ userId: a.user.id, pinId }),
      allowed, limit: limitOf(ent, 'dev_media_per_project'), used: await countMedia(pinId),
      prefix: Object.fromEntries(Object.keys(MEDIA_KINDS).map((k) => [k, devMediaPrefix(a.user.id, pinId, k)])),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const a = await developer();
  if ('res' in a) return a.res;
  if (!(await canEditProjects(a.user.id))) return fail('Your account has view-only access. Contact Mappingg to get editing access.', 403);
  const b = await readJson(req);
  const pinId = String(b.pin_id || '').slice(0, 100);
  const kind = String(b.kind || '') as MediaKind;
  if (!(kind in MEDIA_KINDS)) return fail('Unknown media type');
  const pin = await ownPin(a.user.id, pinId);
  if (!pin) return fail('Project not found', 404);
  const gate = await guardFeature(a.user, MEDIA_KINDS[kind], pinId);
  if (gate) return gate;
  try {
    const ent = await getEntitlements(a.user);
    const lim = limitOf(ent, 'dev_media_per_project');
    if (ent.enforced && lim != null && (await countMedia(pinId)) >= lim) return fail(`Your plan allows ${lim} media files per project.`, 402, 'limit_reached');
    const item = await submitMedia(a.user.id, pinId, kind, b);
    await logActivity({ user_id: a.user.id, email: a.user.email, role: a.user.role, type: 'project_edited', detail: `Sent a ${kind.replace('_', ' ')} for “${String(pin.title || 'a project')}” — waiting for review` });
    notifyAdmin(`Project media to review: ${String(pin.title || '')}`, { title: 'A developer sent project media', body: [`${esc(a.user.email)} sent a <b>${esc(kind.replace('_', ' '))}</b> for <b>${esc(pin.title)}</b>.`], cta: { label: 'Review it', href: '/dashboard/s-admin?tab=subscriptions' } });
    return ok(item, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
