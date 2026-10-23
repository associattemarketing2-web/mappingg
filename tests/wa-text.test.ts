import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceLakh, toTurns } from '../lib/wa-text';
import type { WaMessage } from '../lib/wa-store';

let n = 0;
const msg = (author: WaMessage['author'], body: string, extra: Partial<WaMessage> = {}): WaMessage => ({
  id: String(++n), phone: '919876543210', direction: author === 'customer' ? 'in' : 'out', author, kind: 'text', body,
  status: author === 'customer' ? 'received' : 'sent', created_at: new Date(2026, 9, 23, 10, n).toISOString(), ...extra,
});

test('priceLakh reads lakh, crore and plain rupee prices', () => {
  assert.equal(priceLakh('₹ 85 L onwards'), 85);
  assert.equal(priceLakh('1.25 Cr'), 125);
  assert.equal(priceLakh('75 Lakh'), 75);
  assert.equal(priceLakh('₹1,20,00,000'), 120);
  assert.equal(priceLakh('Price on request'), null);
  assert.equal(priceLakh(undefined), null);
});

test('toTurns alternates customer / reply turns and starts with the customer', () => {
  const turns = toTurns([
    msg('system', 'Verification code (code hidden)', { kind: 'otp' }),
    msg('ai', 'Hello!'),
    msg('customer', 'Hi'),
    msg('customer', 'Any 2 BHK in Kharadi?'),
    msg('ai', 'Sure — what is your budget?'),
    msg('staff', 'I can call you today.'),
    msg('customer', 'Under 1 Cr'),
  ]);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'assistant', 'user']);
  assert.equal(turns[0].content, 'Hi\nAny 2 BHK in Kharadi?');
  assert.equal(turns[1].content, 'Sure — what is your budget?\n[Mappingg team member] I can call you today.');
});

test('toTurns leaves out OTPs, templates, deleted and failed messages', () => {
  const turns = toTurns([
    msg('customer', 'Hello'),
    msg('system', 'Buyer account created', { kind: 'template' }),
    msg('ai', 'wrong answer', { deleted: true }),
    msg('staff', 'never delivered', { status: 'failed' }),
    msg('customer', 'Still there?'),
  ]);
  assert.deepEqual(turns, [{ role: 'user', content: 'Hello\nStill there?' }]);
});
