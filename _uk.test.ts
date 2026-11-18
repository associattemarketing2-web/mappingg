import { readFileSync } from 'node:fs';
import { unitKinds } from './lib/home/finder';

const vals = new Set<string>();
const walk = (o: unknown): void => {
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (/^configuration$/i.test(k) && typeof v === 'string') vals.add(v);
      else walk(v);
    }
  }
};
walk(JSON.parse(readFileSync('seo-doc/enrichment/live-project-enrichment/live-baseline.json', 'utf8')));
const counts = new Map<string, number>();
const ex = new Map<string, string>();
for (const v of vals) for (const k of unitKinds(v)) {
  counts.set(k.label, (counts.get(k.label) || 0) + 1);
  if (!ex.has(k.label)) ex.set(k.label, v);
}
console.log('configs:', vals.size);
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(n, '|', k, '|', ex.get(k));
