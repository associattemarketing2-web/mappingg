import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { canEditProjects } from '@/lib/verification';
import { guardFeature } from '@/lib/subscriptions/guards';
import { openForDeveloperPin } from '@/lib/partners-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Edit all details" in the Developer panel: opens one of the developer's own
// projects in the full project form (/submit — every field: price, configuration,
// RERA, media, amenities…). Saving there sends it to the super admin for review;
// publishing it updates this same pin. See openForDeveloperPin.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'developer') return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  if (!(await canEditProjects(user.id))) {
    return NextResponse.json({ error: { message: 'Your account has view-only access. Contact Mappingg to get editing access.' } }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: { message: 'Invalid request.' } }, { status: 400 });

  const db = await getDb();
  // Ownership is enforced in the filter: only the developer's own pins.
  const pin = await db.collection('pins').findOne({ id, owner_user_id: user.id });
  if (!pin) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });
  // Editing a live project is a paid-plan feature (same rule as the quick edit).
  if (!pin.pending_review && !pin.rejected) {
    const gate = await guardFeature(user, 'dev_project_editing', id);
    if (gate) return gate;
  }

  const me = await db.collection('users').findOne({ id: user.id }, { projection: { profile: 1 } });
  const profile = (me?.profile as Record<string, string> | undefined) || {};
  try {
    const r = await openForDeveloperPin({ id: user.id, email: user.email, name: profile.name || null }, pin as Record<string, any>, String(profile.company || ''));
    const url = `/submit?t=${encodeURIComponent(r.token)}&s=${encodeURIComponent(r.submission_id)}`;
    return NextResponse.json({ data: { url, created: r.created } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return NextResponse.json({ error: { message: e instanceof Error ? e.message : 'Could not open the full form' } }, { status: 409 });
  }
}
