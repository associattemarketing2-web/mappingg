import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { emailOtp, issueOtp } from '@/lib/otp';
import { mailConfigured } from '@/lib/mailer';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/otp — emails a 6-digit code and returns the signed ticket the
// browser sends back with it (see lib/otp.ts).
//   purpose 'signup' → before creating an account (email must be new)
//   purpose 'reset'  → "Forgot password?" (email must have an account)
const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  purpose: z.enum(['signup', 'reset']),
  name: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Enter a valid email address.' } }, { status: 400 });
  const { email, purpose } = parsed.data;

  const ip = clientIp(req);
  const limited = rateLimit(`otp:${ip}:${email}`, 5, 15 * 60_000) || rateLimit(`otp-ip:${ip}`, 20, 60 * 60_000);
  if (limited) return limited;
  if (!mailConfigured()) return NextResponse.json({ error: { message: 'Email is not set up on the server yet. Please contact us.' } }, { status: 503 });

  const user = await (await getDb()).collection('users').findOne({ email }, { projection: { name: 1, role: 1, password_hash: 1 } });
  if (purpose === 'signup' && user) {
    return NextResponse.json({ error: { message: 'An account with this email already exists — please sign in.' } }, { status: 409 });
  }
  if (purpose === 'reset' && (!user || !['buyer', 'developer', 'agent', 'admin', 'employee'].includes(String(user.role || 'buyer')))) {
    return NextResponse.json({ error: { message: 'No account found with this email.' } }, { status: 404 });
  }

  // The reset ticket is bound to the current password, so it is single-use.
  const { code, ticket } = issueOtp(email, purpose, purpose === 'reset' ? String(user?.password_hash || 'none') : '');
  const sent = await emailOtp(email, code, purpose, parsed.data.name || (user?.name ? String(user.name) : undefined));
  if (!sent) return NextResponse.json({ error: { message: 'Could not send the email. Please try again in a minute.' } }, { status: 502 });
  return NextResponse.json({ data: { sent: true, ticket } }, { headers: { 'Cache-Control': 'private, no-store' } });
}
