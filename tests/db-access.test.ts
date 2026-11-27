import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDbOp } from '../lib/db-engine';

// /api/db is a generic table API. Whatever the caller, only the map tables (and,
// for staff, enquiries + pin history) may be read through it; every refusal
// happens before the database is touched.

test('staff cannot read private tables (users, payments…) through the generic table API', async () => {
  for (const table of ['users', 'subscriptions', 'payments', 'staff_sessions', 'wa_messages', 'hr_employees']) {
    const r = await runDbOp({ table, action: 'select' }, true);
    assert.equal(r.status, 403, table);
    assert.equal(r.data, null);
  }
});

test('visitors cannot read enquiries or pin history, nor any private table', async () => {
  for (const table of ['leads', 'pins_history', 'users']) {
    const r = await runDbOp({ table, action: 'select' }, false);
    assert.equal(r.status, 401, table);
  }
});

test('nobody writes to a table outside the map tables through the generic API', async () => {
  for (const isAuthed of [true, false]) {
    const r = await runDbOp({ table: 'users', action: 'update', filters: [{ op: 'eq', col: 'id', val: 'x' }], values: { role: 'admin' } }, isAuthed);
    assert.equal(r.status, 403);
  }
});
