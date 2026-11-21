import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EVENT, parseEventRegistration } from '../lib/event-registration';

const NOW = new Date('2026-11-21T10:00:00.000Z');
const valid = { name: 'Asha Patil', email: 'Asha@Example.com', phone: '+91 9876543210', attendee_type: 'Investor', agree: true, company: '' };

test('valid registration is accepted and normalised', () => {
  const r = parseEventRegistration(valid, NOW);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.registration.email, 'asha@example.com');
  assert.equal(r.registration.phone, '+91 9876543210');
  assert.equal(r.registration.event, DEFAULT_EVENT);
  assert.equal(r.registration.consent.enquiry, true);
  assert.equal(r.registration.consent.captured_at, NOW.toISOString());
});

test('terms must be accepted', () => {
  const r = parseEventRegistration({ ...valid, agree: false }, NOW);
  assert.equal(r.kind, 'invalid');
});

test('bad email, phone or attendee type is rejected', () => {
  assert.equal(parseEventRegistration({ ...valid, email: 'nope' }, NOW).kind, 'invalid');
  assert.equal(parseEventRegistration({ ...valid, phone: '12345' }, NOW).kind, 'invalid');
  assert.equal(parseEventRegistration({ ...valid, attendee_type: 'Alien' }, NOW).kind, 'invalid');
});

test('honeypot submissions are flagged as spam', () => {
  assert.equal(parseEventRegistration({ ...valid, company: 'Bot Inc' }, NOW).kind, 'spam');
});
