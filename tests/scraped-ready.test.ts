import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyGaps, isDevSiteFacts } from '../lib/scraped';

const TODAY = '2026-10-18';
const maha = { regulator: 'MahaRERA', project_name: 'X Phase 1', developer_name: 'X Ltd', rera_number: 'PR1261012602102', locality: 'Mulshi', pincode: '412115', pin_check: 'verified', status_category: 'Registered - current status not confirmed' };
const devFacts = { source_type: 'developer_official_site', review_required: [], fields: { configurations: '2 BHK, 3 BHK', proposed_completion: '2031-12-30', rera_on_official_page: true } };

test('original rule unchanged: registry rows still need units, cost and land area', () => {
  const ka = { ...maha, regulator: 'RERA Karnataka' };
  const e = { review_required: [], fields: { configurations: '2 BHK', proposed_completion: '2030-01-01' } };
  const g = readyGaps(ka, e, TODAY);
  assert.ok(g.includes('No unit / plot count'));
  assert.ok(g.includes('No project cost'));
  assert.ok(g.includes('No land area'));
  // The same facts with source_type set do not relax the rule outside MahaRERA.
  assert.ok(readyGaps(ka, { ...e, source_type: 'developer_official_site' }, TODAY).includes('No project cost'));
});

test('MahaRERA + developer website: units / cost / land pending, other checks still apply', () => {
  assert.equal(isDevSiteFacts(maha, devFacts), true);
  assert.deepEqual(readyGaps(maha, devFacts, TODAY), []);
  assert.ok(readyGaps({ ...maha, pin_check: 'approximate' }, devFacts, TODAY).includes('Location pin not verified'));
  assert.ok(readyGaps(maha, { ...devFacts, fields: { ...devFacts.fields, rera_on_official_page: false } }, TODAY).includes('RERA number not shown on the developer page'));
  assert.ok(readyGaps(maha, { ...devFacts, fields: { ...devFacts.fields, proposed_completion: undefined } }, TODAY).includes('No proposed completion date'));
  assert.ok(readyGaps(maha, { ...devFacts, fields: { ...devFacts.fields, proposed_completion: '2025-04' } }, TODAY).includes('Proposed completion date has passed'));
  assert.ok(readyGaps(maha, { ...devFacts, fields: { ...devFacts.fields, configurations: undefined } }, TODAY).includes('No configuration matching the project form'));
  assert.ok(readyGaps({ ...maha, status_category: 'Lapsed' }, devFacts, TODAY).includes('Registration closed or project completed'));
});
