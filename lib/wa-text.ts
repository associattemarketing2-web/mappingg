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
