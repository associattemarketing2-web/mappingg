// Applies a reviewed change set to EXISTING live pins, field by field, and logs every change.
//
//   Dry run:  node --env-file=.env --experimental-transform-types --import ./tests/register.mjs migration/enrichment/apply-live.mts <changes.json>
//   Apply:    ... apply-live.mts <changes.json> --apply
//
// Safety:
//   - Only existing, live pins (matched by database id; pin number + title must still match).
//   - Each change states the value it expects to find; if the pin changed since, that change is skipped.
//   - Never touches title, location, coordinates, number, status, visibility or ownership.
//   - Writes through runDbOp (lib/db-engine): the previous version goes to pins_history (restorable
//     in Super admin → Backups) and the public cache is refreshed.
//   - Before --apply, every live pin is snapshotted to migration/backup/pg-snapshot-<time>-before-apply/.
//   - After each write the pin is re-read; a change is logged "applied" only if the saved value matches.
//   - The scraped registry table is never read or written here.
// Log: seo-doc/enrichment/live-project-enrichment/PROJECT-CHANGE-LOG.csv (appended).

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../../lib/mongodb';
import { runDbOp } from '../../lib/db-engine';

type Op =
  | { op: 'set'; field: string; value: string; expect: string }
  | { op: 'custom_add'; label: string; value: string }
  | { op: 'custom_update'; id: string; expectValue: string; value?: string; visible?: boolean };
interface Change { pin_id: string; number: number; title: string; source_url: string; source_type: string; confidence: string; note?: string; ops: Op[] }

const SETTABLE = new Set(['rera_number', 'description', 'configuration', 'sqft', 'price', 'possession_timeline', 'key_usp', 'brochure_url', 'type', 'developer']);
const LOG = path.resolve('seo-doc/enrichment/live-project-enrichment/PROJECT-CHANGE-LOG.csv');
const COLS = ['timestamp', 'project_id', 'pin_number', 'project_name', 'field', 'previous_value', 'new_value', 'source_url', 'source_type', 'date_checked', 'confidence', 'verification_status', 'applied', 'batch_id', 'note'];
const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const s = (v: unknown) => (v == null ? '' : String(v));
const on = (v: unknown) => v === true || v === 'true';

const [file, flag] = process.argv.slice(2);
const apply = flag === '--apply';
const { batch_id, checked_on, changes } = JSON.parse(readFileSync(file, 'utf8')) as { batch_id: string; checked_on: string; changes: Change[] };
const db = await getDb();
const pins = db.collection('pins');

if (apply) {
  const all = await pins.find({}, { projection: { image: 0, brochure_image: 0 } }).toArray();
  const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-apply`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'pins.json'), JSON.stringify(all));
  console.log(`Backup: ${all.length} pins → ${path.relative(process.cwd(), dir)}/pins.json`);
}
if (!existsSync(LOG)) { mkdirSync(path.dirname(LOG), { recursive: true }); writeFileSync(LOG, COLS.join(',') + '\n'); }

let applied = 0, skipped = 0, failed = 0;
for (const c of changes) {
  const pin = await pins.findOne({ id: c.pin_id });
  const rows: Record<string, unknown>[] = [];
  const base = { project_id: c.pin_id, pin_number: c.number, project_name: c.title, source_url: c.source_url, source_type: c.source_type, date_checked: checked_on, confidence: c.confidence, batch_id, note: c.note || '' };
  const reject = (why: string) => { console.log(`  skip #${c.number} ${c.title}: ${why}`); skipped += c.ops.length; for (const o of c.ops) rows.push({ ...base, field: o.op === 'set' ? o.field : 'custom_fields', new_value: 'value' in o ? o.value : '', verification_status: `skipped: ${why}`, applied: 'no' }); };

  if (!pin) reject('pin not found');
  else if (on(pin.hidden) || on(pin.pending_review) || on(pin.rejected)) reject('pin is not live');
  else if (Number(pin.number) !== c.number || s(pin.title).trim() !== c.title) reject('pin number or title changed since the check');
  else {
    const values: Record<string, unknown> = {};
    const planned: { field: string; prev: string; next: string; check: (p: Record<string, unknown>) => boolean }[] = [];
    let custom = Array.isArray(pin.custom_fields) ? pin.custom_fields.map((x: Record<string, unknown>) => ({ ...x })) : [];
    let customTouched = false;
    for (const o of c.ops) {
      if (o.op === 'set') {
        if (!SETTABLE.has(o.field)) { reject(`field ${o.field} is not allowed`); continue; }
        if (s(pin[o.field]).trim() !== o.expect.trim()) { console.log(`  skip #${c.number} ${o.field}: now "${s(pin[o.field])}", expected "${o.expect}"`); skipped++; rows.push({ ...base, field: o.field, previous_value: s(pin[o.field]), new_value: o.value, verification_status: 'skipped: value changed since the check', applied: 'no' }); continue; }
        values[o.field] = o.value;
        planned.push({ field: o.field, prev: s(pin[o.field]), next: o.value, check: (p) => s(p[o.field]) === o.value });
      } else if (o.op === 'custom_add') {
        if (custom.some((x: Record<string, unknown>) => s(x.label).toLowerCase() === o.label.toLowerCase())) { skipped++; rows.push({ ...base, field: `custom: ${o.label}`, new_value: o.value, verification_status: 'skipped: a custom field with this label exists', applied: 'no' }); continue; }
        const id = `enrich-${o.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        custom = [...custom, { id, label: o.label, value: o.value, visible: true }];
        customTouched = true;
        planned.push({ field: `custom: ${o.label}`, prev: '', next: o.value, check: (p) => Array.isArray(p.custom_fields) && p.custom_fields.some((x: Record<string, unknown>) => x.id === id && x.value === o.value) });
      } else {
        const cur = custom.find((x: Record<string, unknown>) => x.id === o.id);
        if (!cur || s(cur.value) !== o.expectValue) { skipped++; rows.push({ ...base, field: `custom: ${o.id}`, verification_status: 'skipped: custom field changed since the check', applied: 'no' }); continue; }
        const before = `${s(cur.label)}=${s(cur.value)} (visible ${cur.visible !== false})`;
        if (o.value != null) cur.value = o.value;
        if (o.visible != null) cur.visible = o.visible;
        customTouched = true;
        const after = `${s(cur.label)}=${s(cur.value)} (visible ${cur.visible !== false})`;
        planned.push({ field: `custom: ${s(cur.label)}`, prev: before, next: after, check: (p) => Array.isArray(p.custom_fields) && p.custom_fields.some((x: Record<string, unknown>) => x.id === o.id && s(x.value) === s(cur.value) && (x.visible !== false) === (cur.visible !== false)) });
      }
    }
    if (customTouched) values.custom_fields = custom;
    if (planned.length) {
      if (!apply) {
        for (const pl of planned) { console.log(`  [dry] #${c.number} ${c.title}: ${pl.field}: "${pl.prev}" → "${pl.next}"`); rows.push({ ...base, field: pl.field, previous_value: pl.prev, new_value: pl.next, verification_status: 'verified (dry run)', applied: 'no (dry run)' }); }
      } else {
        const res = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: c.pin_id }], values: { ...values, enriched_at: new Date().toISOString(), enriched_batch: batch_id } }, true);
        const after = await pins.findOne({ id: c.pin_id });
        for (const pl of planned) {
          const ok = !res.error && !!after && pl.check(after);
          ok ? applied++ : failed++;
          console.log(`  ${ok ? 'saved' : 'FAILED'} #${c.number} ${c.title}: ${pl.field}${ok ? '' : ` (${res.error?.message || 'value not found after write'})`}`);
          rows.push({ ...base, field: pl.field, previous_value: pl.prev, new_value: pl.next, verification_status: ok ? 'verified' : 'write failed', applied: ok ? 'yes' : 'no' });
        }
      }
    }
  }
  const ts = new Date().toISOString();
  if (apply) appendFileSync(LOG, rows.map((r) => COLS.map((k) => cell(k === 'timestamp' ? ts : r[k])).join(',')).join('\n') + (rows.length ? '\n' : ''));
}
console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${applied} saved, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
