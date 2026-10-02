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
