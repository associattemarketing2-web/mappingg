// Pure rules for applying project-enrichment proposals (see migration/enrichment/apply.mts). No I/O.

export type Item = { field: string; existing?: unknown; proposed: unknown; status: string; action: string; confidence?: string; source_url?: string };
export type Project = { number: number; title: string; fields: Item[] };
export type Pin = Record<string, any>;

const ALLOW: Record<string, number> = { rera_number: 80, possession_timeline: 120, configuration: 160, sqft: 120, price: 120 };
const MAHARERA = /^(P\d{11}|P[RCM]\d{13})$/;
const empty = (v: unknown) => v == null || String(v).trim() === '';
const customRera = (p: Pin) => (Array.isArray(p.custom_fields) ? p.custom_fields.find((c: any) => /rera/i.test(c?.label || ''))?.value : undefined);

export interface Change { number: number; pinId: string; field: string; before: unknown; after: unknown; source?: string }
export interface Rejection { number: number; field: string; reason: string }

export function plan(projects: Project[], pins: Pin[]) {
  const changes: Change[] = [];
  const rejected: Rejection[] = [];
  const byNumber = new Map<number, Pin[]>();
  for (const p of pins) byNumber.set(Number(p.number), [...(byNumber.get(Number(p.number)) || []), p]);

  for (const proj of projects) {
    const matches = byNumber.get(proj.number) || [];
    if (matches.length !== 1) { rejected.push({ number: proj.number, field: '*', reason: matches.length ? 'pin number is not unique' : 'pin not found' }); continue; }
    const pin = matches[0];
    if (String(pin.title || '').trim() !== proj.title) { rejected.push({ number: proj.number, field: '*', reason: `title changed since research ("${pin.title}")` }); continue; }
    if (pin.hidden === true || pin.pending_review === true || pin.rejected === true) { rejected.push({ number: proj.number, field: '*', reason: 'pin is not live' }); continue; }

    for (const it of proj.fields) {
      if (it.status !== 'verified' || it.action !== 'set') continue;
      const reject = (reason: string) => rejected.push({ number: proj.number, field: it.field, reason });
      if (it.confidence !== 'high' || !it.source_url) { reject('verified items need high confidence and a source URL'); continue; }

      if (it.field === 'custom_fields+') {
        const add = it.proposed as { label?: string; value?: string };
        if (!add?.label || !add?.value || add.label.length > 120 || add.value.length > 1000) { reject('bad custom field'); continue; }
        const list = Array.isArray(pin.custom_fields) ? pin.custom_fields : [];
        if (list.some((c: any) => String(c?.label || '').toLowerCase() === add.label!.toLowerCase())) { reject('custom field with this label already exists'); continue; }
        changes.push({ number: proj.number, pinId: pin.id, field: 'custom_fields', before: list, after: [...list, { id: `enrich-${Date.now()}-${list.length}`, label: add.label, value: add.value, visible: true }], source: it.source_url });
        continue;
      }

      const max = ALLOW[it.field];
      if (!max) { reject('field is not on the allow-list'); continue; }
      const value = String(it.proposed ?? '').trim();
      if (!value || value.length > max) { reject(`empty or longer than ${max} characters`); continue; }
      if (it.field === 'rera_number' && !MAHARERA.test(value)) { reject('not a MahaRERA project number'); continue; }
      const before = pin[it.field];
      const sameAsCustom = it.field === 'rera_number' && String(customRera(pin) || '').trim() === value;
      if (!empty(before) && !sameAsCustom) { reject(`existing value kept ("${before}")`); continue; }
      if (it.field === 'rera_number' && pins.some((o) => o.id !== pin.id && String(o.rera_number || '').trim() === value)) { reject('this RERA number is already on another pin'); continue; }
      changes.push({ number: proj.number, pinId: pin.id, field: it.field, before: before ?? '', after: value, source: it.source_url });
    }
  }
  return { changes, rejected };
}
