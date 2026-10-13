import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnquireRequest } from '../lib/enquire-request';

const NOW = new Date('2026-10-13T10:00:00.000Z');

test('missing consent: enquiry recorded from the tap, opt-ins stay false', () => {
  const r = parseEnquireRequest({ pin_id: 'p1' }, NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.consent.enquiry, true);
  assert.equal(r.consent.call, false);
  assert.equal(r.consent.whatsapp, false);
  assert.equal(r.consent.captured_at, NOW.toISOString());
});

test('explicit consent is stored', () => {
  const r = parseEnquireRequest({ pin_id: 'p1', consent_call: true, consent_whatsapp: true }, NOW);
  assert.equal(r.ok && r.consent.call && r.consent.whatsapp, true);
});

test('declined consent stays declined', () => {
  const r = parseEnquireRequest({ pin_id: 'p1', consent_call: false, consent_whatsapp: false }, NOW);
  assert.equal(r.ok && (r.consent.call || r.consent.whatsapp), false);
});

test('malformed payloads are rejected', () => {
  for (const body of [null, undefined, 'x', 42, {}, { pin_id: '' }, { pin_id: 5 }, { pin_id: 'p1', consent_call: 'yes' }, { pin_id: 'x'.repeat(101) }]) {
    assert.equal(parseEnquireRequest(body).ok, false, JSON.stringify(body));
  }
});
