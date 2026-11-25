import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRuns, expandTiming } from '../lib/wa-schedule';
import { fillPayload, payloadSummary } from '../lib/whatsapp';
import { checkMedia, safeName } from '../lib/wa-media';

const NOW = Date.parse('2026-11-25T10:00:00.000Z');

test('expandTiming: now, chosen times, repeat', () => {
  assert.deepEqual(expandTiming({ mode: 'now' }, NOW), ['2026-11-25T10:00:00.000Z']);
  assert.deepEqual(
    expandTiming({ mode: 'at', times: ['2026-11-25T15:00:00.000Z', '2026-11-25T12:00:00.000Z', '2026-11-25T12:00:00.000Z'] }, NOW),
    ['2026-11-25T12:00:00.000Z', '2026-11-25T15:00:00.000Z'],
  );
  assert.deepEqual(
    expandTiming({ mode: 'repeat', start: '2026-11-25T11:00:00.000Z', every: 1, unit: 'hours', count: 3 }, NOW),
    ['2026-11-25T11:00:00.000Z', '2026-11-25T12:00:00.000Z', '2026-11-25T13:00:00.000Z'],
  );
  assert.equal(expandTiming({ mode: 'repeat', start: '2026-11-25T11:00:00.000Z', every: 2, unit: 'days', count: 2 }, NOW)[1], '2026-11-27T11:00:00.000Z');
});

test('expandTiming refuses past times, too-fast repeats and bad dates', () => {
  assert.throws(() => expandTiming({ mode: 'at', times: ['2026-11-24T10:00:00.000Z'] }, NOW), /past/);
  assert.throws(() => expandTiming({ mode: 'at', times: [] }, NOW), /at least one/);
  assert.throws(() => expandTiming({ mode: 'at', times: ['tomorrow'] }, NOW), /Invalid/);
  assert.throws(() => expandTiming({ mode: 'repeat', start: '2026-11-25T11:00:00.000Z', every: 1, unit: 'minutes', count: 5 }, NOW), /5 minutes/);
  assert.throws(() => expandTiming({ mode: 'repeat', start: '2026-11-25T11:00:00.000Z', every: 1, unit: 'hours', count: 500 }, NOW), /between/);
});

test('buildRuns orders every message × time, keeping message order at the same moment', () => {
  const runs = buildRuns([
    { payload: { kind: 'text', text: 'B' }, timing: { mode: 'at', times: ['2026-11-25T12:00:00.000Z'] } },
    { payload: { kind: 'text', text: 'A' }, timing: { mode: 'now' } },
    { payload: { kind: 'text', text: 'C' }, timing: { mode: 'at', times: ['2026-11-25T12:00:00.000Z'] } },
  ], NOW);
  assert.deepEqual(runs.map((r) => r.msg), [1, 0, 2]);
  assert.ok(runs.every((r) => r.status === 'pending' && r.cursor === 0));
  assert.throws(() => buildRuns(Array.from({ length: 3 }, () => ({ payload: { kind: 'text' as const, text: 'x' }, timing: { mode: 'repeat' as const, start: '2026-11-25T11:00:00.000Z', every: 1, unit: 'hours' as const, count: 100 } })), NOW), /Too many/);
});

test('fillPayload puts each name into text, captions and template values', () => {
  assert.equal(fillPayload({ kind: 'text', text: 'Hi {name}!' }, 'Rahul').text, 'Hi Rahul!');
  assert.equal(fillPayload({ kind: 'image', text: 'For {NAME}', media: { url: 'https://x/a.jpg' } }).text, 'For there');
  const t = fillPayload({ kind: 'template', template: { name: 'promo', language: 'en', params: ['{name}', 'Baner'], url_param: 'ref-{name}', header: { type: 'text', params: ['Hello {name}'] } } }, 'Priya').template!;
  assert.deepEqual(t.params, ['Priya', 'Baner']);
  assert.equal(t.url_param, 'ref-Priya');
  assert.deepEqual(t.header, { type: 'text', params: ['Hello Priya'] });
  assert.equal(payloadSummary({ kind: 'video', text: 'Tour', media: { url: 'https://x/v.mp4', filename: 'tour.mp4' } }), '[Video: tour.mp4] Tour');
  assert.equal(payloadSummary({ kind: 'template', template: { name: 'promo', language: 'en', params: [] } }), 'Template: promo');
});

test('checkMedia applies WhatsApp limits; safeName makes URL-safe names', () => {
  assert.equal(checkMedia('image', 'image/jpeg', 1000), '');
  assert.match(checkMedia('image', 'image/webp', 1000), /JPG or PNG/);
  assert.match(checkMedia('image', 'image/png', 6 * 1024 * 1024), /5 MB/);
  assert.equal(checkMedia('video', 'video/mp4', 15 * 1024 * 1024), '');
  assert.match(checkMedia('video', 'video/quicktime', 1000), /MP4/);
  assert.equal(checkMedia('document', 'application/pdf', 10 * 1024 * 1024), '');
  assert.equal(safeName('My Brochure (Final).PDF'), 'my-brochure-final.pdf');
  assert.equal(safeName('..'), 'file');
});

test('fallbackPayload: 24-hour template carries the message text and the message file', async () => {
  const { fallbackPayload, templateSafe } = await import('../lib/whatsapp');
  assert.equal(templateSafe('Line 1\n\nLine 2\tend     x'), 'Line 1 · Line 2 end   x');
  assert.equal(fallbackPayload({ kind: 'text', text: 'hi' }), null);
  const fb = fallbackPayload({
    kind: 'video', text: 'Site tour\nBaner', media: { url: 'https://x/v.mp4', filename: 'v.mp4' },
    fallback: { name: 'promo_video', language: 'en', params: ['{name}', '{message}'], header: { type: 'video', link: '' } },
  })!;
  assert.equal(fb.kind, 'template');
  assert.deepEqual(fb.template!.params, ['{name}', 'Site tour · Baner']);
  assert.deepEqual(fb.template!.header, { type: 'video', link: 'https://x/v.mp4', filename: 'v.mp4' });
  // {name} is filled per person later, and template values are kept on one line.
  assert.deepEqual(fillPayload({ kind: 'template', template: fb.template }, 'Amit\nK').template!.params, ['Amit · K', 'Site tour · Baner']);
});
