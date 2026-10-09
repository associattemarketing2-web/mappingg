import { normalizePhone } from './phone';

// Developer / builder and agent / channel-partner accounts must be checked by
// the super admin (RERA number etc.) before they get their dashboard. Buyers
// never need verification.
//
// Stored on the user document as `verification` (+ `verified` kept in sync for
// older code). Accounts created before this field existed only have `verified`.

export const VERIFICATION_STATES = ['pending', 'approved', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATES)[number];

export function needsVerification(role?: unknown): boolean {
  return role === 'developer' || role === 'agent';
}

export function verificationOf(doc: Record<string, unknown> | null | undefined): VerificationStatus {
  if (!doc || !needsVerification(doc.role)) return 'approved';
  if (VERIFICATION_STATES.includes(doc.verification as VerificationStatus)) return doc.verification as VerificationStatus;
  return doc.verified === false ? 'pending' : 'approved';
}

/** Mongo filter for accounts still waiting for a decision (old and new style). */
export const PENDING_FILTER = {
  role: { $in: ['developer', 'agent'] },
  $or: [{ verification: 'pending' }, { verification: { $exists: false }, verified: false }],
};

// What an approved developer may do, chosen by the super admin when approving:
//   'editor' — add / edit their own projects (held for review) + map editor
//   'viewer' — only the public live map, the same one every visitor sees
// Developers approved before this existed have no value and stay editors.
export const DEV_ACCESS = ['viewer', 'editor'] as const;
export type DevAccess = (typeof DEV_ACCESS)[number];

export function accessOf(doc: Record<string, unknown> | null | undefined): DevAccess {
  return doc?.role === 'developer' && doc.access === 'viewer' ? 'viewer' : 'editor';
}

/** True if this developer account may add or change projects. */
export async function canEditProjects(userId: string): Promise<boolean> {
  const { getDb } = await import('./mongodb');
  const db = await getDb();
  const doc = await db.collection('users').findOne({ id: userId }, { projection: { role: 1, access: 1, verification: 1, verified: 1 } });
  return !!doc && verificationOf(doc) === 'approved' && accessOf(doc) === 'editor';
}

// Every public account (buyer / developer / agent) must have a mobile number.
// Password sign-up asks for it; Google sign-in can't provide one, so those
// accounts (and any older account without one) are sent to this page first.
export const ADD_MOBILE_PATH = '/dashboard/add-mobile';

export function needsMobile(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc || !['buyer', 'developer', 'agent'].includes(String(doc.role || 'buyer'))) return false;
  return !normalizePhone(doc.mobile, { required: true });
}

/** Where this account lands after signing in. Same as homePathFor(role), except
 *  that approved agents / channel partners and approved view-only developers go
 *  straight to the public live map (agents' profile is at /dashboard/agent), and
 *  an account without a mobile number is asked for one first. */
export function homeForAccount(doc: Record<string, unknown> | null | undefined, fallback: string): string {
  if (needsMobile(doc)) return ADD_MOBILE_PATH;
  if (doc?.role === 'agent' && verificationOf(doc) === 'approved') return '/map';
  if (doc?.role === 'developer' && verificationOf(doc) === 'approved' && accessOf(doc) === 'viewer') return '/map';
  return fallback;
}
