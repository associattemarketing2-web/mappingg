import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES, clearSessionCookie, forgetAccount, getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { parseDeleteRequest } from '@/lib/account-deletion-rules';
import { anonymiseActivity, deleteAccountData } from '@/lib/account-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Self-service account deletion for buyers, developers and channel partners.
// Called by the mobile app (src/services/account.ts → deleteAccount) and the
// /delete-account page. What is deleted or anonymised: lib/account-deletion.ts.
//
// Error codes the app relies on:
//   400 wrong_password: deliberately not 401, which would sign the person out
//   400 no_password:    Google / WhatsApp-code account, handled by a request instead
//   403 staff:          team accounts are managed by the owner

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return fail(401, 'signed_out', 'Please sign in again.');
  if (!(PUBLIC_ROLES as readonly string[]).includes(me.role)) return fail(403, 'staff', 'Team accounts are managed by the owner.');

  const limited = rateLimit(`acct-delete:${me.id}`, 5, 15 * 60_000) || rateLimit(`acct-delete-ip:${clientIp(req)}`, 20, 15 * 60_000);
  if (limited) return limited;

  const parsed = parseDeleteRequest(await req.json().catch(() => null));
  if (!parsed.ok) return fail(400, 'invalid', 'Enter your password to confirm.');

  const db = await getDb();
  const user = await db.collection('users').findOne({ id: me.id, role: { $in: [...PUBLIC_ROLES] } });
  if (!user) return fail(400, 'no_account', 'This account no longer exists.');
  if (!user.password_hash) return fail(400, 'no_password', 'This account has no password. We will handle the deletion by email.');
  if (!(await bcrypt.compare(parsed.password, String(user.password_hash)))) return fail(400, 'wrong_password', 'That password is not correct.');

  try {
    await deleteAccountData(me.id);
  } catch (e) {
    console.error('[account-delete] failed for', me.id, e instanceof Error ? e.message : e);
    return fail(500, 'server', 'We could not delete your account just now. Please try again in a minute.');
  }
  forgetAccount(me.id); // other devices are signed out on their next request

  // Confirmation email to the person and a notice to the team. The log entry
  // this writes is then wiped of personal details like the rest.
  await logActivity({
    user_id: me.id, email: String(user.email || me.email), name: user.name ? String(user.name) : undefined, role: String(user.role),
    type: 'deleted', detail: 'Account deleted by its owner',
  });
  await anonymiseActivity(me.id).catch(() => undefined);

  clearSessionCookie();
  return NextResponse.json({ data: { ok: true } }, { headers: { 'Cache-Control': 'private, no-store' } });
}
