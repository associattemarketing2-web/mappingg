import { NextResponse } from 'next/server';
import { getCurrentUser, getStaffUser, type SessionUser } from '../auth';
import { isAvailable } from './db';
import { z } from 'zod';
import { SubError, type CheckoutRequest } from './lifecycle';

// Small helpers shared by the subscription API routes.

export const NO_STORE = { 'Cache-Control': 'private, no-store' };

export const ok = (data: unknown, status = 200) => NextResponse.json({ data }, { status, headers: NO_STORE });
export const fail = (message: string, status = 400, code?: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: { message, ...(code ? { code } : {}), ...extra } }, { status, headers: NO_STORE });

export function unavailable() {
  return fail('Subscriptions are temporarily unavailable.', 503, 'unavailable');
}

/** Signed-in public account (buyer / developer / agent) or a ready error response. */
export async function requireAccount(): Promise<{ user: SessionUser } | { res: NextResponse }> {
  if (!isAvailable()) return { res: unavailable() };
  const user = await getCurrentUser();
  if (!user) return { res: fail('Please sign in.', 401, 'unauthenticated') };
  if (!['buyer', 'developer', 'agent'].includes(user.role)) return { res: fail('Subscriptions are for buyer, channel partner and developer accounts.', 403, 'wrong_role') };
  return { user };
}

export async function requireStaff(): Promise<{ user: SessionUser } | { res: NextResponse }> {
  if (!isAvailable()) return { res: unavailable() };
  const user = await getStaffUser();
  if (!user) return { res: fail('Not authorized', 401) };
  return { user };
}

/** Owner-only admin actions (money, plans, settings). Employees can view but not change billing. */
export async function requireOwner(): Promise<{ user: SessionUser } | { res: NextResponse }> {
  const r = await requireStaff();
  if ('res' in r) return r;
  if (r.user.role !== 'admin') return { res: fail('Only the account owner can change billing.', 403) };
  return r;
}

export function errorResponse(e: unknown) {
  if (e instanceof SubError) return fail(e.message, e.status, e.code);
  console.error('[subscriptions]', e);
  return fail('Something went wrong. Please try again.', 500);
}

const checkoutSchema = z.object({
  plan: z.string().trim().min(1).max(60),
  project_ids: z.array(z.string().trim().min(1).max(100)).max(500).optional(),
  city: z.string().trim().max(40).nullish(),
  coupon: z.string().trim().max(40).nullish(),
  billing: z.object({
    name: z.string().max(120).optional(),
    gstin: z.string().max(20).optional(),
    address: z.string().max(300).optional(),
    state_code: z.string().max(2).optional(),
  }).partial().optional(),
}).strip();

/** Validated checkout input. Unknown fields (amount, price, user_id, status…) are dropped. */
export function checkoutBody(b: Record<string, unknown>): CheckoutRequest {
  const r = checkoutSchema.safeParse(b);
  if (!r.success) throw new SubError('Invalid request.', 400, 'invalid');
  return { plan: r.data.plan, project_ids: r.data.project_ids, city: r.data.city || null, coupon: r.data.coupon || null, billing: r.data.billing };
}

export async function readJson(req: Request): Promise<Record<string, any>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}
