import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOG_PER_PAGE, blogPageCount, blogPageHref, blogPageSlice, parseBlogPage } from '../lib/blog-pagination';

const posts = Array.from({ length: 16 }, (_, i) => ({ id: i }));

test('nine posts per page', () => assert.equal(BLOG_PER_PAGE, 9));

test('page numbers: valid, malformed, negative, decimal, arrays', () => {
  assert.equal(parseBlogPage(undefined), 1);
  assert.equal(parseBlogPage('2'), 2);
  assert.equal(parseBlogPage('02'), 2);
  assert.equal(parseBlogPage(['3', '4']), 3);
  for (const bad of ['', 'abc', '-1', '0', '1', '1.5', '2abc', '+2', '1e1', ' ']) assert.equal(parseBlogPage(bad), 1, bad);
});

test('slices cover every post exactly once', () => {
  assert.equal(blogPageCount(posts.length), 2);
  const p1 = blogPageSlice(posts, 1)!, p2 = blogPageSlice(posts, 2)!;
  assert.equal(p1.length, 9);
  assert.equal(p2.length, 7);
  assert.deepEqual([...p1, ...p2].map((p) => p.id), posts.map((p) => p.id));
});

test('out-of-range page → null (404)', () => {
  assert.equal(blogPageSlice(posts, 3), null);
  assert.deepEqual(blogPageSlice([], 1), []);
  assert.equal(blogPageSlice([], 2), null);
});

test('hrefs', () => {
  assert.equal(blogPageHref(1), '/blog');
  assert.equal(blogPageHref(2), '/blog?page=2');
});
