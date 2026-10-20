import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import {
  applyFieldVisibility, displayProjectName, projectTitle, projectDescription, projectFaqs,
  projectSummary, realPrice, reraNumber, bhkLabel, TITLE_BUDGET,
} from '../lib/seo/project-meta';
import { citiesPhrase } from '../lib/seo/city';
import { slugify } from '../lib/seo/slug';
import { displayDeveloperName, displayPlaceName } from '../lib/seo/developer-name';
import { plainText } from '../lib/seo/node-text';
import { guidesFor } from '../lib/seo/blog-links';

const full = {
  title: 'Kolte Patil Life Republic',
  developer: 'Kolte Patil Developers',
  type: 'Residential',
  status: 'construction',
  configuration: '2 BHK / 3 BHK',
  price: '₹ 75 Lacs Onwards',
  possession_timeline: 'Dec 2027',
  rera_number: 'P52100012345',
};

test('fields switched off for the public card are removed (same ids as the live map)', () => {
  const p = applyFieldVisibility({ ...full, field_visibility: { price: false, rera: false, possession: false, status: true } });
  assert.equal(p.price, '');
  assert.equal(p.rera_number, '');
  assert.equal(p.possession_timeline, '');
  assert.equal(p.status, 'construction');
  assert.equal(p.developer, full.developer);
  // No switches → same object back.
  const same = { ...full };
  assert.equal(applyFieldVisibility(same), same);
});

test('hidden fields never reach the title, description or FAQs', () => {
  const p = applyFieldVisibility({ ...full, field_visibility: { price: false } });
  assert.doesNotMatch(projectTitle(p, 'Hinjewadi', 'Pune'), /Price/);
  assert.doesNotMatch(projectDescription(p, 'Hinjewadi', 'Pune'), /75 Lacs/);
  assert.ok(!projectFaqs(p, 'Hinjewadi', 'Pune').some((f) => /price/i.test(f.q)));
});

test('title names only facets the page has, and fits the budget', () => {
  const t = projectTitle(full, 'Hinjewadi', 'Pune');
  assert.ok(t.startsWith('Kolte Patil Life Republic in Hinjewadi'), t);
  assert.ok(t.length <= TITLE_BUDGET, `${t.length}: ${t}`);
  const bare = projectTitle({ title: 'Some Tower' }, 'Kharadi', 'Pune');
  assert.doesNotMatch(bare, /Price|RERA|BHK/);
  assert.match(bare, /^Some Tower in Kharadi, Pune/);
  const long = projectTitle({ ...full, title: 'Eldeco Live By The Greens Phase III Extension Towers' }, 'Momnathal', 'Delhi NCR');
  assert.ok(long.length <= TITLE_BUDGET || !long.includes('|'), long);
});

test('description stays under 160 characters and never says undefined', () => {
  for (const p of [full, { title: 'X' }, { ...full, key_usp: 'Flexi payment 25x4' }, { ...full, description: 'A'.repeat(400) }]) {
    const d = projectDescription(p, 'Wakad', 'Pune');
    assert.ok(d.length <= 160, `${d.length}: ${d}`);
    assert.doesNotMatch(d, /undefined|null|NaN/);
  }
});

test('FAQs are only asked when the page has the answer', () => {
  const qs = projectFaqs({ title: 'Plain Tower' }, '', '').map((f) => f.q);
  assert.deepEqual(qs, []);
  const all = projectFaqs(full, 'Hinjewadi', 'Pune').map((f) => f.q);
  assert.equal(all.length, 6);
  assert.ok(all.some((q) => /RERA number/.test(q)));
});

test('overview sentences come only from filled fields', () => {
  const s = projectSummary({ title: 'Plain Tower', status: 'upcoming' }, 'Baner', 'Pune').join(' ');
  assert.match(s, /^Plain Tower is an upcoming real estate project in Baner, Pune\./);
  assert.doesNotMatch(s, /RERA|price of|possession/i);
  const r = projectSummary(full, 'Hinjewadi', 'Pune', { sameLocality: 4, sameDeveloper: 1 }).join(' ');
  assert.match(r, /RERA number P52100012345, with possession listed for Dec 2027/);
  assert.match(r, /4 other projects in Hinjewadi and 1 more by Kolte Patil Developers/);
});

test('price and RERA validation', () => {
  assert.equal(realPrice('Only for leasing'), '');
  assert.equal(realPrice('Price on Request'), 'Price on Request');
  assert.equal(reraNumber('N/A'), '');
  assert.equal(reraNumber('Applied'), '');
  assert.equal(reraNumber('PRM/KA/RERA/1251/308/PR/250926/008969'), 'PRM/KA/RERA/1251/308/PR/250926/008969');
  assert.equal(bhkLabel('2 / 2.5 / 3 BHK'), '2, 2.5 and 3 BHK');
  assert.equal(bhkLabel('Plot'), '');
});

test('display names title-case ALL CAPS without changing the URL slug', () => {
  for (const raw of ['SIGNATURE GLOBAL CITY 37D EXTN.', 'ELDECO LIVE BY THE GREENS PHASE -III', 'DLF THE CAMELLIAS', 'Yashwin SuperNova']) {
    assert.equal(slugify(displayProjectName(raw)), slugify(raw), raw);
  }
  assert.equal(displayProjectName('SIGNATURE GLOBAL CITY 37D EXTN.'), 'Signature Global City 37D Extn.');
  assert.equal(displayProjectName('Yashwin SuperNova'), 'Yashwin SuperNova');
});

test('imported capitals are tidied for display only (slug unchanged)', () => {
  for (const [raw, shown] of [['VILLAGE- GADAULI KALAN', 'Village Gadauli Kalan'], ['SECTOR- 76', 'Sector 76'], ['Kharadi', 'Kharadi'], ['Hinjewadi-Phase 2', 'Hinjewadi-Phase 2']]) {
    assert.equal(displayPlaceName(raw), shown);
    assert.equal(slugify(displayPlaceName(raw)), slugify(raw));
  }
  assert.equal(displayDeveloperName('SIGNATUREGLOBAL DEVELOPERS PVT. LTD.'), 'Signatureglobal Developers Pvt. Ltd.');
  assert.equal(displayProjectName('ELDECO LIVE BY THE GREENS PHASE -III'), 'Eldeco Live by the Greens Phase -III');
});

test('descriptions end cleanly and plots read naturally', () => {
  const p = { title: 'Signature Global City 37D Extn.', developer: 'Signatureglobal Developers Pvt. Ltd.', configuration: 'Plot', status: 'construction', possession_timeline: 'Jan 2027', rera_number: 'GGM/930/662/2025/33' };
  const d = projectDescription(p, 'Village Gadauli Kalan', 'Delhi NCR');
  assert.doesNotMatch(d, /\.…$/);
  assert.ok(d.length <= 160);
  const s = projectSummary(p, 'Village Gadauli Kalan', 'Delhi NCR').join(' ');
  assert.match(s, /is an under-construction plotted development/);
  assert.match(s, /It offers plots;/);
});

test('blog guides match a place by whole words only', () => {
  const posts = [{ slug: 'new-projects-in-kharadi-pune', title: 'Kharadi' }, { slug: 'new-projects-in-bengaluru', title: 'Bengaluru' }];
  assert.deepEqual(guidesFor('kharadi', posts).map((p) => p.slug), ['new-projects-in-kharadi-pune']);
  assert.deepEqual(guidesFor('khar', posts), []);
  assert.deepEqual(guidesFor('bengaluru', posts).map((p) => p.slug), ['new-projects-in-bengaluru']);
});

test('city coverage phrase follows the data', () => {
  assert.equal(citiesPhrase(['pune', 'pune', 'mumbai']), 'Pune & Mumbai');
  assert.equal(citiesPhrase(['bengaluru', 'bengaluru', 'pune', 'mumbai', 'delhi']), 'Bengaluru, Pune, Mumbai & more');
  assert.equal(citiesPhrase(['delhi']), 'Delhi NCR');
  assert.equal(citiesPhrase([]), 'India');
});

test('FAQ answers in JSX become their visible text (not the question)', () => {
  const a = createElement(Fragment, null, 'Email us at ', createElement('a', { href: 'mailto:x@y.z' }, 'x@y.z'), ' or call ', 42, '.');
  assert.equal(plainText(a), 'Email us at x@y.z or call 42.');
});

test('M/s. prefixed ALL-CAPS developer names are title-cased (slug unchanged)', () => {
  for (const raw of ['M/s. KNS INFRA PLOTLUXE LLP', 'M/s ANAND GROUP AND C SOMASHEKAR']) {
    assert.equal(slugify(displayDeveloperName(raw)), slugify(raw));
  }
  assert.equal(displayDeveloperName('M/s. KNS INFRA PLOTLUXE LLP'), 'M/s. KNS Infra Plotluxe LLP');
  assert.equal(displayDeveloperName('M/s ANAND GROUP AND C SOMASHEKAR'), 'M/s Anand Group and C Somashekar');
});
