import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

// Server-side authentication helpers. Replaces Supabase Auth (GoTrue).
//
// - Passwords are stored as bcrypt hashes in the `users` collection.
// - A signed JWT is issued on login and stored in an HTTP-only, Secure,
//   SameSite=Lax cookie so it is never readable by client JavaScript (XSS-safe)
//   and is not sent cross-site (CSRF-mitigating).

export const SESSION_COOKIE = 'mg_session';
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours, mirrors a typical admin session.

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set (server-only).');
  return new TextEncoder().encode(s);
}

export interface SessionUser {
  id: string;
  email: string;
  role: string;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      id: String(payload.sub),
      email: String(payload.email || ''),
      role: String(payload.role || 'admin'),
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(token: string) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Reads and verifies the current session from the request cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// Staff (owner + employees) run the super-admin and may write map data. Public
// accounts (buyer / developer / agent) only get their own dashboard.
export const STAFF_ROLES = ['admin', 'employee'];
export const PUBLIC_ROLES = ['buyer', 'developer', 'agent'] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export const isStaffRole = (role?: string) => STAFF_ROLES.includes(String(role));

/** The current session only if it belongs to staff — use this to guard admin data. */
export async function getStaffUser(): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  return user && isStaffRole(user.role) ? user : null;
}

/** Where a signed-in user lands: staff → super-admin, buyers → the live map, developers/agents → their dashboard. */
export function homePathFor(role?: string): string {
  if (isStaffRole(role)) return '/s-admin';
  if (role === 'buyer') return '/map';
  return '/dashboard';
}
