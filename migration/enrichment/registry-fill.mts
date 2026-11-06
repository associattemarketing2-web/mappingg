// READ-ONLY: proposes values for EMPTY pin fields (configuration, sqft, possession_timeline)
// from the official RERA registry rows in scraped_projects, matched to the pin by RERA number.
//
//   node --env-file=.env --experimental-transform-types --import ./tests/register.mjs migration/enrichment/registry-fill.mts
//
// Writes nothing to the database. Output: seo-doc/enrichment/live-project-enrichment/changes-round11-registry.json
// (apply with apply-live.mts after review). Only values the registry states are used:
//   configuration - registry configurations that match the project form options exactly
//   sqft          - min–max carpet area from the registry unit mix (sq ft, carpet)
//   possession    - revised completion if the registry shows one, else the original completion

import { writeFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { query } from '../../lib/pg';
import { getDb } from '../../lib/mongodb';
import { enrichmentForProject } from '../../lib/scraped';

type Doc = Record<string, any>;
const OUT = 'seo-doc/enrichment/live-project-enrichment/changes-round11-registry.json';
const filled = (v: unknown) => v != null && String(v).trim() !== '' && !/^(n\/?a|na|-|—|tbd|null|undefined)$/i.test(String(v).trim());
const norm = (r: unknown) => String(r || '').toUpperCase().replace(/\s+/g, '');
const reraList = (v: unknown) => String(v || '').split(/[\s,;|]+/).map(norm).filter((x) => x.length > 6);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (d: unknown) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-\d{2}/) || String(d || '').match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!m) return '';
  const [y, mo] = m[0].includes('-') && m[1].length === 4 ? [m[1], m[2]] : [m[3], m[2]];
  return MONTHS[Number(mo) - 1] ? `${MONTHS[Number(mo) - 1]} ${y}` : '';
};

const pins = (await (await getDb()).collection('pins').find({}).toArray()) as Doc[];
const res = await query<{ id: string; doc: Doc }>(`SELECT id, doc FROM scraped_projects WHERE NOT coalesce((doc->>'deleted')::boolean, false)`);
// The registry dataset (completion dates) is also on disk; table rows carry enrichment (unit mix, configurations).
const ds = JSON.parse(gunzipSync(readFileSync('data/scraped/scraped_projects.json.gz')).toString('utf8')) as { records: Doc[] };

const byRera = new Map<string, { orig: Doc; enr?: Doc }>();
for (const r of ds.records) if (r.rera_number) byRera.set(norm(r.rera_number), { orig: r });
for (const { doc } of res.rows) {
  const orig = doc.original || doc.data || {};
  const k = norm(orig.rera_number);
  if (!k) continue;
  byRera.set(k, { orig: { ...(byRera.get(k)?.orig || {}), ...orig }, enr: doc.enrichment });
}

const changes: Doc[] = [];
const counts: Record<string, number> = {};
for (const p of pins) {
  if (p.hidden === true || p.pending_review === true || p.rejected === true) continue;
  const hits = reraList(p.rera_number).map((r) => byRera.get(r)).filter(Boolean) as { orig: Doc; enr?: Doc }[];
  if (hits.length !== 1) continue; // none, or several phases: a single pin value would be a guess
  const { orig, enr } = hits[0];
  const ops: Doc[] = [];
  const notes: string[] = [];

  if (!filled(p.configuration) && enr) {
    const c = enrichmentForProject(enr).patch.configurations as string[] | undefined;
    const order = ['Studio', '1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '5+ BHK'];
    const rank = (s: string) => (order.includes(s) ? order.indexOf(s) : order.length);
    if (c?.length) { ops.push({ op: 'set', field: 'configuration', value: [...c].sort((a, b) => rank(a) - rank(b)).join(' / '), expect: String(p.configuration ?? '') }); notes.push(`configurations: ${enr.fields?.configurations}`); }
  }
  if (!filled(p.sqft) && enr && Array.isArray(enr.fields?.unit_mix)) {
    const sq = enr.fields.unit_mix.map((u: Doc) => Number(u.avg_carpet_sqft ?? u.carpet_sqft_per_unit)).filter((n: number) => Number.isFinite(n) && n > 50);
    if (sq.length) {
      const lo = Math.round(Math.min(...sq)), hi = Math.round(Math.max(...sq));
      const v = lo === hi ? `${lo.toLocaleString('en-IN')} sq ft (carpet)` : `${lo.toLocaleString('en-IN')} – ${hi.toLocaleString('en-IN')} sq ft (carpet)`;
      ops.push({ op: 'set', field: 'sqft', value: v, expect: String(p.sqft ?? '') }); notes.push('carpet from registry unit mix (averages per unit type)');
    }
  }
  if (!filled(p.possession_timeline)) {
    // Registry list dates first; else the completion read from the registration certificate / registry page.
    const fromCert = enr?.fields?.rera_completion || (enr?.source_type !== 'developer_official_site' ? enr?.fields?.proposed_completion : '');
    const raw = orig.revised_completion || orig.original_completion || fromCert;
    const d = monYear(raw);
    if (d) { ops.push({ op: 'set', field: 'possession_timeline', value: d, expect: String(p.possession_timeline ?? '') }); notes.push(`RERA completion ${raw}`); }
  }
  if (!ops.length) continue;
  for (const o of ops) counts[o.field] = (counts[o.field] || 0) + 1;
  changes.push({
    pin_id: p.id, number: Number(p.number), title: String(p.title || '').trim(),
    source_url: orig.project_url || orig.source_url || '', source_type: `Official RERA registry (${orig.regulator || 'RERA'}) - RERA no. ${orig.rera_number}`,
    confidence: 'high', note: notes.join('; '), ops,
  });
}

writeFileSync(OUT, JSON.stringify({
  batch_id: 'live-2026-11-06-r11-registry', checked_on: new Date().toISOString().slice(0, 10),
  rules: 'Empty fields only. Values stated by the official RERA registry row whose RERA number matches the pin (one match only).',
  changes,
}, null, 1));
console.log(`${changes.length} pins, field fills:`, counts, `→ ${OUT}`);
process.exit(0);
