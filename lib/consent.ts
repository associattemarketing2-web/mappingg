// Consent records for leads. One shape everywhere (contact form, live-map
// enquiry, signed-in "Enquire now"), stored on the lead as `consent`:
//
//   { enquiry, call, whatsapp, text, version, captured_at, source }
//
// - enquiry:  the person asked to be contacted about THIS enquiry/project.
// - call:     separate, optional opt-in to calls about matching projects/offers.
// - whatsapp: separate, optional opt-in to WhatsApp/SMS about matching projects/offers.
//
// Only a literal `true` counts. Missing, false, "yes", 1, null… are all "no" —
// the server never turns an absent or ambiguous value into permission.

export type ConsentPurpose = 'enquiry' | 'call' | 'whatsapp';

export interface ConsentRecord {
  enquiry: boolean;
  call: boolean;
  whatsapp: boolean;
  /** The exact wording of every option the person ticked (empty if none). */
  text: string;
  version: string;
  captured_at: string;
  source: string;
}

/** Wording shown to people, per form. Bump the version whenever the wording changes. */
export const CONSENT_FORMS = {
  contact: {
    version: 'contact-form-2026-10',
    source: 'Contact form (/contact)',
    text: {
      enquiry: 'I asked Associatte PropTech (Mappingg) to reply to this message.',
      call: 'Associatte PropTech (Mappingg) may call me about matching projects.',
      whatsapp: 'Associatte PropTech (Mappingg) may message me on WhatsApp about matching projects.',
    },
  },
  map: {
    version: 'map-enquiry-2026-10',
    source: 'Live-map enquiry form',
    text: {
      enquiry: 'I agree to the Privacy Policy and Terms, and to be contacted about this project enquiry.',
      call: 'Associatte PropTech (Mappingg) may call me about matching projects and offers.',
      whatsapp: 'Associatte PropTech (Mappingg) may message me on WhatsApp or SMS about matching projects and offers.',
    },
  },
  requirement: {
    version: 'buyer-requirement-2026-10',
    source: 'Buyer requirement form (/buyer-requirement)',
    text: {
      enquiry: 'I agree that Associatte PropTech (Mappingg) may contact me by phone, email or WhatsApp about homes that match this requirement, as described in the Privacy Policy.',
      call: 'Associatte PropTech (Mappingg) may also call me about other projects and offers.',
      whatsapp: 'Associatte PropTech (Mappingg) may also message me on WhatsApp or SMS about other projects and offers.',
    },
  },
  enquireSignedIn: {
    version: 'signed-in-enquire-2026-10',
    source: 'Signed-in "Enquire now" on the live map',
    text: {
      enquiry: 'Tapped "Enquire now" on this project while signed in.',
      call: 'Associatte PropTech (Mappingg) may call me about matching projects and offers.',
      whatsapp: 'Associatte PropTech (Mappingg) may message me on WhatsApp or SMS about matching projects and offers.',
    },
  },
} as const satisfies Record<string, { version: string; source: string; text: Record<ConsentPurpose, string> }>;

export type ConsentForm = keyof typeof CONSENT_FORMS;

/** True only for a literal boolean `true`. */
export const isExplicitYes = (v: unknown): boolean => v === true;

/** Builds the stored consent record from the raw choices a form sent. */
export function buildConsent(
  form: ConsentForm,
  choices: Partial<Record<ConsentPurpose, unknown>>,
  now: Date = new Date(),
): ConsentRecord {
  const f = CONSENT_FORMS[form];
  const yes = {
    enquiry: isExplicitYes(choices.enquiry),
    call: isExplicitYes(choices.call),
    whatsapp: isExplicitYes(choices.whatsapp),
  };
  return {
    ...yes,
    text: (['enquiry', 'call', 'whatsapp'] as const).filter((k) => yes[k]).map((k) => f.text[k]).join(' '),
    version: f.version,
    captured_at: now.toISOString(),
    source: f.source,
  };
}

/**
 * A live-map enquiry as sent by the public map (`leads` insert): turns its raw
 * checkbox values — `consent` (privacy + contact about this project, required),
 * `consent_call`, `consent_whatsapp` — into one server-stamped consent record.
 * The client's own consent fields are discarded, so it can't forge a timestamp,
 * version or wording. `ok` is false when the required box wasn't ticked.
 */
export function mapLeadConsent(values: Record<string, unknown>, now: Date = new Date()): { ok: boolean; values: Record<string, unknown> } {
  const { consent, consent_call, consent_whatsapp, consent_version, consent_text, consent_captured_at, ...rest } = values;
  void consent_version; void consent_text; void consent_captured_at;
  const record = buildConsent('map', { enquiry: consent, call: consent_call, whatsapp: consent_whatsapp }, now);
  return { ok: record.enquiry, values: { ...rest, consent: record } };
}

/** "Call + WhatsApp", "WhatsApp", or "None (reply to this enquiry only)" — for CRM remarks and admin emails. */
export function optInSummary(c: Pick<ConsentRecord, 'call' | 'whatsapp'>): string {
  return [c.call && 'Call', c.whatsapp && 'WhatsApp'].filter(Boolean).join(' + ') || 'None (reply to this enquiry only)';
}
