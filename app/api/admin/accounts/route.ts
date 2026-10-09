import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES, getCurrentUser, forgetAccount } from '@/lib/auth';
import { needsVerification, verificationOf } from '@/lib/verification';
import { hasPermission } from '@/lib/staff';
import { localitiesOf, localitiesOfAll } from '@/lib/locality';
import { logActivity } from '@/lib/activity';
import { accountStats, type AccountLite } from '@/lib/account-insights';
import { idsParam, moveToTrash } from '@/lib/trash';
import { addBuyerSignupLead } from '@/lib/signup-leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public accounts (buyer / developer / channel partner) created from the site's
// sign-up form. Needs the 'accounts' permission (the owner always has it).
// Password hashes never leave the server — staff can only set a new password.
type AnyDoc = { _id: string; [key: string]: any };
const ROLE_FILTER = { role: { $in: [...PUBLIC_ROLES] } };

function clean(doc: AnyDoc) {
  const { _id, password_hash, ...rest } = doc;
  return { ...rest, verification: verificationOf(doc) };
}
const unauthorized = () => NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

export async function GET() {
  if (!(await hasPermission('accounts'))) return unauthorized();
  const db = await getDb();
  const rows = await db.collection<AnyDoc>('users').find(ROLE_FILTER).sort({ created_at: -1 }).limit(10000).toArray();

  // Locations for the location-wise view: a buyer's preferred area, an agent's
  // working areas, and for a developer the locations of their projects on the map.
  const devIds = rows.filter((r) => r.role === 'developer').map((r) => String(r.id));
  const devPins = devIds.length
    ? await db.collection<AnyDoc>('pins').find({ owner_user_id: { $in: devIds } }, { projection: { owner_user_id: 1, location: 1 } }).toArray()
    : [];
  const pinLocs = new Map<string, unknown[]>();
  for (const p of devPins) {
    const k = String(p.owner_user_id);
    pinLocs.set(k, [...(pinLocs.get(k) || []), p.location]);
  }
  const locationsOf = (r: AnyDoc) =>
    r.role === 'buyer' ? localitiesOf(r.profile?.area)
      : r.role === 'agent' ? localitiesOf(r.profile?.areas)
        : localitiesOfAll(pinLocs.get(String(r.id)) || []);

  // Enquiries, projects, logins and last-active time per account (lib/account-insights.ts).
  const stats = await accountStats(rows as unknown as AccountLite[]).catch(() => new Map());

  return NextResponse.json({ data: rows.map((r) => ({ ...clean(r), locations: locationsOf(r), stats: stats.get(String(r.id)) || null })) });
}

const patchSchema = z.object({
  id: z.string().min(1),
  // Verification decision — super admin (owner) only. A rejection needs a reason
  // the applicant will see on their dashboard.
  decision: z.enum(['approve', 'reject', 'reset']).optional(),
  reason: z.string().trim().max(1000).optional(),
  notes: z.string().max(4000).optional(),
  password: z.string().min(8).max(200).optional(),
  // Developers only: what they may do once approved (set when approving, or changed later).
  access: z.enum(['viewer', 'editor']).optional(),
  // Account details (super admin only): name, login email, WhatsApp and sign-up fields.
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  mobile: z.string().trim().max(30).optional(),
  profile: z.record(z.string().max(80), z.string().trim().max(1000)).optional(),
  // Move the account to another type (super admin only), e.g. a buyer or channel
  // partner who is really a developer. Staff moving someone counts as verifying them.
  role: z.enum(PUBLIC_ROLES).optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await hasPermission('accounts'))) return unauthorized();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Invalid request (passwords need at least 8 characters).' } }, { status: 400 });
  }
  const { id, decision, reason, notes, password, access, name, email, mobile, profile, role } = parsed.data;
  const editingDetails = name !== undefined || email !== undefined || mobile !== undefined || profile !== undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (typeof notes === 'string') patch.notes = notes;
  if (password) patch.password_hash = await bcrypt.hash(password, 12);

  const db = await getDb();
  const users = db.collection<AnyDoc>('users');
  if (editingDetails) {
    const me = await getCurrentUser();
    if (!me || me.role !== 'admin') {
      return NextResponse.json({ error: { message: 'Only the super admin can edit account details.' } }, { status: 403 });
    }
    if (email) {
      const taken = await users.findOne({ email, id: { $ne: id } }, { projection: { id: 1 } });
      if (taken) return NextResponse.json({ error: { message: 'Another account already uses this email.' } }, { status: 409 });
      patch.email = email;
    }
    if (name !== undefined) patch.name = name;
    if (mobile !== undefined) {
      const m = normalizePhone(mobile);
      if (m === null) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });
      patch.mobile = m;
    }
    if (profile) {
      const cur = await users.findOne({ id, ...ROLE_FILTER }, { projection: { profile: 1 } });
      patch.profile = { ...((cur?.profile as Record<string, string>) || {}), ...profile };
    }
  }
  let roleChange: { from: string; to: string } | null = null;
  if (role) {
    const me = await getCurrentUser();
    if (!me || me.role !== 'admin') {
      return NextResponse.json({ error: { message: 'Only the super admin can change the account type.' } }, { status: 403 });
    }
    const target = await users.findOne({ id, ...ROLE_FILTER }, { projection: { role: 1 } });
    if (!target) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });
    if (target.role !== role) {
      roleChange = { from: String(target.role), to: role };
      patch.role = role;
      // Approved straight away — the super admin chose this type for them.
      Object.assign(patch, { verification: 'approved', verified: true, verification_note: '', verified_at: now, verified_by: me.email });
      if (role === 'developer') patch.access = access || 'editor';
    }
  }
  if (access && !roleChange) {
    const me = await getCurrentUser();
    if (!me || me.role !== 'admin') {
      return NextResponse.json({ error: { message: 'Only the super admin can change access.' } }, { status: 403 });
    }
    const target = await users.findOne({ id, ...ROLE_FILTER }, { projection: { role: 1 } });
    if (!target || target.role !== 'developer') {
      return NextResponse.json({ error: { message: 'Access levels apply to developer accounts only.' } }, { status: 400 });
    }
    patch.access = access;
  }
  if (decision) {
    const me = await getCurrentUser();
    if (!me || me.role !== 'admin') {
      return NextResponse.json({ error: { message: 'Only the super admin can approve or reject accounts.' } }, { status: 403 });
    }
    const target = await users.findOne({ id, ...ROLE_FILTER }, { projection: { role: 1 } });
    if (!target) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });
    if (!needsVerification(target.role)) {
      return NextResponse.json({ error: { message: 'Buyer accounts do not need verification.' } }, { status: 400 });
    }
    if (decision === 'reject' && !reason) {
      return NextResponse.json({ error: { message: 'Please give a reason — the applicant will see it.' } }, { status: 400 });
    }
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'pending';
    Object.assign(patch, {
      verification: status,
      verified: status === 'approved',
      verification_note: decision === 'reject' ? reason : '',
      verified_at: decision === 'reset' ? null : now,
      verified_by: decision === 'reset' ? null : me.email,
    });
  }
  const res = await users.updateOne({ id, ...ROLE_FILTER }, { $set: patch });
  if (!res.matchedCount) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });
  if (roleChange) forgetAccount(id); // their open session picks up the new dashboard right away
  const row = await users.findOne({ id });
  if (row) {
    const actor = (await getCurrentUser())?.email;
    const who = { user_id: id, email: String(row.email), name: row.name ? String(row.name) : undefined, role: String(row.role), actor };
    const level = row.role === 'developer' ? (row.access === 'viewer' ? 'Viewer — live map only' : 'Editor — can add projects') : '';
    if (decision === 'approve') await logActivity({ ...who, type: 'approved', detail: `Account verified — dashboard unlocked${level ? ` as ${level}` : ''}` });
    else if (access) await logActivity({ ...who, type: 'access', detail: `Access changed to ${level}` });
    if (decision === 'reject') await logActivity({ ...who, type: 'rejected', detail: `Application rejected: ${reason}` });
    if (decision === 'reset') await logActivity({ ...who, type: 'reset', detail: 'Moved back to pending verification' });
    if (password) await logActivity({ ...who, type: 'password_reset', detail: 'Password reset by staff' });
    if (typeof notes === 'string') await logActivity({ ...who, type: 'notes', detail: 'Internal notes updated' });
    if (roleChange?.to === 'buyer') {
      await addBuyerSignupLead({
        id, name: row.name as string | undefined, email: String(row.email), mobile: row.mobile as string | undefined,
        profile: row.profile as Record<string, string> | undefined, provider: row.provider === 'google' ? 'google' : 'password',
      });
    }
    if (roleChange) {
      const label = (r: string) => ({ buyer: 'Buyer', developer: 'Developer', agent: 'Channel partner' } as Record<string, string>)[r] || r;
      await logActivity({ ...who, type: 'role_changed', detail: `Account type changed from ${label(roleChange.from)} to ${label(roleChange.to)}${level ? ` (${level})` : ''}` });
    }
    if (editingDetails) await logActivity({ ...who, type: 'profile_edited', detail: `Account details updated by staff${email ? ' (login email changed)' : ''}` });
  }
  return NextResponse.json({ data: row ? clean(row) : null });
}

export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('accounts'))) return unauthorized();
  const ids = idsParam(req.nextUrl.searchParams);
  if (!ids.length) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400 });
  const db = await getDb();
  const actor = (await getCurrentUser())?.email;
  let deleted = 0;
  for (const id of ids) {
    // Scoped to public roles so this can never remove the owner or an employee.
    const gone = await db.collection<AnyDoc>('users').findOne({ id, ...ROLE_FILTER });
    if (!gone) continue;
    // A full copy goes to Backups → Recycle bin first, so it can be restored.
    await moveToTrash({
      kind: 'account', label: String(gone.name || gone.email), sub: `${String(gone.email)} · ${String(gone.role)}`,
      docs: [{ collection: 'users', doc: gone }], deletedBy: actor,
    });
    await db.collection<AnyDoc>('users').deleteOne({ id, ...ROLE_FILTER });
    forgetAccount(id); // their existing session stops working immediately
    deleted++;
    await logActivity({
      user_id: id, email: String(gone.email), name: gone.name ? String(gone.name) : undefined, role: String(gone.role),
      type: 'deleted', detail: 'Account deleted by staff (in the recycle bin)', actor,
    });
  }
  return NextResponse.json({ data: { ok: true, deleted } });
}
