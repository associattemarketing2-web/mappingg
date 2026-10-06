import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

// Server-side authentication helpers. Replaces Supabase Auth (GoTrue).
//
// - Passwords are stored as bcrypt hashes in the `users` collection.
// - A signed JWT is issued on login and stored in an HTTP-only, Secure,
//   SameSite=Lax cookie so it is never readable by client JavaScript (XSS-safe)
//   and is not sent cross-site (CSRF-mitigating).

export const SESSION_COOKIE = 'mg_session';
// Stay signed in until an explicit sign-out: a long-lived session so users don't
// have to log in again and again. The cookie + JWT both last this long and are
// only cleared by logout (clearSessionCookie).
const SESSION_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

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

// ---------------------------------------------------------------------------
// The JWT alone is not enough to trust a session for 60 days: an employee who
// is deleted, or an account whose role changes, would otherwise keep their old
// access (and the rolling refresh in /api/auth/session would extend it). So a
// verified token is also checked against the `users` table — cached briefly per
// user so this costs one indexed lookup per user per ACCOUNT_TTL_MS, not one per
// request. A database error falls back to the signed token (never locks
// everyone out during a blip); a missing account is treated as signed out.
const ACCOUNT_TTL_MS = 30_000;
type AccountCheck = { role: string | null; exp: number };
const g = globalThis as unknown as { __accountCheck?: Map<string, AccountCheck> };
const accountCheck: Map<string, AccountCheck> = g.__accountCheck || (g.__accountCheck = new Map());

async function currentRoleOf(user: SessionUser): Promise<string | null> {
  const hit = accountCheck.get(user.id);
  if (hit && hit.exp > Date.now()) return hit.role;
  try {
    const { getDb } = await import('./mongodb');
    const db = await getDb();
    const doc = await db.collection('users').findOne({ id: user.id }, { projection: { role: 1 } });
    const role = doc ? String(doc.role || 'admin') : null; // same default as login
    if (accountCheck.size > 5000) accountCheck.clear();
    accountCheck.set(user.id, { role, exp: Date.now() + ACCOUNT_TTL_MS });
    return role;
  } catch {
    return user.role;
  }
}

/** Forget the cached account check (call after changing or deleting an account). */
export function forgetAccount(userId: string) {
  accountCheck.delete(userId);
}

/** Reads and verifies the current session from the request cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await verifySessionToken(token);
  if (!user) return null;
  const role = await currentRoleOf(user);
  if (!role) return null; // account no longer exists
  return role === user.role ? user : { ...user, role };
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

/** Where a signed-in user lands: staff → super-admin; everyone else → their own
 *  role dashboard at a consistent /dashboard/<role> URL. */
export function homePathFor(role?: string): string {
  if (isStaffRole(role)) return '/dashboard/s-admin';
  if (role === 'developer') return '/dashboard/developer';
  if (role === 'agent') return '/dashboard/agent';
  return '/dashboard/buyer';
}
