import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { getDb } from '@/lib/mongodb';
import { createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { addBuyerSignupLead } from '@/lib/signup-leads';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { checkOtp } from '@/lib/otp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public self-sign-up for buyers, developers and channel partners. Staff roles
// (admin / employee) can never be created here — only via seed-admin or the
// Employees tab. Each role keeps its own profile fields from the sign-up form.
// Every field is required except a developer's website — the form marks them the same way.
const req = (max = 120) => z.string().trim().min(1).max(max);

const base = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  mobile: z.string().trim().max(24),
  password: z.string().min(8).max(200),
  // The 6-digit code emailed by /api/auth/otp (purpose 'signup') and its ticket.
  otp: z.string().trim().max(12),
  ticket: z.string().max(1000),
});

const schema = z.discriminatedUnion('role', [
  base.extend({
    role: z.literal('buyer'),
    profile: z.object({
      area: req(), configuration: req(), budget: req(), timeline: req(), purpose: req(),
    }),
  }),
  base.extend({
    role: z.literal('developer'),
    profile: z.object({
      company: req(160), designation: req(), activeProjects: req(),
      // Website is the one optional field (many developers don't have one).
      reraProject: z.string().trim().min(4).max(40), website: z.string().trim().max(300).optional().default(''),
    }),
  }),
  base.extend({
    role: z.literal('agent'),
    profile: z.object({
      agency: req(160),
      reraAgent: z.string().trim().min(4).max(40), areas: req(300),
    }),
  }),
]);

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Please fill in all required fields correctly.' } }, { status: 400 });
  }
  const { name, email, password, role, profile } = parsed.data;
  // Country code (default +91) + exactly 10 digits, stored as "+91 9876543210".
  const mobile = normalizePhone(parsed.data.mobile, { required: true });
  if (!mobile) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });

  const limited = rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000) || rateLimit(`signup-otp:${email}`, 8, 15 * 60_000);
  if (limited) return limited;

  // The email must be verified with the code we sent to it.
  const badOtp = checkOtp(parsed.data.ticket, parsed.data.otp, email, 'signup');
  if (badOtp) return NextResponse.json({ error: { message: badOtp, code: 'otp' } }, { status: 400 });

  const db = await getDb();
  const users = db.collection<{ _id: string; [key: string]: unknown }>('users');
  if (await users.findOne({ email })) {
    return NextResponse.json({ error: { message: 'An account with this email already exists — please sign in.' } }, { status: 409 });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    await users.insertOne({
      _id: id, id, email, name, mobile, role, profile, email_verified: true,
      password_hash: await bcrypt.hash(password, 12),
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
  if (role === 'buyer') await addBuyerSignupLead({ id, name, email, mobile, profile: profile as Record<string, string>, provider: 'password', created_at: now });
  await logActivity({
    user_id: id, email, name, role, type: 'signup',
    detail: role === 'buyer' ? 'Buyer account created' : `${role === 'developer' ? 'Developer' : 'Channel partner'} account created — awaiting verification`,
  });
  setSessionCookie(await createSessionToken(sessionUser));
  return NextResponse.json({ user: { ...sessionUser, name, verified: role === 'buyer' }, redirect: homePathFor(role) });
}
