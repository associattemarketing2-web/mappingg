import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from './phone';
import { buildConsent, type ConsentRecord } from './consent';

// Validation for the public contact form (app/api/contact/route.ts), kept free of
// I/O so it can be unit-tested. The route does the saving, CRM push and emails.

const opt = (max: number) => z.string().trim().max(max).optional().default('');
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: opt(200),
  phone: opt(40),
  subject: opt(120),
  message: opt(4000),
  // What a home buyer is looking for (all optional; sent by the "Buying a home" topic).
  city: opt(40),
  locality: opt(120),
  budget: opt(40),
  bhk: opt(40),
  timeline: opt(40),
  // The project the enquiry is about ("Enquire" on a project page / home card).
  // The route checks the number against the public pins and uses the real title.
  project: opt(200),
  project_number: z.coerce.number().int().positive().max(1_000_000).optional().catch(undefined),
  // Separate, unticked opt-ins. Replying to this enquiry itself needs neither.
  consent_call: z.boolean().optional().default(false),
  consent_whatsapp: z.boolean().optional().default(false),
  company: z.string().optional(), // honeypot, checked before parsing
});

export interface ContactLead {
  name: string; email: string; phone: string; subject: string; message: string;
  city?: string; locality?: string; budget?: string; bhk?: string; timeline?: string;
  project?: string; project_number?: number;
  consent: ConsentRecord;
}

export type ContactResult =
  | { kind: 'spam' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; lead: ContactLead };

/** True when the hidden honeypot field (never shown to people) has any content. */
export function isHoneypotHit(raw: unknown): boolean {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).company : undefined;
  return v != null && String(v).trim() !== '';
}

export function parseContactSubmission(raw: unknown, now: Date = new Date()): ContactResult {
  if (isHoneypotHit(raw)) return { kind: 'spam' };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { kind: 'invalid', message: 'Please fill in your name and a message.' };
  const d = parsed.data;

  // "Looking for: 3 BHK · Budget: ₹1 – 2 Cr · …", the same layout as buyer sign-up leads.
  const needs = [
    d.bhk && `Looking for: ${d.bhk}`, d.budget && `Budget: ${d.budget}`,
    (d.locality || d.city) && `Preferred area: ${[d.locality, d.city].filter(Boolean).join(', ')}`,
    d.timeline && `Planning to buy: ${d.timeline}`,
  ].filter(Boolean).join(' · ');
  const about = d.project ? `Project: ${d.project}${d.project_number ? ` (#${d.project_number})` : ''}` : '';
  if (!d.message && !needs && !about) return { kind: 'invalid', message: 'Please add a message or tell us what you’re looking for.' };

  const phone = normalizePhone(d.phone);
  if (phone === null) return { kind: 'invalid', message: PHONE_ERROR };
  if (!d.email && !phone) return { kind: 'invalid', message: 'Add an email or phone so we can reply.' };
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return { kind: 'invalid', message: 'That email address looks invalid.' };

  return {
    kind: 'ok',
    lead: {
      name: d.name, email: d.email, phone, subject: d.subject || 'General enquiry',
      message: [about, needs, d.message].filter(Boolean).join('\n\n'),
      ...(needs ? { city: d.city, locality: d.locality, budget: d.budget, bhk: d.bhk, timeline: d.timeline } : {}),
      ...(d.project ? { project: d.project, ...(d.project_number ? { project_number: d.project_number } : {}) } : {}),
      // Sending the form is the request to be replied to; call/WhatsApp are separate opt-ins.
      consent: buildConsent('contact', { enquiry: true, call: d.consent_call, whatsapp: d.consent_whatsapp }, now),
    },
  };
}
