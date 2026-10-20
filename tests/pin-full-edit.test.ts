import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/api-db';

// "Edit all details" for any map pin: opening the full intake form for a pin, then
// publishing it, must update that same pin (number, page, extras intact) and never
// blank a value the form could not hold. Runs on the in-process test database only.

let db: Awaited<ReturnType<typeof startTestDb>>;
let rpc: typeof import('../lib/partners-engine').runPartnersRpc;
const ctx = { authed: true, userEmail: 'qa@example.test' };

const MANUAL_PIN = {
  id: 'm1', number: 50, title: 'Fixture Heights', developer: 'Fixture Developers', type: 'Residential', status: 'construction',
  location: 'Kharadi, Pune', lat: 18.551, lng: 73.941, price: '₹ 98 Lacs - ₹ 1.35 Cr', configuration: '2, 3 BHK & Shops',
  sqft: '', possession_timeline: 'Dec 2028', launch_date: 'Ready', rera_number: 'P52100099999', key_usp: 'Near fixture park',
  description: 'A test project.', image: 'data:image/png;base64,AAAA', highlighted: true, size: 'large',
  field_visibility: { price: true, status: false }, custom_fields: [{ id: 'c1', label: 'Note', value: 'keep me', visible: true }],
  hidden: false, pending_review: false, rejected: false, updated_at: '2026-10-01T00:00:00Z',
};

async function rows(table: string) {
  return (await db.pg.query(`SELECT doc FROM "${table}"`)).rows.map((r: any) => r.doc);
}

before(async () => {
  db = await startTestDb();
  for (const t of ['project_submissions', 'projects', 'submission_events', 'counters', 'pins_history', 'developers', 'builders', 'submission_links']) {
    await db.pg.exec(`CREATE TABLE IF NOT EXISTS "${t}" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  }
  await db.insert('pins', [MANUAL_PIN]);
  rpc = (await import('../lib/partners-engine')).runPartnersRpc;
});

test('opening the full form for a manual pin creates one linked submission and leaves the pin untouched', async () => {
  const first = await rpc('admin_open_for_pin', { p_pin_id: 'm1' }, ctx);
  assert.equal(first.error, null);
  const { submission_id, created } = first.data as any;
  assert.equal(created, true);

  const again = await rpc('admin_open_for_pin', { p_pin_id: 'm1' }, ctx);
  assert.deepEqual(again.data, { submission_id, created: false }, 'second click reopens the same submission');

  const [sub] = (await rows('project_submissions')).filter((s) => s.id === submission_id);
  assert.equal(sub.status, 'in_review');
  assert.equal(sub.source_pin_id, 'm1');
  assert.equal(sub.project_name, 'Fixture Heights');
  assert.equal(sub.construction_status, 'Under Construction');
  assert.deepEqual(sub.configurations, ['2 BHK', '3 BHK', 'Shop']);
  assert.equal(sub.possession_date_target, '2028-12');
  assert.deepEqual(sub.rera_numbers, ['P52100099999']);
  assert.ok(sub.additional_details.some((d: any) => /Price/.test(d.label) && d.value === '₹ 98 Lacs - ₹ 1.35 Cr'), 'unparsed price listed for reference');

  const [pin] = (await rows('pins')).filter((p) => p.id === 'm1');
  assert.deepEqual(pin, MANUAL_PIN, 'opening the form does not change the pin');
  assert.equal((await rpc('admin_open_for_pin', { p_pin_id: 'nope' }, ctx)).status, 404);
});

test('publishing it updates the same pin, keeps what the form left empty, and later opens the same submission', async () => {
  const { submission_id } = (await rpc('admin_open_for_pin', { p_pin_id: 'm1' }, ctx)).data as any;
  // Simulate the admin editing in the form: new name and USPs; price left empty.
  await db.pg.query(
    `UPDATE project_submissions SET doc = doc || $2::jsonb WHERE id = $1`,
    [submission_id, JSON.stringify({ project_name: 'Fixture Heights Phase 2', key_usps: 'Near fixture park\nMetro 500 m' })],
  );
  const pinsBefore = (await rows('pins')).length;
  const pub = await rpc('admin_publish', { p_id: submission_id }, ctx);
  assert.equal(pub.error, null, JSON.stringify(pub.error));
  assert.equal((pub.data as any).pin_number, 50);
  assert.equal((await rows('pins')).length, pinsBefore, 'no new pin was created');

  const [pin] = (await rows('pins')).filter((p) => p.id === 'm1');
  assert.equal(pin.number, 50, 'same pin number → same page URL');
  assert.equal(pin.title, 'Fixture Heights Phase 2');
  assert.equal(pin.key_usp, 'Near fixture park\nMetro 500 m');
  assert.equal(pin.price, '₹ 98 Lacs - ₹ 1.35 Cr', 'price the form could not hold is kept');
  assert.equal(pin.launch_date, 'Ready', 'launch text the form could not hold is kept');
  assert.equal(pin.image, 'data:image/png;base64,AAAA', 'own photo kept when no cover was uploaded');
  assert.equal(pin.configuration, '2 BHK / 3 BHK / Shop');
  assert.equal(pin.possession_timeline, 'Dec 2028');
  assert.deepEqual(pin.custom_fields, MANUAL_PIN.custom_fields, 'map-editor extras kept');
  assert.deepEqual(pin.field_visibility, MANUAL_PIN.field_visibility);
  assert.equal(pin.size, 'large');
  assert.ok(pin.intake_project_id, 'now linked to its intake project');

  const reopen = await rpc('admin_open_for_pin', { p_pin_id: 'm1' }, ctx);
  assert.deepEqual(reopen.data, { submission_id, created: false });
});
