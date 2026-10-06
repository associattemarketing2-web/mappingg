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
