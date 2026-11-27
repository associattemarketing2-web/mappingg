import type Anthropic from '@anthropic-ai/sdk';
import type { WaMessage } from './wa-store';

// Pure helpers for the WhatsApp AI (lib/wa-ai.ts), kept free of I/O so they can be unit-tested.

/** "₹ 85 L", "1.2 Cr", "75 Lakh onwards" → price in lakh (first number), or null. */
export function priceLakh(price?: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lakh|k)?/i.exec(String(price || '').replace(/,/g, ''));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit.startsWith('c')) return n * 100;
  if (unit.startsWith('l')) return n;
  if (n > 10_000) return n / 100_000; // plain rupees
  return null;
}

/** The chat so far as alternating user / assistant turns (customer = user). */
export function toTurns(history: WaMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const turns: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const m of history) {
    // OTPs and automated templates are not part of the conversation the AI continues.
    if (m.deleted || m.author === 'system' || m.status === 'failed') continue;
    const role = m.author === 'customer' ? 'user' : 'assistant';
    const text = m.author === 'staff' ? `[Mappingg team member] ${m.body}` : m.body;
    if (!text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n${text}`;
    else turns.push({ role, text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns.map((t) => ({ role: t.role, content: t.text }));
}

/* --------------------------- project card + parsing --------------------------- */

export interface CardData {
  name: string | null; developer?: string | null; locality?: string | null; city?: string | null;
  configuration?: string | null; sizes_sqft?: string | null; price?: string | null; possession?: string | null;
  status?: string | null; rera_number?: string | null; highlights?: string | null; link: string;
}

/** WhatsApp caption for a project card (fits the 1,024-character image caption limit). */
export function projectCaption(d: CardData): string {
  const lines = [
    `🏢 *${d.name || 'Project'}*${d.developer ? `\nby ${d.developer}` : ''}`,
    (d.locality || d.city) && `📍 ${[d.locality, d.city].filter(Boolean).join(', ')}`,
    d.configuration && `🏠 ${d.configuration}${d.sizes_sqft ? ` · ${d.sizes_sqft}${/sq\.?\s*f/i.test(d.sizes_sqft) ? '' : ' sq ft'}` : ''}`,
    d.price && `💰 ${d.price}`,
    d.possession && `🗓️ Possession: ${d.possession}`,
    d.status && `📌 ${d.status}`,
    d.rera_number && `✅ RERA: ${d.rera_number}`,
    d.highlights && `✨ ${d.highlights.replace(/\s+/g, ' ').slice(0, 220)}`,
    `🔗 ${d.link}`,
  ].filter(Boolean) as string[];
  let out = lines.join('\n');
  if (out.length > 1000) out = lines.filter((l) => !l.startsWith('✨')).join('\n');
  return out.slice(0, 1024);
}

/** "2 BHK", "2bhk", "1 RK", "3 bhk flat" → "2 BHK" etc. */
export function parseBhk(text: string): string | null {
  const t = text.toLowerCase();
  const m = /(\d(?:\.5)?)\s*-?\s*(bhk|bed|bhk's|bhks)/.exec(t);
  if (m) return `${m[1]} BHK`;
  if (/\b1\s*rk\b/.test(t)) return '1 RK';
  if (/\b(office|shop|commercial)\b/.test(t)) return 'Commercial';
  if (/\b(plot|land|na plot)\b/.test(t)) return 'Plot';
  if (/\b(villa|bungalow|row ?house)\b/.test(t)) return 'Villa / Row house';
  return null;
}

/** "80 lakh", "1.2 cr", "50-60L", "1 crore" → { text, lakh } using the highest amount mentioned. */
export function parseBudget(text: string): { text: string; lakh: number } | null {
  const re = /(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|lakh|l|k)\b/gi;
  let best: number | null = null;
  for (const m of text.replace(/,/g, '').matchAll(re)) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    const lakh = u.startsWith('c') ? n * 100 : u === 'k' ? n / 100 : n;
    if (lakh >= 5 && lakh <= 10_000 && (best == null || lakh > best)) best = lakh;
  }
  if (best == null) return null;
  return { lakh: best, text: best >= 100 ? `₹${+(best / 100).toFixed(2)} Cr` : `₹${+best.toFixed(1)} L` };
}

const NOT_NAMES = new Set(('hi hii hiii hello helo hey hlo namaste namaskar ok okay yes no ha haan nahi thanks thank you sir madam mam ji ' +
  'good morning evening afternoon night bhk flat flats project projects price details info buy rent want need looking interested please pls ' +
  'call me visit site brochure location address what which when where how kya hai he kaha kitna kitne').split(' '));

/** A name typed in reply to "May I know your name?" — null when the text doesn't look like one. */
export function extractName(text: string): string | null {
  let t = text.trim().replace(/[.!🙏😊]+$/u, '').trim();
  t = t.replace(/^(hi|hello|hey|namaste)[,!\s]+/i, '')
    .replace(/^(my name is|my name's|name is|name:|i am|i'm|im|this is|myself|it's|its|mera naam|mera name|maza nav|majhe nav|naam)\s+/i, '')
    .replace(/\s+(hai|he|here|ahe|aahe|hun|hoon)$/i, '').trim();
  if (!t || /\d/.test(t) || t.length > 40) return null;
  const parts = t.split(/\s+/);
  if (parts.length > 4 || !parts.every((w) => /^[\p{L}.'-]{2,20}$/u.test(w))) return null;
  if (parts.some((w) => NOT_NAMES.has(w.toLowerCase()))) return null;
  return parts.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** What the customer is asking for beyond requirements. */
export function parseIntent(text: string): { call: boolean; visit: boolean; brochure: boolean; more: boolean; human: boolean } {
  const t = text.toLowerCase();
  return {
    call: /\b(call|callback|call back|phone|baat|contact me)\b/.test(t) || /फोन|कॉल/.test(t),
    visit: /\b(site visit|visit|dekhna|see the (site|flat)|sample flat)\b/.test(t),
    brochure: /\b(brochure|broucher|pdf|floor ?plan|price ?list|costing)\b/.test(t),
    more: /^\s*(more|aur|next|more options|aur dikhao|show more)\s*$/.test(t),
    human: /\b(human|agent|executive|person|advisor|real person|team)\b/.test(t),
  };
}

/* ---------------------- enquiry questions (WhatsApp flow) ---------------------- */

/** Sent once the enquiry questions are answered and the matching projects are shared. */
export const THANK_YOU = 'Thank you for enquiring at *mappingg.com* 🙏 We will connect with you shortly.';

/** "1000 sqft", "800-1000 sq ft", "1,200 square feet" → { text, sqft } (the highest number); a bare 300–10,000 when `bare`. */
export function parseSqft(text: string, bare = false): { text: string; sqft: number } | null {
  const t = text.replace(/,/g, '');
  const unit = /(\d{3,5})(?:\s*(?:-|–|to)\s*(\d{3,5}))?\s*(?:sq\.?\s*(?:ft|feet|foot)|sqft|sft|square\s*(?:ft|feet|foot))/i.exec(t);
  const m = unit || (bare ? /^\s*(?:around|approx\.?|about|upto|up to)?\s*(\d{3,5})(?:\s*(?:-|–|to)\s*(\d{3,5}))?\s*$/i.exec(t) : null);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : null;
  const sqft = Math.max(a, b ?? 0);
  if (sqft < 150 || sqft > 50_000) return null;
  return { sqft, text: b ? `${Math.min(a, b)}–${sqft} sq ft` : `${a} sq ft` };
}

/** "ready to move", "2027", "within 2 years", "under construction" → a short label, else null. */
export function parsePossession(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(ready|rtm|immediate|turant|abhi)\b/.test(t)) return 'Ready to move';
  if (/\bunder\s*construction\b|\buc\b/.test(t)) return 'Under construction';
  if (/\b(new\s*launch|pre\s*launch|launch)\b/.test(t)) return 'New launch';
  const yr = /\b(20[2-4]\d)\b/.exec(t)?.[1];
  if (yr) return `By ${yr}`;
  const n = /(\d{1,2})\s*(years?|yrs?|saal|varsh|months?|mahine|mahina)/.exec(t);
  if (n) return `Within ${n[1]} ${/^(m|mah)/.test(n[2]) ? (n[1] === '1' ? 'month' : 'months') : (n[1] === '1' ? 'year' : 'years')}`;
  return null;
}

/** The first email address in the text, lower-cased. */
export function parseEmail(text: string): string | null {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(text)?.[0].toLowerCase() ?? null;
}

/** A mobile number typed in the text (10–13 digits, spaces / dashes allowed), digits only with 91 for Indian numbers. */
export function parsePhone(text: string): string | null {
  const m = /(?:\+|\b)(\d[\d\s-]{8,15}\d)\b/.exec(text);
  if (!m) return null;
  const d = m[1].replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length >= 11 && d.length <= 13) return d;
  return null;
}

/** "same", "yes", "this one", "haan" — keep the WhatsApp number / skip a question. */
export const isSame = (text: string) => /^\s*(same|same number|this|this one|this number|yes|yeah|yup|ok|okay|ha+n?|haan ji|ji|same hai|yahi|isi par|isi pe|whatsapp)\s*[.!]?\s*$/i.test(text);
export const isSkip = (text: string) => /^\s*(skip|no|nahi|nahin|na|don'?t have|dont have|not now|later|none|nil|-)\s*[.!]?\s*$/i.test(text);
