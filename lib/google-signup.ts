import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

// A first-time Google sign-in does NOT create an account straight away. Google
// only tells us the name and email, so the person first fills in the same
// sign-up form as everyone else (account type, WhatsApp number, that type's
// details) at /dashboard/complete-signup. Until then the verified Google
// profile waits in this short-lived, signed, HTTP-only cookie; the account is
// created by /api/auth/google/complete when they submit the form.

export const GOOGLE_PENDING_COOKIE = 'mg_google_pending';
export const COMPLETE_SIGNUP_PATH = '/dashboard/complete-signup';
const MAX_AGE = 60 * 30; // 30 minutes to finish the form

export interface PendingGoogleSignup { email: string; name: string; sub: string }

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set (server-only).');
  return new TextEncoder().encode(s);
}

export async function setPendingGoogleSignup(p: PendingGoogleSignup): Promise<void> {
  const token = await new SignJWT({ email: p.email, name: p.name, purpose: 'google-signup' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  cookies().set(GOOGLE_PENDING_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: MAX_AGE,
  });
}

/** The Google profile waiting to become an account, or null (none / expired / tampered). */
export async function getPendingGoogleSignup(): Promise<PendingGoogleSignup | null> {
  const token = cookies().get(GOOGLE_PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== 'google-signup' || !payload.sub || !payload.email) return null;
    return { email: String(payload.email).toLowerCase(), name: String(payload.name || ''), sub: String(payload.sub) };
  } catch {
    return null;
  }
}

export function clearPendingGoogleSignup(): void {
  cookies().set(GOOGLE_PENDING_COOKIE, '', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0,
  });
}
