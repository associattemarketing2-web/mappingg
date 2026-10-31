import { createHmac, timingSafeEqual } from 'node:crypto';

// Project share links made by the super admin ("Copy share link"):
// /map?share=<token>. A guest who opens one sees the live map with only that
// project, may open its card 3 times, and is then asked to create an account
// (components/MapAuthGate.tsx + the map script's share mode). The token is the
// pin id plus an HMAC, so editing the link can't unlock a different project.

const b64 = (s: string) => Buffer.from(s).toString('base64url');

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}
const sign = (payload: string) => createHmac('sha256', secret()).update(`share|${payload}`).digest('base64url').slice(0, 22);

export function shareToken(pinId: string): string {
  const payload = b64(pinId);
  return `${payload}.${sign(payload)}`;
}

/** The pin id inside a valid token, else null. */
export function pinFromShareToken(token: unknown): string | null {
  const [payload, mac] = String(token ?? '').split('.');
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try { return Buffer.from(payload, 'base64url').toString() || null; } catch { return null; }
}

/** How many times a guest may open the shared project's card before signing up. */
export const SHARE_FREE_VIEWS = 3;
