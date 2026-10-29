import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearbyFrom, nearbyLocality, localityOptions, isAdminArea } from '../lib/home/nearby';
import type { ProjectCardData } from '../lib/home/cards';

const card = (number: number, locality: string, city: string, lat: number, lng: number, residential = true): ProjectCardData => ({
  number, href: `/projects/p-${number}`, title: `P${number}`, locality, city, developer: '', price: '', bhk: '', area: '',
  status: '', possession: '', rera: '', image: '', featured: false, residential, lat, lng,
});

// Kharadi ≈ 18.551, 73.940; Wakad ≈ 18.598, 73.765 (≈ 19 km apart); Thane ≈ 19.218, 72.978 (> 100 km).
const cards = [
  card(1, 'Kharadi', 'Pune', 18.551, 73.940),
  card(2, 'Kharadi', 'Pune', 18.555, 73.945),
  card(3, 'Kharadi', 'Pune', 18.548, 73.936),
  card(4, 'Wakad', 'Pune', 18.598, 73.765),
  card(5, 'Kharadi', 'Pune', 18.552, 73.941, false), // commercial: never in "near you"
  card(6, 'Thane', 'Mumbai', 19.218, 72.978),
];

test('nearbyFrom ranks by real distance and names a locality only when projects agree', () => {
  const r = nearbyFrom(cards, 18.552, 73.941);
  assert.deepEqual(r.projects.map((p) => p.number), [1, 2, 3, 4]);
  assert.deepEqual(r.area, { locality: 'Kharadi', city: 'Pune' });
  assert.ok(r.projects[0].distanceKm < 0.5);
});

test('nearbyFrom: only the city when no locality is close, nothing when far from every project', () => {
  const mid = nearbyFrom(cards, 18.575, 73.85); // between Kharadi and Wakad
  assert.equal(mid.area?.locality, '');
  assert.equal(mid.area?.city, 'Pune');
  const far = nearbyFrom(cards, 28.6, 77.2); // Delhi
  assert.deepEqual(far, { area: null, projects: [] });
});

test('nearbyLocality puts the chosen locality first; localityOptions needs enough projects', () => {
  const r = nearbyLocality(cards, 'wakad');
  assert.equal(r?.area?.locality, 'Wakad');
  assert.equal(r?.projects[0].number, 4);
  assert.equal(nearbyLocality(cards, 'nowhere'), null);
  assert.deepEqual(localityOptions(cards).map((o) => [o.slug, o.count]), [['kharadi', 3]]);
});

test('talukas and districts are never used to name where the visitor is', () => {
  const taluka = [card(11, 'Haveli', 'Pune', 18.551, 73.940), card(12, 'Haveli', 'Pune', 18.552, 73.941)];
  assert.deepEqual(nearbyFrom(taluka, 18.551, 73.940).area, { locality: '', city: 'Pune' });
  assert.equal(isAdminArea('Pune City'), true);
  assert.equal(isAdminArea('Bengaluru East'), true);
  assert.equal(isAdminArea('Kharadi'), false);
  assert.deepEqual(localityOptions([...taluka, card(13, 'Haveli', 'Pune', 18.5, 73.9)], undefined, 3, { localitiesOnly: true }), []);
});
