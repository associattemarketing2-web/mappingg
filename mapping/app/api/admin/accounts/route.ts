import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES, getCurrentUser } from '@/lib/auth';
import { needsVerification, verificationOf } from '@/lib/verification';
import { hasPermission } from '@/lib/staff';

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
  return NextResponse.json({ data: rows.map(clean) });
}

const patchSchema = z.object({
  id: z.string().min(1),
  // Verification decision — super admin (owner) only. A rejection needs a reason
  // the applicant will see on their dashboard.
  decision: z.enum(['approve', 'reject', 'reset']).optional(),
  reason: z.string().trim().max(1000).optional(),
  notes: z.string().max(4000).optional(),
  password: z.string().min(8).max(200).optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await hasPermission('accounts'))) return unauthorized();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Invalid request (passwords need at least 8 characters).' } }, { status: 400 });
  }
  const { id, decision, reason, notes, password } = parsed.data;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (typeof notes === 'string') patch.notes = notes;
  if (password) patch.password_hash = await bcrypt.hash(password, 12);

  const db = await getDb();
  const users = db.collection<AnyDoc>('users');
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
  const row = await users.findOne({ id });
  return NextResponse.json({ data: row ? clean(row) : null });
}

export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('accounts'))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400 });
  const db = await getDb();
  // Scoped to public roles so this can never remove the owner or an employee.
  await db.collection<AnyDoc>('users').deleteOne({ id, ...ROLE_FILTER });
  return NextResponse.json({ data: { ok: true } });
}
