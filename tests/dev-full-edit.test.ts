import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/api-db';

// "Edit all details" in the Developer panel: a developer's own pin opens in the
// builder form (/submit) through their own link, as an editable draft linked to
// the pin, and saving it goes to the super admin's review queue.

let db: Awaited<ReturnType<typeof startTestDb>>;
let engine: typeof import('../lib/partners-engine');

const DEV = { id: 'u-dev', email: 'dev@example.test', name: 'Dev One' };
const PIN = {
  id: 'd1', number: 77, title: 'Dev Towers', developer: 'Dev Co', type: 'Residential', status: 'upcoming',
  location: 'Baner, Pune', lat: 18.56, lng: 73.78, price: '', configuration: '2 BHK', description: '',
  owner_user_id: 'u-dev', hidden: false, pending_review: false, rejected: false,
};

async function rows(table: string) {
  return (await db.pg.query(`SELECT doc FROM "${table}"`)).rows.map((r: any) => r.doc);
}

before(async () => {
  db = await startTestDb();
  for (const t of ['project_submissions', 'projects', 'submission_events', 'counters', 'pins_history', 'developers', 'builders', 'submission_links']) {
    await db.pg.exec(`CREATE TABLE IF NOT EXISTS "${t}" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  }
  await db.insert('pins', [PIN]);
  engine = await import('../lib/partners-engine');
});

test('a developer pin opens as an editable draft on the developer\'s own link, once', async () => {
  const first = await engine.openForDeveloperPin(DEV, PIN, 'Dev Co');
  assert.equal(first.created, true);
  const again = await engine.openForDeveloperPin(DEV, PIN, 'Dev Co');
  assert.deepEqual(again, { ...first, created: false }, 'same link and submission on a second click');
  assert.equal((await rows('builders')).filter((b) => b.owner_user_id === DEV.id).length, 1);

  const opened = await engine.runPartnersRpc('link_open', { p_token: first.token }, { authed: false });
  const sub = (opened.data as any).submissions.find((s: any) => s.id === first.submission_id);
  assert.equal(sub.status, 'draft');
  assert.equal(sub.source_pin_id, 'd1');
  assert.equal(sub.project_name, 'Dev Towers');

  const saved = await engine.runPartnersRpc('link_save_submission', { p_token: first.token, p_id: sub.id, p_data: { price_min: 1.2, price_unit: 'Crore' }, p_submit: true }, { authed: false });
  assert.equal(saved.error, null);
  assert.equal((saved.data as any).status, 'submitted', 'goes to the review queue, not live');
  const [pin] = (await rows('pins')).filter((p) => p.id === 'd1');
  assert.deepEqual(pin, PIN, 'the pin itself is unchanged until the super admin publishes');
});

test('a pin already handled through another builder is refused', async () => {
  const other = { ...PIN, id: 'd2', number: 78 };
  await db.insert('pins', [other]);
  await db.pg.query(`INSERT INTO "project_submissions" (id, doc) VALUES ('s-x', $1)`, [{ id: 's-x', source_pin_id: 'd2', builder_id: 'someone-else', status: 'draft' }]);
  await assert.rejects(engine.openForDeveloperPin(DEV, other, 'Dev Co'), /managed by the Mappingg team/);
});
