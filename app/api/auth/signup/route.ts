import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { getDb } from '@/lib/mongodb';
import { createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { addBuyerSignupLead } from '@/lib/signup-leads';
import { whatsappBuyerWelcome } from '@/lib/whatsapp';
import { clientIp, rateLimit, rateLimitShared } from '@/lib/rate-limit';
import { checkOtp, otpEnabled } from '@/lib/otp';
import { withRoleProfiles } from '@/lib/signup-profile';
import { findAccountByMobile } from '@/lib/mobile-account';
import { placeholderEmail } from '@/lib/phone-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public self-sign-up for buyers, developers and channel partners. Staff roles
// (admin / employee) can never be created here — only via seed-admin or the
// Employees tab. Each role keeps its own profile fields from the sign-up form.
const base = z.object({
  name: z.string().trim().min(1).max(120),
  // Optional for buyers while WhatsApp codes are paused (lib/otp.ts otpEnabled):
  // they can sign up with just mobile + password and sign in with the number.
  email: z.union([z.string().trim().toLowerCase().email(), z.literal('')]).optional().default(''),
  mobile: z.string().trim().max(24),
  // At least 8 characters. Forgotten? "Forgot password" resets it with a WhatsApp code.
  password: z.string().min(8).max(200),
  // The 6-digit WhatsApp code from /api/auth/otp (purpose 'signup') and its ticket.
  // Only checked while OTP_ENABLED=true.
  otp: z.string().trim().max(12).optional().default(''),
  ticket: z.string().max(1000).optional().default(''),
});
// Each role's own fields (lib/signup-profile.ts) — optional for buyers; developers and agents need their company + RERA details.
const schema = withRoleProfiles(base);

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Please fill in all required fields correctly.' } }, { status: 400 });
  }
  const { name, password, role, profile } = parsed.data;
  // Country code (default +91) + exactly 10 digits, stored as "+91 9876543210".
  const mobile = normalizePhone(parsed.data.mobile, { required: true });
  if (!mobile) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });

  const useOtp = otpEnabled();
  // Email is needed with WhatsApp codes on (the code is tied to it) and always for
  // developers / agents. Buyers without one get a hidden stand-in (lib/phone-email.ts).
  if (!parsed.data.email && (useOtp || role !== 'buyer')) {
    return NextResponse.json({ error: { message: 'Enter a valid email address.' } }, { status: 400 });
  }
  const email = parsed.data.email || placeholderEmail(mobile);

  const limited = rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000) || (await rateLimitShared(`signup-otp:${email}`, 8, 15 * 60_000));
  if (limited) return limited;

  // The WhatsApp number must be verified with the code we sent to it; the
  // ticket is bound to that exact number. Skipped while codes are paused.
  if (useOtp) {
    const badOtp = checkOtp(parsed.data.ticket, parsed.data.otp, email, 'signup', mobile);
    if (badOtp) return NextResponse.json({ error: { message: badOtp, code: 'otp' } }, { status: 400 });
  }

  // One account per mobile number, so signing in with the number always finds it.
  const byMobile = await findAccountByMobile(mobile);
  if (byMobile.ok || byMobile.status === 409) {
    return NextResponse.json({ error: { message: 'An account with this mobile number already exists — please sign in.' } }, { status: 409 });
  }

  const db = await getDb();
  const users = db.collection<{ _id: string; [key: string]: unknown }>('users');
  if (await users.findOne({ email })) {
    return NextResponse.json({ error: { message: 'An account with this email already exists — please sign in.' } }, { status: 409 });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    await users.insertOne({
      _id: id, id, email, name, mobile, role, profile,
      mobile_verified: useOtp,
      ...(useOtp ? {} : { signup_method: 'password-no-otp' }),
      ...(password ? { password_hash: await bcrypt.hash(password, 12) } : {}),
      // Buyers get full access at once; developers and agents wait until the
      // super admin checks their details (MahaRERA number etc.).
      verified: role === 'buyer',
      verification: role === 'buyer' ? 'approved' : 'pending',
      created_at: now, updated_at: now,
    });
  } catch (e) {
    // Two sign-ups for the same email racing each other: the unique email
    // index rejects the second one — report it like any existing account.
    const code = (e as { code?: string | number }).code;
    if (code === '23505' || code === 11000) {
      return NextResponse.json({ error: { message: 'An account with this email already exists — please sign in.' } }, { status: 409 });
    }
    throw e;
  }

  const sessionUser = { id, email, role };
  // New buyers also show up as a lead in the super admin's Leads section.
  if (role === 'buyer') {
    await addBuyerSignupLead({ id, name, email: parsed.data.email, mobile, profile: profile as Record<string, string>, provider: 'password', created_at: now });
    // Congratulations message on WhatsApp. Never throws — a failed send does not block sign-up.
    // Not sent while WhatsApp is paused (it would only wait for a timeout).
    if (useOtp) await whatsappBuyerWelcome(mobile, name);
  }
  await logActivity({
    user_id: id, email, name, role, type: 'signup',
    detail: role === 'buyer' ? 'Buyer account created' : `${role === 'developer' ? 'Developer' : 'Channel partner'} account created — awaiting verification`,
  });
  setSessionCookie(await createSessionToken(sessionUser));
  return NextResponse.json({ user: { ...sessionUser, email: parsed.data.email, name, verified: role === 'buyer' }, redirect: homePathFor(role) });
}
