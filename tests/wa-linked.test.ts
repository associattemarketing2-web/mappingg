import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeLike, waDigits } from '../lib/wa-linked';

test('search text is literal in LIKE', () => {
  assert.equal(escapeLike('50%_off'), '50\\%\\_off');
  assert.equal(escapeLike('a\\b'), 'a\\\\b');
  assert.equal(escapeLike('Baner 2 BHK'), 'Baner 2 BHK');
});

test('digits of a typed number', () => {
  assert.equal(waDigits('+91 98765-43210'), '919876543210');
  assert.equal(waDigits('Rahul'), '');
});
