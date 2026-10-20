import { z } from 'zod';
import { buildConsent, type ConsentRecord } from './consent';

// Request body of the signed-in "Enquire now" (app/api/my/enquire/route.ts),
// kept free of I/O so it can be unit-tested.
//
// The tap itself is the request to be contacted about this one project, so
// `enquiry` is recorded as true. Calls and WhatsApp about other projects/offers
// are separate opt-ins: only an explicit `true` in the body counts — they are
// never inferred from the account or the sign-up form.

const schema = z.object({
  pin_id: z.string().min(1).max(100),
  consent_call: z.boolean().optional(),
  consent_whatsapp: z.boolean().optional(),
  // "Book Site Visit" on the project panel instead of "Enquire now".
  site_visit: z.boolean().optional(),
});

export type EnquireRequest = { ok: true; pin_id: string; site_visit: boolean; consent: ConsentRecord } | { ok: false };

export function parseEnquireRequest(raw: unknown, now: Date = new Date()): EnquireRequest {
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false };
  return {
    ok: true,
    pin_id: p.data.pin_id,
    site_visit: p.data.site_visit === true,
    consent: buildConsent('enquireSignedIn', { enquiry: true, call: p.data.consent_call, whatsapp: p.data.consent_whatsapp }, now),
  };
}
