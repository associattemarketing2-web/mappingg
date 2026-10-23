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
