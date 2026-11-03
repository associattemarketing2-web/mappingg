import { z } from 'zod';

// Pure rules for self-service account deletion, kept free of I/O so they can be
// unit-tested. The database work is in lib/account-deletion.ts.

export const DELETED_NAME = 'Deleted account';

/** Replaces a lead's personal details. Project, dates and status are kept. */
export function anonymisedLeadPatch(now: string): Record<string, unknown> {
  return {
    name: DELETED_NAME,
    email: '',
    phone: '',
    whatsapp: '',
    mobile: '',
    message: '',
    notes: '',
    consent: null,
    account_id: '',
    account_deleted_at: now,
  };
}

/** Replaces an activity entry's personal details. Type, time and detail are kept. */
export const ANONYMISED_ACTIVITY = { email: '', name: DELETED_NAME, ip: '', device: '', actor: '' } as const;

const schema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal('DELETE'),
});

export type DeleteRequest = { ok: true; password: string } | { ok: false };

/** The request body the mobile app and /delete-account send: { password, confirm: 'DELETE' }. */
export function parseDeleteRequest(raw: unknown): DeleteRequest {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, password: r.data.password } : { ok: false };
}
