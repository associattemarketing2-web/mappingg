import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../lib/enrichment/plan';

// Safety rules of the project-enrichment apply tool (migration/enrichment/apply.mts).

const SRC = 'https://maharera.maharashtra.gov.in/projects-search-result?project_name=X';
const pins = [
  { id: 'a', number: 1, title: 'Alpha', rera_number: '', configuration: '2 BHK', custom_fields: [] },
  { id: 'b', number: 2, title: 'Beta', rera_number: 'P52100000002' },
  { id: 'c', number: 3, title: 'Gamma', custom_fields: [{ label: 'Rera No', value: 'P51800078789' }] },
  { id: 'd1', number: 4, title: 'Dup' }, { id: 'd2', number: 4, title: 'Dup two' },
  { id: 'h', number: 5, title: 'Hidden', hidden: true },
];
const item = (field: string, proposed: unknown, extra: object = {}) => ({ field, proposed, status: 'verified', action: 'set', confidence: 'high', source_url: SRC, ...extra });

test('applies verified, high-confidence, allow-listed values to empty fields only', () => {
  const { changes, rejected } = plan([{ number: 1, title: 'Alpha', fields: [
    item('rera_number', 'P52100055529'),
    item('configuration', '3 BHK'),
    item('title', 'Alpha Renamed'),
    item('developer', 'Someone'),
    item('lat', 18.5),
    item('possession_timeline', 'Dec 2030', { status: 'needs_review', action: 'review' }),
    item('price', '₹ 1 Cr', { confidence: 'medium' }),
  ] }], pins);
  assert.deepEqual(changes.map((c) => [c.field, c.after]), [['rera_number', 'P52100055529']]);
  const reasons = Object.fromEntries(rejected.map((r) => [r.field, r.reason]));
  assert.match(reasons.configuration, /existing value kept/);
  assert.match(reasons.title, /allow-list/);
  assert.match(reasons.developer, /allow-list/);
  assert.match(reasons.lat, /allow-list/);
  assert.match(reasons.price, /high confidence/);
  assert.equal(reasons.possession_timeline, undefined, 'review items are simply not applied');
});

test('never overwrites an existing RERA number, and rejects malformed or duplicate ones', () => {
  const { changes, rejected } = plan([
    { number: 2, title: 'Beta', fields: [item('rera_number', 'P52100099999')] },
    { number: 1, title: 'Alpha', fields: [item('rera_number', 'LAUNCHING-SOON')] },
    { number: 1, title: 'Alpha', fields: [item('rera_number', 'P52100000002')] },
  ], pins);
  assert.equal(changes.length, 0);
  assert.deepEqual(rejected.map((r) => r.reason), ['existing value kept ("P52100000002")', 'not a MahaRERA project number', 'this RERA number is already on another pin']);
});

test('copies a verified RERA number that was only in a custom field', () => {
  const { changes } = plan([{ number: 3, title: 'Gamma', fields: [item('rera_number', 'P51800078789')] }], pins);
  assert.deepEqual(changes.map((c) => c.after), ['P51800078789']);
});

test('identity guards: duplicate pin numbers, renamed pins, hidden pins and unknown pins are skipped', () => {
  const { changes, rejected } = plan([
    { number: 4, title: 'Dup', fields: [item('rera_number', 'P52100011111')] },
    { number: 1, title: 'Alpha (old name)', fields: [item('rera_number', 'P52100022222')] },
    { number: 5, title: 'Hidden', fields: [item('rera_number', 'P52100033333')] },
    { number: 99, title: 'Nope', fields: [item('rera_number', 'P52100044444')] },
  ], pins);
  assert.equal(changes.length, 0);
  assert.deepEqual(rejected.map((r) => r.reason), ['pin number is not unique', 'title changed since research ("Alpha")', 'pin is not live', 'pin not found']);
});

test('custom fields are appended, never replacing existing ones or duplicating a label', () => {
  const { changes, rejected } = plan([
    { number: 1, title: 'Alpha', fields: [item('custom_fields+', { label: 'MahaRERA promoter', value: 'X LLP' })] },
    { number: 3, title: 'Gamma', fields: [item('custom_fields+', { label: 'rera no', value: 'P1' })] },
  ], pins);
  assert.equal(changes.length, 1);
  assert.deepEqual((changes[0].after as { label: string }[]).map((c) => c.label), ['MahaRERA promoter']);
  assert.match(rejected[0].reason, /already exists/);
});
