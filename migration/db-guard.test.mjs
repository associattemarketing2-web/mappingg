import test from 'node:test';
import assert from 'node:assert/strict';
import { riskOf } from '../lib/db-guard.mjs';
import { compare } from './db-guard.mjs';

const blocked = [
  'DROP TABLE pins', 'drop table if exists "users"', 'DROP SCHEMA public CASCADE', 'TRUNCATE leads',
  'ALTER TABLE pins DROP COLUMN doc', 'ALTER TABLE "pins" DROP doc_lite', 'ALTER TABLE pins DROP IF EXISTS doc',
  'ALTER TABLE pins ALTER COLUMN doc TYPE text', 'ALTER TABLE pins ALTER doc SET DATA TYPE text',
  'ALTER TABLE pins RENAME TO pins_old', 'ALTER TABLE pins RENAME COLUMN doc TO d', 'ALTER TABLE pins SET SCHEMA archive',
  'DELETE FROM leads', 'DELETE FROM "leads" WHERE TRUE', 'UPDATE pins SET doc = $1',
  'SELECT 1; DROP TABLE pins;', 'DROP FUNCTION f() CASCADE', 'DROP VIEW v',
];
const allowed = [
  'SELECT * FROM pins WHERE id = $1', "SELECT 'DROP TABLE pins' AS s", '-- DROP TABLE pins\nSELECT 1',
  'CREATE TABLE IF NOT EXISTS t (id text)', 'ALTER TABLE t ADD COLUMN IF NOT EXISTS c text',
  'ALTER TABLE t DROP CONSTRAINT t_c', 'ALTER TABLE t ALTER COLUMN c DROP NOT NULL', 'ALTER TABLE t ALTER COLUMN c SET DEFAULT 0',
  'CREATE INDEX IF NOT EXISTS i ON t (c)', 'DROP INDEX IF EXISTS i', 'DELETE FROM leads WHERE id = $1',
  'DELETE FROM t WHERE id IN (SELECT id FROM t WHERE TRUE LIMIT 1)', 'UPDATE pins SET doc = $2 WHERE id = $1',
  'INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = EXCLUDED.a',
  "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN DELETE FROM x; END $$ LANGUAGE plpgsql",
  'UPDATE t SET doc = doc || $2::jsonb WHERE TRUE',
];
test('risky SQL is blocked', () => { for (const s of blocked) assert.ok(riskOf(s), s); });
test('normal SQL passes', () => { for (const s of allowed) assert.equal(riskOf(s), null, s); });

test('compare spots lost tables, columns and rows', () => {
  const base = { at: 'x', tables: { pins: { rows: 1000, columns: ['id', 'doc'] }, leads: { rows: 50, columns: ['id', 'doc'] }, logs: { rows: 3, columns: ['id'] } } };
  const now = { tables: { pins: { rows: 900, columns: ['id'] }, logs: { rows: 0, columns: ['id'] }, extra: { rows: 1, columns: ['id'] } } };
  const { alerts } = compare(base, now);
  assert.equal(alerts.length, 4, alerts.join('\n')); // leads gone, pins column, pins rows, logs empty
  assert.deepEqual(compare(base, base).alerts, []);
  assert.deepEqual(compare(base, { tables: { ...base.tables, pins: { rows: 999, columns: ['id', 'doc'] } } }).alerts, []); // one delete is normal
});
