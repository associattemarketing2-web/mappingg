import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMonth, toStatuses, toConfigurations, toPrice, toArea, pinToSubmission, keepPinValues } from '../lib/pin-to-intake';

test('months: only exact month values are converted', () => {
  assert.equal(toMonth('Dec 2027'), '2027-12');
  assert.equal(toMonth('December 2030'), '2030-12');
  assert.equal(toMonth('2026-3'), '2026-03');
  for (const v of ['Ready', 'Q4 2027', '2027', '', null]) assert.equal(toMonth(v), null, String(v));
});

test('status round-trips with the intake → pin mapping', () => {
  assert.deepEqual(toStatuses('available'), { construction_status: 'Ready to Move', sales_status: null });
  assert.deepEqual(toStatuses('construction'), { construction_status: 'Under Construction', sales_status: null });
  assert.deepEqual(toStatuses('upcoming'), { construction_status: 'Upcoming', sales_status: null });
  assert.deepEqual(toStatuses('sold'), { construction_status: null, sales_status: 'Sold Out' });
});

test('configuration: converted only when every part is understood', () => {
  assert.deepEqual(toConfigurations('2 BHK / 3 BHK'), ['2 BHK', '3 BHK']);
  assert.deepEqual(toConfigurations('2, 3 BHK & Shops'), ['2 BHK', '3 BHK', 'Shop']);
  assert.deepEqual(toConfigurations('Plot'), ['Plot']);
  assert.deepEqual(toConfigurations('2.5 BHK'), ['2.5 BHK']);
  assert.equal(toConfigurations('3 BHK Duplex with private terrace'), null);
  assert.equal(toConfigurations('Office spaces from 500 sq ft'), null);
  assert.equal(toConfigurations(''), null);
});

test('price: only forms the intake can show the same way', () => {
  assert.deepEqual(toPrice('Price on Request'), { price_on_request: true });
  assert.deepEqual(toPrice('₹ 1.25 Cr Onwards'), { currency: 'INR', price_min: 1.25, price_max: null, price_unit: 'Crore', price_on_request: false });
  assert.deepEqual(toPrice('₹ 92 – 139 L'), { currency: 'INR', price_min: 92, price_max: 139, price_unit: 'Lakh', price_on_request: false });
  assert.equal(toPrice('₹ 98 Lacs - ₹ 1.35 Cr'), null, 'mixed units stay on the pin');
  assert.equal(toPrice('Only for Leasing'), null);
  assert.equal(toPrice('Associatte.com | +918881188181'), null);
});

test('area: plain sq ft numbers or ranges only', () => {
  assert.deepEqual(toArea('1,050 - 1,450 sq ft'), { area_unit: 'sq ft', carpet_area_min: 1050, carpet_area_max: 1450 });
  assert.deepEqual(toArea('850'), { area_unit: 'sq ft', carpet_area_min: 850, carpet_area_max: null });
  assert.equal(toArea('2 acres'), null);
});

test('a pin becomes a full submission; what cannot be held exactly is listed, not lost', () => {
  const pin = {
    title: 'Mantra Melange', developer: 'Mantra Properties', type: 'Residential', status: 'construction',
    location: 'Kharadi, Pune', lat: 18.5298, lng: 73.9357, price: '₹ 98 Lacs - ₹ 1.35 Cr', configuration: '2, 3 BHK & Shops',
    sqft: '', possession_timeline: 'Dec 2027', launch_date: 'Ready', rera_number: 'PM1261012601312, P52100012345',
    key_usp: 'Near EON IT Park', description: '', youtube_video_url: '', highlighted: true,
  };
  const { fields, kept } = pinToSubmission(pin);
  assert.equal(fields.project_name, 'Mantra Melange');
  assert.equal(fields.construction_status, 'Under Construction');
  assert.equal(fields.city, 'Pune');
  assert.equal(fields.locality, 'Kharadi');
  assert.deepEqual(fields.configurations, ['2 BHK', '3 BHK', 'Shop']);
  assert.equal(fields.possession_date_target, '2027-12');
  assert.deepEqual(fields.rera_numbers, ['PM1261012601312', 'P52100012345']);
  assert.equal(fields.price_min, undefined, 'mixed-unit price not forced into the form');
  assert.equal(fields.featured, true);
  assert.deepEqual(kept.map((k) => k.label).sort(), ['Launch (as on the map)', 'Price (as on the map)']);
});

test('publishing a pin-linked submission never blanks what the pin shows', () => {
  const existing = { price: '₹ 98 Lacs - ₹ 1.35 Cr', configuration: '2 BHK', sqft: '900', title: 'Old' };
  const fields = { title: 'New name', price: '', configuration: '2 BHK / 3 BHK', sqft: null };
  assert.deepEqual(keepPinValues(fields, existing), { title: 'New name', configuration: '2 BHK / 3 BHK' });
});

test('publish checks accept the pin values carried over under Additional details', async () => {
  const { publishBlockers } = await import('../public/partners/shared/fields.js');
  const { fields, kept } = pinToSubmission({ title: 'X', type: 'Residential', location: 'Kharadi, Pune', lat: 18.5, lng: 73.9, price: '₹ 98 Lacs - ₹ 1.35 Cr', configuration: '3 BHK Duplex with terrace', rera_number: 'P52100012345' });
  const fromPin = { ...fields, source: 'map_pin', additional_details: kept };
  assert.deepEqual(publishBlockers(fromPin), [], 'price and configuration kept on the pin satisfy the checks');
  const other = { ...fromPin, source: 'admin' };
  assert.ok(publishBlockers(other).includes('Price (or Price on request)'), 'normal submissions still need a structured price');
  const removed = { ...fromPin, additional_details: [] };
  assert.ok(publishBlockers(removed).includes('Configuration'), 'deleting the carried-over row brings the check back');
});
