import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePriceLakh, parseAreaSqft, bhkSizes, hasBhk, inBudget, inSize, matchesQuery, distanceKm, coarseCoords, formatLakh, isCarpetArea,
} from '../lib/home/finder';

test('parsePriceLakh reads the price formats used on live pins', () => {
  assert.deepEqual(parsePriceLakh('₹ 98 Lacs - ₹ 1.35 Cr'), { min: 98, max: 135 });
  assert.deepEqual(parsePriceLakh('₹ 3 Cr Onwards'), { min: 300, max: 300 });
  assert.deepEqual(parsePriceLakh('₹ 160 – 375 L'), { min: 160, max: 375 });
  assert.deepEqual(parsePriceLakh('₹ 0.7 – 1.7 Cr'), { min: 70, max: 170 });
  assert.deepEqual(parsePriceLakh('₹ 52 Lac Onwards'), { min: 52, max: 52 });
  assert.deepEqual(parsePriceLakh('₹ 88Lacs Onwards'), { min: 88, max: 88 });
  assert.deepEqual(parsePriceLakh('₹ 3.10 Cr Onwards (3 BHK)'), { min: 310, max: 310 });
  assert.deepEqual(parsePriceLakh('3.30 cr* onwards'), { min: 330, max: 330 });
});

test('parsePriceLakh refuses anything without a reliable unit or not a sale price', () => {
  for (const bad of ['₹ 2.31 Onwards', 'Price on Request', 'Deposit ₹ 40 Cr', 'Only for Leasing', '+918881188181',
    'Associatte.com', 'Available for Rental & Resale', '22 Acres Bajaj HO', '', undefined, null]) {
    assert.equal(parsePriceLakh(bad), null, String(bad));
  }
});

test('parseAreaSqft needs an explicit sq ft unit and a plausible flat size', () => {
  assert.deepEqual(parseAreaSqft('796 - 1072 Sq Ft'), { min: 796, max: 1072 });
  assert.deepEqual(parseAreaSqft('713 – 1,139 Sq Ft (carpet)'), { min: 713, max: 1139 });
  assert.deepEqual(parseAreaSqft('738 – 1075 Sq.ft. carpet'), { min: 738, max: 1075 });
  assert.equal(parseAreaSqft('5500'), null);
  assert.equal(parseAreaSqft('72,00,000 Sq Ft'), null);
  assert.equal(parseAreaSqft('Limited Inventory 3 & 4 BHK'), null);
  assert.equal(isCarpetArea('713 – 1,139 Sq Ft (carpet)'), true);
  assert.equal(isCarpetArea('796 - 1072 Sq Ft'), false);
});

test('bhkSizes and hasBhk', () => {
  assert.deepEqual(bhkSizes('2 / 2.5 / 3 BHK'), [2, 2.5, 3]);
  assert.deepEqual(bhkSizes('3 BHK / 4 BHK / 2 BHK / Shop'), [2, 3, 4]);
  assert.deepEqual(bhkSizes('3 / 4 / Duplex'), []);
  assert.deepEqual(bhkSizes('Plot'), []);
  assert.equal(hasBhk('2 / 2.5 / 3 BHK', '2'), true);
  assert.equal(hasBhk('2 / 2.5 / 3 BHK', '1'), false);
  assert.equal(hasBhk('3 / 4 / 5 BHK', '4'), true);
});

test('budget and size bands overlap the project range', () => {
  assert.equal(inBudget('₹ 98 Lacs - ₹ 1.35 Cr', '50-lakh-1-crore'), true);
  assert.equal(inBudget('₹ 98 Lacs - ₹ 1.35 Cr', '1-2-crore'), true);
  assert.equal(inBudget('₹ 98 Lacs - ₹ 1.35 Cr', 'under-50-lakh'), false);
  assert.equal(inBudget('₹ 1 Cr Onwards', '50-lakh-1-crore'), false);
  assert.equal(inBudget('Price on Request', '1-2-crore'), false);
  assert.equal(inSize('796 - 1072 Sq Ft', '1000-1500'), true);
  assert.equal(inSize('5500', '1000-1500'), false);
});

test('matchesQuery, distance, coarse coords, formatting', () => {
  assert.equal(matchesQuery('kharadi 2', 'Mantra Melange', 'Kharadi / Wadgaonshri, Pune', '2 BHK'), true);
  assert.equal(matchesQuery('wakad', 'Mantra Melange', 'Kharadi, Pune'), false);
  assert.equal(matchesQuery('', 'x'), true);
  const d = distanceKm(18.5513, 73.9348, 18.5204, 73.8567); // Kharadi → Pune centre ≈ 8.9 km
  assert.ok(d > 8 && d < 10, String(d));
  assert.deepEqual(coarseCoords('18.551349', '73.934812'), { lat: 18.551, lng: 73.935 });
  assert.equal(coarseCoords('abc', 1), null);
  assert.equal(coarseCoords(0, 0), null);
  assert.equal(coarseCoords(91, 10), null);
  assert.equal(formatLakh(98), '₹98 L');
  assert.equal(formatLakh(135), '₹1.35 Cr');
});
