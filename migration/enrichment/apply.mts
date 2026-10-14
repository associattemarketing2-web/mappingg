// Applies APPROVED project-enrichment proposals — field by field, never whole objects.
//
//   Dry run against the local snapshot (default, writes nothing):
//     node --experimental-transform-types --import ./tests/register.mjs migration/enrichment/apply.mts seo-doc/enrichment/pilot-2026-10-14.json
//   Production (only after the proposals file has been reviewed and approved):
//     node --env-file=.env --experimental-transform-types --import ./tests/register.mjs migration/enrichment/apply.mts <file> --apply --approved-by "<name>"
//
// Rules (also checked by validate()):
//   - Only items with status "verified" AND action "set" are applied.
//   - Only allow-listed fields. title/developer/location/coordinates/status/visibility are never touched.
//   - A non-empty existing value is never overwritten (except rera_number when the same verified
//     number was only stored in a custom field).
//   - Values must pass the admin editor's own limits (app/api/admin/submissions/route.ts).
//   - Writes go through runDbOp, which saves the previous version to pins_history (restorable from
//     Super admin → Backups) and refreshes the public cache.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { plan, type Change, type Project, type Pin } from '../../lib/enrichment/plan';

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) throw new Error('usage: apply.mts <proposals.json> [--apply --approved-by "<name>"]');
  const apply = flags.includes('--apply');
  const approvedBy = flags[flags.indexOf('--approved-by') + 1];
  const { projects, checked_on } = JSON.parse(readFileSync(file, 'utf8')) as { projects: Project[]; checked_on: string };

  let pins: Pin[];
  if (apply) {
    if (!approvedBy || approvedBy.startsWith('--')) throw new Error('--apply needs --approved-by "<name>"');
    const { getDb } = await import('../../lib/mongodb');
    pins = await (await getDb()).collection('pins').find({}).toArray();
  } else {
    pins = JSON.parse(readFileSync(path.resolve(`migration/backup/pg-snapshot-${checked_on}-enrichment/pins.json`), 'utf8'));
  }

  const { changes, rejected } = plan(projects, pins);
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${changes.length} field change(s), ${rejected.length} rejected`);
  for (const c of changes) console.log(`  #${c.number} ${c.field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
  for (const r of rejected) console.log(`  skip #${r.number} ${r.field}: ${r.reason}`);

  if (apply && changes.length) {
    const { runDbOp } = await import('../../lib/db-engine');
    const log: unknown[] = [];
    // One update per pin, containing only the allow-listed fields for that pin.
    const byPin = new Map<string, Change[]>();
    for (const c of changes) byPin.set(c.pinId, [...(byPin.get(c.pinId) || []), c]);
    for (const [pinId, cs] of byPin) {
      const values: Record<string, unknown> = { enriched_at: new Date().toISOString(), enriched_by: approvedBy };
      for (const c of cs) values[c.field] = c.after;
      const res = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: pinId }], values }, true);
      log.push({ pinId, number: cs[0].number, ok: !res.error, error: res.error?.message, changes: cs });
      console.log(`  ${res.error ? 'FAILED' : 'updated'} #${cs[0].number}${res.error ? `: ${res.error.message}` : ''}`);
    }
    const dir = path.resolve('seo-doc/enrichment');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `applied-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ file, approvedBy, log }, null, 2));
  }
}

if (process.argv[1] && /apply\.mts$/.test(process.argv[1])) main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
