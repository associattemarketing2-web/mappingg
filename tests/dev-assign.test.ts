import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';
import { startTestDb } from './helpers/api-db';

// Super admin → Accounts → developer → "Projects access" (/api/admin/dev-assign):
// assigned projects show in the developer's own list, stay live, and can be taken back.

const require = createRequire(import.meta.url);
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= require('node:async_hooks').AsyncLocalStorage;
const { requestAsyncStorage } = require('next/dist/client/components/request-async-storage.external.js');
const { RequestCookies } = require('next/dist/compiled/@edge-runtime/cookies');

let auth: typeof import('../lib/auth');
let pgq: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>;
type U = { id: string; email: string; role: string };
const OWNER = { id: 'da-owner', email: 'owner@example.test', role: 'admin' };
const DEV = { id: 'da-dev', email: 'dev@gera.example.test', role: 'developer' };
const OTHER = { id: 'da-other', email: 'other@example.test', role: 'developer' };
const BUYER = { id: 'da-buyer', email: 'buyer@example.test', role: 'buyer' };

async function call(handler: (req: NextRequest) => Promise<Response>, url: string, init: { method?: string; body?: unknown; user?: U | null } = {}) {
  const headers = new Headers({ 'x-forwarded-for': '10.9.9.9' });
  if (init.user) headers.set('cookie', `${auth.SESSION_COOKIE}=${await auth.createSessionToken(init.user)}`);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const req = new NextRequest(`http://localhost${url}`, { method: init.method || 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  const store = { headers, cookies: new RequestCookies(headers), mutableCookies: new RequestCookies(headers), draftMode: { isEnabled: false } };
  const res: Response = await requestAsyncStorage.run(store, () => handler(req));
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

before(async () => {
  const { pg, insert } = await startTestDb();
  pgq = (s, p) => pg.query(s, p as never[]) as never;
  await pg.exec(`CREATE TABLE IF NOT EXISTS "account_activity" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  await insert('pins', [
    { id: 'g1', number: 901, title: 'Gera World of Joy', developer: 'Gera Developments', location: 'Kharadi, Pune', lat: 18.55, lng: 73.94, hidden: false, pending_review: false },
    { id: 'g2', number: 902, title: 'Gera Island of Joy', developer: 'Gera Developments', location: 'Kharadi, Pune', lat: 18.56, lng: 73.95, hidden: false, pending_review: false },
    { id: 'g3', number: 903, title: 'Gera Song of Joy', developer: 'Gera Developments', location: 'Kharadi, Pune', lat: 18.57, lng: 73.96, owner_user_id: OTHER.id },
    { id: 'x1', number: 904, title: 'Other Tower', developer: 'Someone Else', location: 'Baner, Pune', lat: 18.5, lng: 73.8 },
  ]);
  await insert('users', [OWNER, DEV, OTHER, BUYER].map((u) => ({ ...u, name: `Test ${u.role}`, verification: 'approved', access: 'editor', permissions: [] })));
  auth = await import('../lib/auth');
});

test('only staff with accounts permission can use it', async () => {
  const R = await import('../app/api/admin/dev-assign/route');
  assert.equal((await call(R.GET as never, `/api/admin/dev-assign?dev=${DEV.id}`)).status, 401);
  assert.equal((await call(R.GET as never, `/api/admin/dev-assign?dev=${DEV.id}`, { user: DEV })).status, 401);
  assert.equal((await call(R.POST as never, '/api/admin/dev-assign', { method: 'POST', user: DEV, body: { dev: DEV.id, action: 'assign', pin_ids: ['x1'] } })).status, 401);
  // Only developer accounts can be given projects.
  assert.equal((await call(R.GET as never, `/api/admin/dev-assign?dev=${BUYER.id}`, { user: OWNER })).status, 404);
});

test('search by developer name, assign, developer sees them, they stay live, unassign removes', async () => {
  const R = await import('../app/api/admin/dev-assign/route');
  const MY = await import('../app/api/my/projects/route');

  const found = await call(R.GET as never, `/api/admin/dev-assign?dev=${DEV.id}&q=gera`, { user: OWNER });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.data.results.map((p: any) => p.id).sort(), ['g1', 'g2', 'g3']);
  assert.equal(found.body.data.results.find((p: any) => p.id === 'g3').owner.id, OTHER.id);
  assert.equal(found.body.data.projects.length, 0);
  // By pin number and by part of the project name.
  assert.deepEqual((await call(R.GET as never, `/api/admin/dev-assign?dev=${DEV.id}&q=904`, { user: OWNER })).body.data.results.map((p: any) => p.id), ['x1']);
  assert.deepEqual((await call(R.GET as never, `/api/admin/dev-assign?dev=${DEV.id}&q=island`, { user: OWNER })).body.data.results.map((p: any) => p.id), ['g2']);

  const done = await call(R.POST as never, '/api/admin/dev-assign', { method: 'POST', user: OWNER, body: { dev: DEV.id, action: 'assign', pin_ids: ['g1', 'g2'] } });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.changed, 2);
  // Assigning again changes nothing.
  assert.equal((await call(R.POST as never, '/api/admin/dev-assign', { method: 'POST', user: OWNER, body: { dev: DEV.id, action: 'assign', pin_ids: ['g1'] } })).body.data.changed, 0);

  const mine = await call(MY.GET as never, '/api/my/projects', { user: DEV });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.data.map((p: any) => p.id).sort(), ['g1', 'g2']);
  // The projects themselves are untouched: still public.
  const live = (await pgq(`SELECT doc->>'hidden' h, doc->>'pending_review' pr FROM pins WHERE id = 'g1'`)).rows[0];
  assert.equal(live.h, 'false');
  assert.equal(live.pr, 'false');
  // The other developer's list is unchanged.
  assert.deepEqual((await call(MY.GET as never, '/api/my/projects', { user: OTHER })).body.data.map((p: any) => p.id), ['g3']);

  const un = await call(R.POST as never, '/api/admin/dev-assign', { method: 'POST', user: OWNER, body: { dev: DEV.id, action: 'unassign', pin_ids: ['g2', 'g3'] } });
  assert.equal(un.body.data.changed, 1, 'g3 belongs to someone else and is left alone');
  assert.deepEqual((await call(MY.GET as never, '/api/my/projects', { user: DEV })).body.data.map((p: any) => p.id), ['g1']);
  assert.equal((await pgq(`SELECT doc ? 'owner_user_id' has FROM pins WHERE id = 'g2'`)).rows[0].has, false);
  assert.equal((await pgq(`SELECT doc->>'owner_user_id' o FROM pins WHERE id = 'g3'`)).rows[0].o, OTHER.id);
});
