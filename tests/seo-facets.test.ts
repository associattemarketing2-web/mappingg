import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACETS, facetBySlug, facetPins, availableFacets, summarise, MIN_FACET_PROJECTS } from '../lib/seo/facets';

const f = (slug: string) => facetBySlug(slug)!;

test('BHK facets read only BHK numbers from the configuration', () => {
  assert.ok(f('2-bhk-flats').match({ configuration: '2 / 2.5 / 3 BHK' }));
  assert.ok(f('3-bhk-flats').match({ configuration: '2 / 2.5 / 3 BHK' }));
  assert.ok(!f('1-bhk-flats').match({ configuration: '2 / 2.5 / 3 BHK' }));
  assert.ok(f('4-bhk-flats').match({ configuration: '5 BHK Villa' }));
  assert.ok(!f('2-bhk-flats').match({ configuration: 'Shops & offices' }));
  assert.ok(!f('2-bhk-flats').match({ configuration: '' }));
});

test('budget facets use the starting price and need explicit units', () => {
  assert.ok(f('flats-under-1-crore').match({ price: '₹ 98 Lacs - ₹ 1.35 Cr' }));
  assert.ok(!f('flats-under-50-lakh').match({ price: '₹ 98 Lacs - ₹ 1.35 Cr' }));
  assert.ok(f('flats-under-2-crore').match({ price: '₹ 1.5 Cr Onwards' }));
  assert.ok(!f('flats-under-1-crore').match({ price: '₹ 2.31 Onwards' })); // no unit → unknown
  assert.ok(!f('flats-under-1-crore').match({ price: 'Price on request' }));
  assert.ok(f('luxury-flats-above-2-crore').match({ price: '₹ 3.2 – 4 Cr' }));
  assert.ok(!f('luxury-flats-above-2-crore').match({ price: '₹ 1.9 – 4 Cr' }));
});

test('a price the admin hid is never used', () => {
  assert.ok(!f('flats-under-1-crore').match({ price: '₹ 80 L', field_visibility: { price: false } }));
});

test('sold-out projects are left out', () => {
  const pins = [{ status: 'sold', configuration: '2 BHK' }, { status: 'construction', configuration: '2 BHK' }];
  assert.equal(facetPins(pins, f('2-bhk-flats')).length, 1);
});

test('a facet page needs MIN_FACET_PROJECTS matches', () => {
  const few = Array.from({ length: MIN_FACET_PROJECTS - 1 }, () => ({ status: 'construction', configuration: '2 BHK' }));
  assert.equal(availableFacets(few).length, 0);
  const enough = [...few, { status: 'upcoming', configuration: '2 BHK' }];
  assert.deepEqual(availableFacets(enough).map((x) => x.facet.slug), ['2-bhk-flats']);
});

test('summary reports the real price spread and how many are priced', () => {
  const s = summarise([{ price: '₹ 75 L' }, { price: '₹ 1.2 Cr' }, { price: 'On request' }]);
  assert.deepEqual(s, { count: 3, priceFrom: 75, priceTo: 120, priced: 2 });
});

test('facet slugs are unique', () => {
  assert.equal(new Set(FACETS.map((x) => x.slug)).size, FACETS.length);
});

test('blog guides pair with their facet page only', async () => {
  const { isFacetGuide } = await import('../lib/seo/facets');
  assert.ok(isFacetGuide('2-bhk-flats', 'pune', '2-bhk-flats-in-pune'));
  assert.ok(isFacetGuide('flats-under-1-crore', 'pune', 'flats-under-1-crore-in-pune'));
  assert.ok(isFacetGuide('luxury-flats-above-2-crore', 'pune', 'luxury-flats-villas-in-pune'));
  assert.ok(!isFacetGuide('2-bhk-flats', 'pune', '3-bhk-flats-in-pune'));
  assert.ok(!isFacetGuide('2-bhk-flats', 'mumbai', '2-bhk-flats-in-pune'));
  assert.ok(!isFacetGuide('2-bhk-flats', 'pune', 'new-projects-in-mundhwa-pune'));
});

test('an implausible price for a small home is not used', () => {
  assert.ok(!f('luxury-flats-above-2-crore').match({ price: '₹ 103.96 – 111.2 Cr', configuration: '3 BHK' }));
  assert.ok(f('luxury-flats-above-2-crore').match({ price: '₹ 23 Cr', configuration: '4.5 BHK' }));
});
