import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public self-sign-up for buyers, developers and channel partners. Staff roles
// (admin / employee) can never be created here — only via seed-admin or the
// Employees tab. Each role keeps its own profile fields from the sign-up form.
// Every field is required — the form marks them all mandatory too.
const req = (max = 120) => z.string().trim().min(1).max(max);

const base = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  mobile: z.string().trim().regex(/^[+0-9 ]{10,16}$/),
  password: z.string().min(8).max(200),
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
      reraProject: z.string().trim().min(4).max(40), website: req(300),
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
  const { name, email, mobile, password, role, profile } = parsed.data;

  const limited = rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000);
  if (limited) return limited;

  const db = await getDb();
  const users = db.collection<{ _id: string; [key: string]: unknown }>('users');
  if (await users.findOne({ email })) {
    return NextResponse.json({ error: { message: 'An account with this email already exists — please sign in.' } }, { status: 409 });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  await users.insertOne({
    _id: id, id, email, name, mobile, role, profile,
    password_hash: await bcrypt.hash(password, 12),
    // Buyers get full access at once; developers and agents wait until the
    // super admin checks their details (MahaRERA number etc.).
    verified: role === 'buyer',
    verification: role === 'buyer' ? 'approved' : 'pending',
    created_at: now, updated_at: now,
  });

  const sessionUser = { id, email, role };
  await logActivity({
    user_id: id, email, name, role, type: 'signup',
    detail: role === 'buyer' ? 'Buyer account created' : `${role === 'developer' ? 'Developer' : 'Channel partner'} account created — awaiting verification`,
  });
  setSessionCookie(await createSessionToken(sessionUser));
  return NextResponse.json({ user: { ...sessionUser, name, verified: role === 'buyer' }, redirect: homePathFor(role) });
}
