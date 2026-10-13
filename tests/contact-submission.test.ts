import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHoneypotHit, parseContactSubmission } from '../lib/contact-submission';

const NOW = new Date('2026-10-13T10:00:00.000Z');
const valid = { name: 'Asha', email: 'asha@example.com', phone: '', message: 'Looking for a 3 BHK', company: '' };

test('legitimate submission is accepted and normalised', () => {
  const r = parseContactSubmission({ ...valid, phone: '9876543210' }, NOW);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.lead.phone, '+91 9876543210');
  assert.equal(r.lead.subject, 'General enquiry');
  assert.equal(r.lead.consent.enquiry, true);
  assert.equal(r.lead.consent.call, false);
  assert.equal(r.lead.consent.whatsapp, false);
});

test('honeypot hit is flagged as spam before any validation', () => {
  assert.equal(parseContactSubmission({ ...valid, company: 'ACME' }).kind, 'spam');
  // even when the rest of the payload is invalid
  assert.equal(parseContactSubmission({ company: 'x' }).kind, 'spam');
  assert.equal(isHoneypotHit({ company: '   ' }), false);
  assert.equal(isHoneypotHit({ company: '' }), false);
  assert.equal(isHoneypotHit(null), false);
});

test('missing name, message, contact or bad email is invalid', () => {
  assert.equal(parseContactSubmission({ ...valid, name: '' }).kind, 'invalid');
  assert.equal(parseContactSubmission({ ...valid, message: '' }).kind, 'invalid');
  assert.equal(parseContactSubmission({ ...valid, email: '' }).kind, 'invalid');
  assert.equal(parseContactSubmission({ ...valid, email: 'not-an-email' }).kind, 'invalid');
  assert.equal(parseContactSubmission({ ...valid, phone: '12345' }).kind, 'invalid');
  assert.equal(parseContactSubmission(null).kind, 'invalid');
  assert.equal(parseContactSubmission('hello').kind, 'invalid');
});

test('buyer details can replace the free-text message', () => {
  const r = parseContactSubmission({ ...valid, message: '', bhk: '3 BHK', budget: '₹1 – 2 Cr', locality: 'Kharadi', city: 'Pune' }, NOW);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.match(r.lead.message, /Looking for: 3 BHK · Budget: ₹1 – 2 Cr · Preferred area: Kharadi, Pune/);
});

test('opt-ins must be real booleans', () => {
  assert.equal(parseContactSubmission({ ...valid, consent_call: 'yes' }).kind, 'invalid');
  const r = parseContactSubmission({ ...valid, consent_call: true }, NOW);
  assert.equal(r.kind === 'ok' && r.lead.consent.call, true);
});
