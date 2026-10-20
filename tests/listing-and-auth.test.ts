import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate, pageHref, pageWindow, LISTING_PER_PAGE } from '../lib/seo/paginate';
import { reraRegistry, projectTitle, projectFaqs, TITLE_BUDGET } from '../lib/seo/project-meta';
import { roleOrDefault, DEFAULT_ROLE } from '../lib/auth-role';

const items = Array.from({ length: 965 }, (_, i) => i + 1);

test('listing pagination: pages cover every item once, in order', () => {
  const p1 = paginate(items, undefined)!;
  assert.equal(p1.page, 1);
  assert.equal(p1.pages, Math.ceil(965 / LISTING_PER_PAGE));
  assert.equal(p1.items.length, LISTING_PER_PAGE);
  assert.equal(p1.from, 1);
  const seen: number[] = [];
  for (let n = 1; n <= p1.pages; n++) seen.push(...paginate(items, String(n))!.items);
  assert.deepEqual(seen, items, 'no item skipped or repeated');
  const last = paginate(items, String(p1.pages))!;
  assert.equal(last.items.length, 965 - (p1.pages - 1) * LISTING_PER_PAGE);
});

test('listing pagination: bad page values fall back to page 1; past the end is null (404)', () => {
  for (const bad of ['0', '-3', 'abc', '2.5', '', ['x']]) assert.equal(paginate(items, bad as never)!.page, 1, String(bad));
  assert.equal(paginate(items, '999'), null);
  assert.equal(paginate([], undefined)!.pages, 1, 'an empty list is one empty page, not a 404');
});

test('page links and the page-number window', () => {
  assert.equal(pageHref('/projects', 1), '/projects');
  assert.equal(pageHref('/projects', 3), '/projects?page=3');
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(6, 21), [1, null, 4, 5, 6, 7, 8, null, 21]);
  assert.deepEqual(pageWindow(21, 21), [1, null, 19, 20, 21]);
});

test('RERA numbers are matched to the registry that issued them', () => {
  assert.equal(reraRegistry('P52100012345').name, 'MahaRERA');
  assert.equal(reraRegistry('PM1261012601312').name, 'MahaRERA');
  assert.equal(reraRegistry('PRM/KA/RERA/1251/308/PR/250926/008969').name, 'RERA Karnataka');
  assert.equal(reraRegistry('GGM/930/662/2025/33').name, 'Haryana RERA');
  assert.equal(reraRegistry('UPRERAPRJ575706').name, 'UP RERA');
  assert.equal(reraRegistry('P02400003456').name, 'Telangana RERA');
  assert.deepEqual(reraRegistry('XYZ-123456'), { name: 'RERA', url: '' }, 'unknown format: no guessed link');
  const faq = projectFaqs({ title: 'Splendid Evora', rera_number: 'PRM/KA/RERA/1251/308/PR/250926/008969' }, 'Anekal', 'Bengaluru').find((f) => /RERA/.test(f.q))!;
  assert.match(faq.a, /RERA Karnataka registration number/);
  assert.doesNotMatch(faq.a, /MahaRERA/);
});

test('project title fallback suffix is counted in full (no over-long titles)', () => {
  for (const name of ['24 High Business Park', 'Kohinoor Business Towers', 'Delta New Palm Beach', 'A']) {
    const t = projectTitle({ title: name }, 'Juinagar', 'Mumbai & MMR');
    assert.ok(t.length <= TITLE_BUDGET || !t.includes('|'), `${t.length}: ${t}`);
  }
});

test('a missing role never grants staff access', () => {
  assert.equal(DEFAULT_ROLE, 'buyer');
  for (const v of [undefined, null, '', '   ', 0, {}]) assert.equal(roleOrDefault(v), 'buyer');
  assert.equal(roleOrDefault('admin'), 'admin');
  assert.equal(roleOrDefault(' employee '), 'employee');
});
