import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from './phone';
import { buildConsent, type ConsentRecord } from './consent';
import { isHoneypotHit } from './contact-submission';

// Validation for the public Buyer Requirement form (/buyer-requirement →
// /api/buyer-requirement). Kept free of I/O so it can be unit-tested. The
// person must tick the contact-consent box themselves: only a literal `true`
// counts, so a missing or forged value is always a "no".

export const REQ_CITIES = ['Pune', 'Mumbai & MMR', 'Bengaluru', 'Other'] as const;
export const REQ_BHK = ['1 RK / Studio', '1 BHK', '2 BHK', '3 BHK', '4+ BHK', 'Villa / Row house', 'Plot', 'Office / Shop'] as const;
export const REQ_BUDGETS = ['Under ₹50 L', '₹50 L – 1 Cr', '₹1 – 1.5 Cr', '₹1.5 – 2 Cr', '₹2 – 3 Cr', '₹3 – 5 Cr', '₹5 Cr +'] as const;
export const REQ_TIMELINES = ['Within 1 month', '1–3 months', '3–6 months', '6–12 months', 'More than a year'] as const;
export const REQ_PURPOSES = ['Own use', 'Investment', 'Both'] as const;

const opt = (max: number) => z.string().trim().max(max).optional().default('');
const schema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: opt(40),
  email: opt(200),
  city: z.enum(REQ_CITIES),
  areas: z.string().trim().min(2).max(200),
  bhk: z.enum(REQ_BHK),
  budget: z.enum(REQ_BUDGETS),
  timeline: z.enum(REQ_TIMELINES),
  purpose: z.union([z.enum(REQ_PURPOSES), z.literal('')]).optional().default(''),
  notes: opt(1000),
  consent: z.unknown(),
  consent_call: z.unknown(),
  consent_whatsapp: z.unknown(),
  company: z.string().optional(), // honeypot
});

export interface BuyerRequirement {
  name: string; phone: string; email: string; city: string; locality: string; bhk: string; budget: string; timeline: string;
  purpose: string; subject: string; message: string; consent: ConsentRecord;
}

export type RequirementResult = { kind: 'spam' } | { kind: 'invalid'; message: string } | { kind: 'ok'; lead: BuyerRequirement };

const FIELD_ERRORS: Record<string, string> = {
  name: 'Please add your name.', city: 'Choose a city.', areas: 'Tell us which areas you prefer.', bhk: 'Choose the home size.',
  budget: 'Choose a budget.', timeline: 'Choose when you plan to buy.',
};

export function parseRequirement(raw: unknown, now: Date = new Date()): RequirementResult {
  if (isHoneypotHit(raw)) return { kind: 'spam' };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] || '');
    return { kind: 'invalid', message: FIELD_ERRORS[field] || 'Please check the form and try again.' };
  }
  const d = parsed.data;
  if (d.consent !== true) return { kind: 'invalid', message: 'Please tick the box to let us contact you about this requirement.' };
  const phone = normalizePhone(d.phone);
  if (phone === null) return { kind: 'invalid', message: PHONE_ERROR };
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return { kind: 'invalid', message: 'That email address looks invalid.' };
  if (!phone && !d.email) return { kind: 'invalid', message: 'Add a mobile number or email so we can reach you.' };
  if (/(https?:\/\/|www\.)/i.test(d.name)) return { kind: 'spam' };

  const needs = [
    `Looking for: ${d.bhk}`, `Budget: ${d.budget}`, `Preferred area: ${d.areas}, ${d.city}`, `Planning to buy: ${d.timeline}`,
    d.purpose && `Buying for: ${d.purpose}`,
  ].filter(Boolean).join(' · ');
  return {
    kind: 'ok',
    lead: {
      name: d.name, phone, email: d.email.toLowerCase(), city: d.city, locality: d.areas, bhk: d.bhk, budget: d.budget, timeline: d.timeline,
      purpose: d.purpose, subject: 'Buyer requirement',
      message: [needs, d.notes].filter(Boolean).join('\n\n'),
      consent: buildConsent('requirement', { enquiry: d.consent, call: d.consent_call, whatsapp: d.consent_whatsapp }, now),
    },
  };
}
