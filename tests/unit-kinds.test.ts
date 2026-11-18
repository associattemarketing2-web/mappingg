import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitKinds, configLabel, bhkSizes } from '../lib/home/finder';
import { projectTitle, projectFaqs, offeringText } from '../lib/seo/project-meta';

const labels = (c: string) => unitKinds(c).map((k) => k.label);

test('non-BHK unit types are read from the configuration', () => {
  assert.deepEqual(labels('3 BHK / 4 BHK / Penthouse'), ['Penthouse']);
  assert.deepEqual(labels('Villas & Row Houses'), ['Villa', 'Row House']);
  assert.deepEqual(labels('Office spaces, Shops, Showrooms'), ['Office', 'Shop', 'Showroom']);
  assert.deepEqual(labels('Co-working / Warehouse'), ['Co-working', 'Warehouse']);
  assert.deepEqual(labels('2 BHK, 3 BHK'), []);
  assert.deepEqual(labels(''), []);
});

test('any other keyword typed in the configuration is kept as typed', () => {
  assert.deepEqual(labels('2 BHK / 3 BHK / Jodi'), ['Jodi']);
  assert.deepEqual(labels('3 BHK Jodi flats, 4 BHK'), ['Jodi Flats']);
  assert.deepEqual(labels('Sky Villa / Simplex / Garden Flat'), ['Villa', 'Sky Villa', 'Simplex', 'Garden Flat']);
  assert.deepEqual(labels('2 BHK, 3 BHK & EWS'), ['EWS']);
});

test('sizes, prices, filler and status notes are not keywords', () => {
  assert.deepEqual(labels('2 BHK flats and 3 BHK apartments'), []);
  assert.deepEqual(labels('Luxury Penthouse / Office spaces'), ['Penthouse', 'Office']);
  assert.deepEqual(labels('2 BHK - 1,050 sq ft / ₹ 1.2 Cr onwards'), []);
  assert.deepEqual(labels('3 BHK / New Launch / Phase 2 / Tower A'), []);
  assert.deepEqual(labels('3 BHK / 3 BHK + Study'), []);
  assert.deepEqual(labels('Only for Leasing'), []);
  assert.deepEqual(labels('Studio Appartment'), ['Studio']);
  assert.deepEqual(labels('Villas (Bareshell)'), ['Villa']);
  assert.deepEqual(labels('4 BHK independent floors / NA Plots'), ['Plot', 'Independent Floors', 'NA Plots']);
});

test('BHK sizes are unchanged by the new unit types', () => {
  assert.deepEqual(bhkSizes('3 BHK / 4 BHK / Penthouse'), [3, 4]);
});

test('card label shows BHK sizes and the other unit types', () => {
  assert.equal(configLabel('3 BHK / 4 BHK / Penthouse'), '3, 4 BHK · Penthouse');
  assert.equal(configLabel('Office / Shop'), 'Office · Shop');
  assert.equal(configLabel('2 BHK'), '2 BHK');
});

test('project title and FAQ name penthouses, villas and offices', () => {
  const p = { title: 'Sky Towers', configuration: '3 BHK / 4 BHK / Penthouse' };
  assert.match(projectTitle(p, 'Baner', 'Pune'), /3 and 4 BHK, Penthouses/);
  assert.equal(offeringText(p.configuration), '3 and 4 BHK homes and penthouses');
  const faq = projectFaqs(p, 'Baner', 'Pune').find((f) => /configurations/.test(f.q));
  assert.ok(faq && /penthouses/.test(faq.a));

  const office = projectFaqs({ title: 'Biz Park', configuration: 'Office / Shop' }, 'Baner', 'Pune').find((f) => /configurations/.test(f.q));
  assert.equal(office?.a, 'Biz Park offers office spaces and shops (Office / Shop).');

  const jodi = { title: 'Green Heights', configuration: '2 BHK / 3 BHK / Jodi' };
  assert.match(projectTitle(jodi, 'Wakad', 'Pune'), /2 and 3 BHK, Jodi/);
  assert.equal(offeringText(jodi.configuration), '2 and 3 BHK homes and Jodi');
  assert.equal(configLabel(jodi.configuration), '2, 3 BHK · Jodi');
});
