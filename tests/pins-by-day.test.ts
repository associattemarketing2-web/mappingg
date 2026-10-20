import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createdOnDay, perDay, dayKeyIST } from '../lib/insights';

test('a day means India time: 23:59 IST and 00:01 IST fall on different days', () => {
  const rows = [
    { id: 'a', created_at: '2026-10-18T18:29:00.000Z' }, // 18 Oct 23:59 IST
    { id: 'b', created_at: '2026-10-18T18:31:00.000Z' }, // 19 Oct 00:01 IST
    { id: 'c', created_at: '2026-10-18T05:00:00.000Z' }, // 18 Oct 10:30 IST
    { id: 'd', created_at: 'not a date' },
    { id: 'e' },
  ];
  assert.deepEqual(createdOnDay(rows, '2026-10-18').map((r) => r.id), ['a', 'c'], 'newest first');
  assert.deepEqual(createdOnDay(rows, '2026-10-19').map((r) => r.id), ['b']);
  assert.deepEqual(createdOnDay(rows, '2026-10-17'), []);
});

test('every heatmap square count equals the length of its project list', () => {
  const now = Date.now();
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: String(i), created_at: new Date(now - i * 7.3 * 3600 * 1000).toISOString() }));
  const { days } = perDay(rows.map((r) => r.created_at), 8);
  assert.ok(days.some((d) => d.count > 0));
  for (const d of days) assert.equal(createdOnDay(rows, d.date).length, d.count, d.date);
  assert.equal(dayKeyIST(new Date('2026-10-18T18:31:00Z')), '2026-10-19');
});
