import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Small fixed-window rate limiter for the public write/auth endpoints (login,
// sign-up, contact form, map lead capture). In-process memory is the right fit
// here: the app runs as a single Node server (see render.yaml). If it is ever
// scaled to several instances, each instance enforces its own window — still a
// useful brake on brute force and spam, just per instance.

type Window = { count: number; resetAt: number };
const g = globalThis as unknown as { __rateLimit?: Map<string, Window> };
const windows: Map<string, Window> = g.__rateLimit || (g.__rateLimit = new Map());

function sweep(now: number) {
  if (windows.size < 10_000) return;
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}

/** Client IP as seen by the platform proxy (first hop of X-Forwarded-For). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || req.ip || 'unknown').trim();
}

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { data: null, error: { message: 'Too many attempts. Please wait a moment and try again.' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfterSec)), 'Cache-Control': 'private, no-store' } },
  );
}

/**
 * Like rateLimit(), but the count is also kept in Postgres (api_counters, the
 * table the Developer API already uses), so the limit holds across serverless
 * instances and cold starts. Production runs on Vercel, where each instance has
 * its own memory: the in-process limiter alone let a distributed brute force
 * through (seo-doc/SECURITY-AUDIT.md SEC-2).
 *
 * Use it for low-volume, high-value endpoints (sign-in, codes, password reset,
 * sign-up): each call is one small database write. The in-memory check runs first
 * (free); a database error falls back to it alone, so an outage never locks
 * everyone out.
 */
export async function rateLimitShared(key: string, limit: number, windowMs: number): Promise<NextResponse | null> {
  const local = rateLimit(key, limit, windowMs);
  if (local) return local;
  try {
    const { query } = await import('./pg');
    const { rows } = await query<{ n: number; ttl: number }>(
      `INSERT INTO api_counters (k, n, expires_at)
         VALUES ($1, 1, now() + ($2::int * interval '1 millisecond'))
       ON CONFLICT (k) DO UPDATE SET
         n = CASE WHEN api_counters.expires_at <= now() THEN 1 ELSE api_counters.n + 1 END,
         expires_at = CASE WHEN api_counters.expires_at <= now() THEN EXCLUDED.expires_at ELSE api_counters.expires_at END
       RETURNING n, CEIL(EXTRACT(EPOCH FROM (expires_at - now())))::int AS ttl`,
      [`rl:${key}`.slice(0, 300), Math.round(windowMs)],
    );
    const row = rows[0];
    if (row && Number(row.n) > limit) return tooMany(Number(row.ttl) || Math.ceil(windowMs / 1000));
  } catch (e) {
    console.warn('[rate-limit] shared counter unavailable, using in-memory only:', (e as Error)?.message || e);
  }
  return null;
}

/**
 * Counts one hit against `key`. Returns null when allowed, or a ready 429
 * response (with Retry-After) once `limit` hits happen within `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): NextResponse | null {
  const now = Date.now();
  sweep(now);
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  if (w.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  return NextResponse.json(
    { data: null, error: { message: 'Too many attempts. Please wait a moment and try again.' } },
    { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'private, no-store' } },
  );
}
