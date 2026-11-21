import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from './phone';
import { buildConsent, type ConsentRecord } from './consent';

// Validation for the public Mappingg Events registration form (the separate
// mappinggevent landing site posts to app/api/event-registration). Free of I/O
// so it can be unit-tested; the route does the saving, CRM push and emails.
// Registrations are stored in `contact_leads` with source EVENT_SOURCE, so they
// show up in the CRM and in the admin's "Event registrations" tab.

export const EVENT_SOURCE = 'Event registration';
export const DEFAULT_EVENT = 'Mappingg App Launch — Pune';
export const ATTENDEE_TYPES = ['Home buyer', 'Investor', 'Developer', 'Channel partner', 'Other'] as const;

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  attendee_type: z.enum(ATTENDEE_TYPES),
  event: z.string().trim().max(120).optional().default(''),
  agree: z.literal(true),
  consent_call: z.boolean().optional().default(false),
  consent_whatsapp: z.boolean().optional().default(false),
  company: z.string().optional(), // honeypot, checked before parsing
});

export interface EventRegistration {
  name: string; email: string; phone: string; attendee_type: string; event: string;
  subject: string; message: string; consent: ConsentRecord;
}

export type EventResult =
  | { kind: 'spam' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; registration: EventRegistration };

export function parseEventRegistration(raw: unknown, now: Date = new Date()): EventResult {
  const hp = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).company : undefined;
  if (hp != null && String(hp).trim() !== '') return { kind: 'spam' };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] || '');
    const msg: Record<string, string> = {
      name: 'Please enter your full name.',
      attendee_type: 'Please choose an attendee type.',
      agree: 'Please accept the Event Terms & Conditions and Privacy Policy.',
    };
    return { kind: 'invalid', message: msg[field] || 'Please fill in all the fields.' };
  }
  const d = parsed.data;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return { kind: 'invalid', message: 'Please enter a valid email address.' };
  const phone = normalizePhone(d.phone, { required: true });
  if (!phone) return { kind: 'invalid', message: PHONE_ERROR };

  const event = d.event || DEFAULT_EVENT;
  return {
    kind: 'ok',
    registration: {
      name: d.name, email: d.email.toLowerCase(), phone, attendee_type: d.attendee_type, event,
      subject: `Event: ${event}`,
      message: `Registered for ${event} as ${d.attendee_type}.`,
      consent: buildConsent('event', { enquiry: true, call: d.consent_call, whatsapp: d.consent_whatsapp }, now),
    },
  };
}
