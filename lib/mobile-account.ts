import { getDb } from './mongodb';
import { PHONE_ERROR, normalizePhone, splitPhone } from './phone';

const PUBLIC_ROLES = ['buyer', 'developer', 'agent', 'admin', 'employee'];

type Found =
  | { ok: true; user: Record<string, unknown>; mobile: string }
  | { ok: false; status: number; message: string };

/**
 * The account registered with this mobile / WhatsApp number. Numbers are stored
 * as "+91 9876543210", but older rows may hold "9876543210" or "+919876543210",
 * so those spellings are matched too. Two accounts sharing a number can't be
 * told apart by the number alone — those users must use their email.
 */
export async function findAccountByMobile(value: unknown): Promise<Found> {
  const mobile = normalizePhone(value, { required: true });
  if (!mobile) return { ok: false, status: 400, message: PHONE_ERROR };
  const { code, number } = splitPhone(mobile);
  const spellings = [mobile, number, `${code}${number}`, `${code.slice(1)}${number}`, `${code}-${number}`];
  const users = await (await getDb()).collection('users')
    .find({ mobile: { $in: spellings } })
    .limit(3).toArray();
  const accounts = users.filter((u) => PUBLIC_ROLES.includes(String(u.role || 'buyer')));
  if (!accounts.length) return { ok: false, status: 404, message: 'No account found with this mobile number.' };
  if (accounts.length > 1) return { ok: false, status: 409, message: 'More than one account uses this number — please use your email instead.' };
  return { ok: true, user: accounts[0], mobile };
}

/**
 * What a "quick" WhatsApp code (/api/auth/otp purpose 'quick') is bound to:
 * the existing account's last sign-in, so a code works once — or 'new' when no
 * account has the number yet, so it can't be replayed once one is created.
 */
export function quickOtpBind(user: Record<string, unknown> | null): string {
  return user ? `${String(user.id || user._id)}|${String(user.last_login_at || '')}` : 'new';
}
