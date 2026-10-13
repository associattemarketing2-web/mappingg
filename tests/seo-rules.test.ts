import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPropertyProject, nonProjectReason } from '../lib/seo/project-filter';
import { developerIndexing, localityIndexing, projectIndexing } from '../lib/seo/indexing';
import { bhkOptions, formatBhk, formatLakhs, startingPriceLakhs, summarizeLocality } from '../lib/seo/locality-summary';
import { displayDeveloperName } from '../lib/seo/developer-name';
import { slugify } from '../lib/seo/slug';
import { hasLocalityGuide, LOCALITY_GUIDES } from '../lib/seo/locality-guides';

test('office markers and land parcels are not projects; real projects are', () => {
  assert.ok(nonProjectReason({ title: 'Associatte - Your Real Estate Advisory', type: 'Residential', price: 'Associatte.com', configuration: '+918881188181' }));
  assert.ok(nonProjectReason({ title: 'Land for JV 4.5 Acres', type: 'Land Parcel', price: 'Deposit ₹ 40 Cr' }));
  assert.equal(isPropertyProject({ title: 'Riverdale Grand', type: 'Residential', price: '₹ 1.74 Cr Onwards', configuration: '3 BHK' }), true);
  assert.equal(isPropertyProject({ title: 'Amar Quantum Tech Park', type: 'Commercial', price: 'Only for Leasing' }), true);
  assert.equal(isPropertyProject({ title: 'Merlin New Project', type: 'Commercial' }), true);
  assert.equal(isPropertyProject({ title: 'Kohinoor Kalideo', price: '₹ 1.2 Cr Onwards (www.kohinoor.com)' }), true);
});

test('locality indexing: ≥3 projects or a written guide', () => {
  assert.equal(localityIndexing('kharadi', 23).index, true);
  assert.equal(localityIndexing('somewhere', 2).index, false);
  assert.equal(localityIndexing('koregaon-park', 2).index, true); // has a guide
  assert.equal(localityIndexing('somewhere', 3).index, true);
});

test('developer indexing: ≥3 projects', () => {
  assert.equal(developerIndexing(2).index, false);
  assert.equal(developerIndexing(3).index, true);
});

test('project indexing: empty placeholders are not indexed', () => {
  assert.equal(projectIndexing({}).index, false);
  assert.equal(projectIndexing({ location: '  ' }).index, false);
  assert.equal(projectIndexing({ price: '₹ 1 Cr' }).index, true);
  assert.equal(projectIndexing({ description: 'A tower in Kharadi' }).index, true);
});

test('starting price parsing', () => {
  assert.equal(startingPriceLakhs('₹ 1.25 Cr Onwards'), 125);
  assert.equal(startingPriceLakhs('₹ 98 Lacs - ₹ 1.35 Cr'), 98);
  assert.equal(startingPriceLakhs('₹ 92 – 139 L'), 92);
  assert.equal(startingPriceLakhs('₹ 0.85 – 1.35 Cr'), 85);
  assert.equal(startingPriceLakhs('₹ 70-80 Lacs'), 70);
  assert.equal(startingPriceLakhs('₹ 23 Cr'), 2300);
  for (const none of ['Price on Request', 'Only for Leasing', '₹ 2.31 Onwards', 'Bunglow Plots', '', undefined]) assert.equal(startingPriceLakhs(none), null, String(none));
});

test('BHK parsing', () => {
  assert.deepEqual(bhkOptions('2/2.5/3/3.5/4.5 BHK'), [2, 2.5, 3, 3.5, 4.5]);
  assert.deepEqual(bhkOptions('Shops/Office/1/2/3/4 BHK'), [1, 2, 3, 4]);
  assert.deepEqual(bhkOptions('Office Space'), []);
  assert.equal(formatBhk([2, 3, 4]), '2, 3 and 4 BHK');
});

test('summary and formatting', () => {
  const s = summarizeLocality([
    { type: 'Residential', price: '₹ 98 Lacs', configuration: '2 BHK', possession_timeline: 'Dec 2027', status: 'construction', developer: 'A' },
    { type: 'Commercial', price: '₹ 2.2 Cr Onwards', configuration: 'Office Space', possession_timeline: 'Ready & Dec 2029', status: 'construction', developer: 'A' },
    { type: 'Residential', price: 'Price on Request', configuration: '3 / 4 BHK', status: 'available', developer: 'B' },
  ]);
  assert.equal(s.minLakhs, 98);
  assert.equal(s.maxLakhs, 220);
  assert.equal(s.priced, 2);
  assert.deepEqual(s.bhk, [2, 3, 4]);
  assert.deepEqual(s.possessionYears, [2027, 2029]);
  assert.equal(s.readyNow, 2);
  assert.deepEqual(s.developers, ['A', 'B']);
  assert.equal(formatLakhs(98), '₹98 Lacs');
  assert.equal(formatLakhs(125), '₹1.25 Cr');
  assert.equal(formatLakhs(220), '₹2.2 Cr');
});

test('developer display names: case only, slugs unchanged, spellings kept', () => {
  const cases: [string, string][] = [
    ['KRISALA DEVELOPERS', 'Krisala Developers'],
    ['KOHINOOR GROUP', 'Kohinoor Group'],
    ['NAMOH SAI PROPERTIES LLP', 'Namoh Sai Properties LLP'],
    ['SSPL', 'SSPL'],
    ['SANTIAGO REALITY', 'Santiago Reality'],
    ['ESTQUIRE DEVLOPERS', 'Estquire Devlopers'],
    ['Platinum  Corp', 'Platinum Corp'],
    ['DS-MAX Properties', 'DS-MAX Properties'],
    ['K Raheja Corp', 'K Raheja Corp'],
  ];
  for (const [raw, want] of cases) {
    assert.equal(displayDeveloperName(raw), want, raw);
    assert.equal(slugify(displayDeveloperName(raw)), slugify(raw), `slug for ${raw}`);
  }
});

test('15 locality guides, each with real prose and no prices', () => {
  assert.equal(Object.keys(LOCALITY_GUIDES).length, 15);
  for (const [slug, g] of Object.entries(LOCALITY_GUIDES)) {
    assert.ok(hasLocalityGuide(slug));
    assert.ok(g.intro.join(' ').length > 200, slug);
    assert.ok(!/₹|\bcr\b|lakh|lacs?\b|%|appreciat|return/i.test(g.intro.join(' ')), `${slug} must not state prices or returns`);
  }
  assert.equal(hasLocalityGuide('constructor'), false);
});
