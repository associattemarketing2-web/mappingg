import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

// Hand-rolled Google OAuth 2.0 (Authorization Code + PKCE), layered on top of
// the existing mg_session JWT cookie (see lib/auth.ts). We deliberately do NOT
// pull in a framework (NextAuth) — the app already owns its sessions, and this
// keeps password login and Google login issuing the exact same cookie.
//
// Secrets (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are read server-side only
// and never reach the client. See .env.example.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export const OAUTH_STATE_COOKIE = 'mg_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'mg_oauth_verifier';
const TEMP_COOKIE_MAX_AGE = 600; // 10 minutes — the login round-trip.

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * The absolute redirect URI registered in the Google Cloud console. Prefers the
 * configured public origin; falls back to the request's own origin so it works
 * across environments (the value must still be whitelisted in the console).
 * In local development the request's own origin (e.g. http://localhost:3000)
 * is used, so Google doesn't send a local sign-in back to the live site.
 */
export function redirectUri(req: NextRequest): string {
  const site = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') : '';
  const origin = site || req.nextUrl.origin;
  return `${origin}/api/auth/google/callback`;
}

/** Builds the Google consent URL and sets short-lived state + PKCE cookies. */
export function buildAuthRequest(req: NextRequest): string {
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());

  const jar = cookies();
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: TEMP_COOKIE_MAX_AGE,
  };
  jar.set(OAUTH_STATE_COOKIE, state, common);
  jar.set(OAUTH_VERIFIER_COOKIE, verifier, common);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Exchanges the authorization code for tokens (using the stored PKCE verifier)
 * and returns the verified Google profile. Throws on any failure.
 */
export async function exchangeCode(req: NextRequest, code: string): Promise<GoogleProfile> {
  const verifier = cookies().get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!verifier) throw new Error('Missing PKCE verifier cookie');

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(req),
  });

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error('No access token returned');

  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
  });
  if (!infoRes.ok) throw new Error(`Userinfo failed (${infoRes.status})`);
  const info = (await infoRes.json()) as {
    sub?: string; email?: string; email_verified?: boolean; name?: string;
  };
  if (!info.sub || !info.email) throw new Error('Incomplete Google profile');

  return {
    sub: info.sub,
    email: info.email.toLowerCase(),
    emailVerified: info.email_verified !== false,
    name: String(info.name || ''),
  };
}

/** Clears the temporary OAuth round-trip cookies. */
export function clearOAuthTempCookies(): void {
  const jar = cookies();
  const expire = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 0 };
  jar.set(OAUTH_STATE_COOKIE, '', expire);
  jar.set(OAUTH_VERIFIER_COOKIE, '', expire);
}
