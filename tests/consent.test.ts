import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConsent, isExplicitYes, mapLeadConsent, optInSummary, CONSENT_FORMS } from '../lib/consent';

const NOW = new Date('2026-10-13T10:00:00.000Z');

test('only a literal true counts as consent', () => {
  for (const v of [undefined, null, false, 'true', 'yes', 1, 'on', {}, []]) assert.equal(isExplicitYes(v), false, String(v));
  assert.equal(isExplicitYes(true), true);
});

test('buildConsent records only the ticked options, with wording, version and time', () => {
  const c = buildConsent('contact', { enquiry: true, call: true, whatsapp: false }, NOW);
  assert.deepEqual({ enquiry: c.enquiry, call: c.call, whatsapp: c.whatsapp }, { enquiry: true, call: true, whatsapp: false });
  assert.equal(c.captured_at, NOW.toISOString());
  assert.equal(c.version, CONSENT_FORMS.contact.version);
  assert.ok(c.text.includes(CONSENT_FORMS.contact.text.call));
  assert.ok(!c.text.includes(CONSENT_FORMS.contact.text.whatsapp));
});

test('missing or ambiguous choices are never turned into permission', () => {
  const c = buildConsent('map', { call: 'yes', whatsapp: 1 }, NOW);
  assert.equal(c.enquiry, false);
  assert.equal(c.call, false);
  assert.equal(c.whatsapp, false);
  assert.equal(c.text, '');
});

test('map lead: required box unticked → rejected', () => {
  assert.equal(mapLeadConsent({ name: 'A', consent: false }, NOW).ok, false);
  assert.equal(mapLeadConsent({ name: 'A' }, NOW).ok, false);
  assert.equal(mapLeadConsent({ name: 'A', consent: 'true' }, NOW).ok, false);
});

test('map lead: optional boxes default to no, and client-sent consent metadata is discarded', () => {
  const r = mapLeadConsent({ name: 'A', consent: true, consent_version: 'forged', consent_captured_at: '2000-01-01' }, NOW);
  assert.equal(r.ok, true);
  const c = r.values.consent as ReturnType<typeof buildConsent>;
  assert.equal(c.call, false);
  assert.equal(c.whatsapp, false);
  assert.equal(c.version, CONSENT_FORMS.map.version);
  assert.equal(c.captured_at, NOW.toISOString());
  assert.equal('consent_version' in r.values, false);
  assert.equal(r.values.name, 'A');
});

test('map lead: explicit opt-ins are kept separately', () => {
  const r = mapLeadConsent({ consent: true, consent_call: false, consent_whatsapp: true }, NOW);
  const c = r.values.consent as ReturnType<typeof buildConsent>;
  assert.equal(c.call, false);
  assert.equal(c.whatsapp, true);
  assert.equal(optInSummary(c), 'WhatsApp');
});

test('optInSummary', () => {
  assert.equal(optInSummary({ call: false, whatsapp: false }), 'None (reply to this enquiry only)');
  assert.equal(optInSummary({ call: true, whatsapp: true }), 'Call + WhatsApp');
});
