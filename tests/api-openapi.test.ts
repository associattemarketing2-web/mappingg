import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { openApiSpec } from '../lib/api-platform/openapi';
import { SCOPE_LIST } from '../lib/api-platform/config';
import { generateKey, parseKey, keyMatches, bearerToken, hashKey } from '../lib/api-platform/keys';

// The docs must match the implementation: every documented path has a route
// file, and every route file (except the JSON 404 catch-all) is documented.

const ROOT = 'app/api/v1';
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('OpenAPI paths ⇔ route files', () => {
  const spec = openApiSpec() as { paths: Record<string, unknown> };
  const documented = Object.keys(spec.paths).sort();
  const routes = walk(ROOT)
    .filter((f) => f.endsWith('route.ts') && !f.includes('[...path]'))
    .map((f) => '/' + path.relative(ROOT, path.dirname(f)).split(path.sep).join('/').replace(/\[(\w+)\]/g, '{$1}'))
    .sort();
  assert.deepEqual(routes, documented);
  for (const p of documented) assert.ok(existsSync(path.join(ROOT, p.replace(/\{(\w+)\}/g, '[$1]'), 'route.ts')));
});

test('every scope required in the docs exists', () => {
  const spec = openApiSpec() as { paths: Record<string, { get: Record<string, unknown> }> };
  for (const [p, item] of Object.entries(spec.paths)) {
    const s = item.get['x-required-scope'];
    if (s && s !== 'any valid key') assert.ok((SCOPE_LIST as string[]).includes(s as string), `${p}: ${s}`);
  }
});

test('keys: format, uniqueness, hash-only storage, constant-time match, bearer parsing', () => {
  const a = generateKey(), b = generateKey();
  assert.match(a.secret, /^mgk_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.secret, b.secret);
  assert.notEqual(a.id, b.id);
  assert.equal(a.hash, hashKey(a.secret));
  assert.ok(!a.hash.includes(a.secret));
  assert.deepEqual(parseKey(a.secret), { id: a.id });
  assert.equal(parseKey(a.secret + 'x'), null);
  assert.equal(parseKey('mgk_' + a.id), null, 'the prefix + id alone is not a key');
  assert.equal(keyMatches(a.secret, a.hash), true);
  assert.equal(keyMatches(b.secret, a.hash), false);
  assert.equal(keyMatches(a.secret, 'zz'), false);
  assert.equal(bearerToken(`Bearer ${a.secret}`), a.secret);
  assert.equal(bearerToken(`bearer   ${a.secret}  `), a.secret);
  for (const h of [null, '', a.secret, `Basic ${a.secret}`, `Bearer`, `Bearer a b`]) assert.equal(bearerToken(h), null, String(h));
});
