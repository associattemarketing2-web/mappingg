import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANONYMISED_ACTIVITY, DELETED_NAME, anonymisedLeadPatch, parseDeleteRequest } from '../lib/account-deletion-rules';
import { parseContactSubmission } from '../lib/contact-submission';

const NOW = '2026-11-02T10:00:00.000Z';

test('delete request needs a password and the literal DELETE confirmation (the mobile app body)', () => {
  assert.deepEqual(parseDeleteRequest({ password: 'secret123', confirm: 'DELETE' }), { ok: true, password: 'secret123' });
  assert.equal(parseDeleteRequest({ password: 'secret123' }).ok, false);
  assert.equal(parseDeleteRequest({ password: 'secret123', confirm: 'delete' }).ok, false);
  assert.equal(parseDeleteRequest({ password: '', confirm: 'DELETE' }).ok, false);
  assert.equal(parseDeleteRequest({ password: 'x'.repeat(201), confirm: 'DELETE' }).ok, false);
  assert.equal(parseDeleteRequest(null).ok, false);
});

test('anonymised lead keeps no personal details and drops the account link', () => {
  const lead = {
    id: 'l1', pin_id: 'p1', status: 'contacted', created_at: '2026-01-01', source: 'Signed-in account',
    name: 'Asha', email: 'asha@example.com', whatsapp: '+91 9876543210', phone: '+91 9876543210',
    notes: 'Called Asha on 9876543210', message: 'Budget 1 Cr', account_id: 'u1', consent: { call: true },
  };
  const after = { ...lead, ...anonymisedLeadPatch(NOW) };
  const text = JSON.stringify(after);
  assert.ok(!text.includes('Asha'));
  assert.ok(!text.includes('asha@example.com'));
  assert.ok(!text.includes('9876543210'));
  assert.equal(after.name, DELETED_NAME);
  assert.equal(after.account_id, '');
  assert.equal(after.consent, null);
  // Statistics survive.
  assert.equal(after.pin_id, 'p1');
  assert.equal(after.status, 'contacted');
  assert.equal(after.created_at, '2026-01-01');
  assert.equal((after as Record<string, unknown>).account_deleted_at, NOW);
});

test('anonymised activity drops email, name, IP and device', () => {
  const entry = { id: 'a1', user_id: 'u1', type: 'login', at: NOW, email: 'asha@example.com', name: 'Asha', ip: '1.2.3.4', device: 'Chrome on Android' };
  const after = { ...entry, ...ANONYMISED_ACTIVITY };
  assert.ok(!JSON.stringify(after).match(/asha|1\.2\.3\.4|Chrome/i));
  assert.equal(after.type, 'login');
  assert.equal(after.user_id, 'u1');
});

test('the deletion request form body is accepted by the contact API', () => {
  const r = parseContactSubmission({
    name: 'Asha', email: 'asha@example.com', phone: '+91 98765 43210', subject: 'Account deletion request',
    message: 'Please delete my Mappingg account and its personal data.\nAccount email: asha@example.com',
  });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.lead.subject, 'Account deletion request');
  assert.match(r.lead.message, /Account email: asha@example\.com/);
});

test('the deletion request form works without a phone number', () => {
  const r = parseContactSubmission({ name: 'Asha', email: 'asha@example.com', phone: '', subject: 'Account deletion request', message: 'Please delete my account.' });
  assert.equal(r.kind, 'ok');
});
