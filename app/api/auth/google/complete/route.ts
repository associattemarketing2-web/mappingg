import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { getDb } from '@/lib/mongodb';
import { createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { logActivity, recordLogin } from '@/lib/activity';
import { addBuyerSignupLead } from '@/lib/signup-leads';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { withRoleProfiles } from '@/lib/signup-profile';
import { clearPendingGoogleSignup, getPendingGoogleSignup } from '@/lib/google-signup';
import { homeForAccount } from '@/lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/google/complete — creates the account for a first-time Google
// sign-in once they have filled in the full sign-up form. The email comes from
// the signed Google cookie (already verified by Google), never from the form.
// Same fields and rules as the password sign-up, minus the password and OTP.
const schema = withRoleProfiles(z.object({
  name: z.string().trim().min(1).max(120),
  mobile: z.string().trim().max(24),
  terms: z.literal(true),
}));

export async function POST(req: NextRequest) {
  const pending = await getPendingGoogleSignup();
  if (!pending) {
    return NextResponse.json({ error: { message: 'Your Google sign-in expired — please continue with Google again.', code: 'expired' } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Please fill in all required fields and accept the terms.' } }, { status: 400 });
  }
  const { name, role, profile } = parsed.data;
  const mobile = normalizePhone(parsed.data.mobile, { required: true });
  if (!mobile) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });

  const limited = rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000);
  if (limited) return limited;

  const email = pending.email;
  const db = await getDb();
  const users = db.collection<{ _id: string; [key: string]: unknown }>('users');
  if (await users.findOne({ email })) {
    clearPendingGoogleSignup();
    return NextResponse.json({ error: { message: 'An account with this email already exists — please sign in.', code: 'exists' } }, { status: 409 });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    await users.insertOne({
      _id: id, id, email, name, mobile, role, profile,
      provider: 'google', google_sub: pending.sub, email_verified: true,
      // Buyers get full access at once; developers and agents wait for the super admin.
      verified: role === 'buyer',
      verification: role === 'buyer' ? 'approved' : 'pending',
      created_at: now, updated_at: now,
    });
  } catch (e) {
    const code = (e as { code?: string | number }).code;
    if (code === '23505' || code === 11000) {
      return NextResponse.json({ error: { message: 'An account with this email already exists — please sign in.', code: 'exists' } }, { status: 409 });
    }
    throw e;
  }

  const sessionUser = { id, email, role };
  if (role === 'buyer') await addBuyerSignupLead({ id, name, email, mobile, profile: profile as Record<string, string>, provider: 'google', created_at: now });
  await logActivity({
    user_id: id, email, name, role, type: 'signup',
    detail: role === 'buyer' ? 'Buyer account created with Google' : `${role === 'developer' ? 'Developer' : 'Channel partner'} account created with Google — awaiting verification`,
  });
  clearPendingGoogleSignup();
  setSessionCookie(await createSessionToken(sessionUser));
  await recordLogin({ ...sessionUser, name }, 'google');
  const doc = { role, mobile, verification: role === 'buyer' ? 'approved' : 'pending' };
  return NextResponse.json({ user: { ...sessionUser, name, verified: role === 'buyer' }, redirect: homeForAccount(doc, homePathFor(role)) });
}
