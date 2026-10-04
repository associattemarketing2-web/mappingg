import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES, createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { logActivity, recordLogin } from '@/lib/activity';
import {
  OAUTH_STATE_COOKIE,
  clearOAuthTempCookies,
  exchangeCode,
  googleConfigured,
} from '@/lib/google-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/google/callback — Google redirects here with ?code & ?state.
// We verify state (CSRF), exchange the code (PKCE), look up or create the user,
// then issue the same mg_session cookie password login uses.
//
// SECURITY: Google sign-in NEVER grants a staff role. An existing account keeps
// its stored role; a brand-new Google user is provisioned as a public `buyer`
// (lowest privilege, auto-approved), mirroring self-sign-up. Staff access still
// requires an admin to set the role in the Employees tab.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const fail = (code: string) => {
    clearOAuthTempCookies();
    // Land on the home sign-in modal so landing.js can show the error.
    return NextResponse.redirect(new URL(`/?signin=1&error=${code}`, origin));
  };

  if (!googleConfigured()) return fail('google_not_configured');

  const url = req.nextUrl;
  if (url.searchParams.get('error')) return fail('google_denied');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail('oauth_state');
  }

  let profile;
  try {
    profile = await exchangeCode(req, code);
  } catch {
    return fail('google_failed');
  }
  if (!profile.emailVerified) return fail('google_unverified');

  try {
    type UserRow = { _id: string; [key: string]: unknown };
    const db = await getDb();
    const users = db.collection<UserRow>('users');
    let user: UserRow | null = await users.findOne({ email: profile.email });

    if (!user) {
      // First-time Google sign-in → create a public buyer account (no password).
      const id = randomUUID();
      const now = new Date().toISOString();
      const doc: UserRow = {
        _id: id, id, email: profile.email, name: profile.name,
        role: 'buyer', provider: 'google', google_sub: profile.sub,
        verified: true, verification: 'approved',
        created_at: now, updated_at: now,
      };
      await users.insertOne(doc);
      await logActivity({ user_id: id, email: profile.email, name: profile.name, role: 'buyer', type: 'signup', detail: 'Buyer account created with Google' });
      user = doc;
    } else if (!user.google_sub) {
      // Existing account signing in with Google for the first time — link it.
      await users.updateOne({ _id: String(user._id) }, { $set: { google_sub: profile.sub, provider: user.provider || 'google' } });
    }

    const role = String(user.role || 'buyer');
    const sessionUser = { id: String(user.id || user._id), email: String(user.email), role };
    setSessionCookie(await createSessionToken(sessionUser));
    if ((PUBLIC_ROLES as readonly string[]).includes(role)) {
      await recordLogin({ ...sessionUser, name: String(user.name || '') }, 'google');
    }
    clearOAuthTempCookies();
    return NextResponse.redirect(new URL(homePathFor(role), origin));
  } catch {
    return fail('google_failed');
  }
}
