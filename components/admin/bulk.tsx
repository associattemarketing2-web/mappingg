'use client';

import { useState, type ReactNode } from 'react';

// Shared "tick rows → act on all of them" pieces for the super-admin lists:
// a selection hook, a select-all checkbox and the bar that holds bulk actions.

export function useSelection() {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  return {
    picked,
    has: (id: string) => picked.has(id),
    toggle: (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    /** Tick / untick every id given (the rows currently shown). */
    setMany: (ids: string[], on: boolean) => setPicked((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; }),
    clear: () => setPicked(new Set()),
    /** Ticked ids that still exist in `ids` (rows can disappear after a reload). */
    of: (ids: string[]) => ids.filter((id) => picked.has(id)),
  };
}
export type Selection = ReturnType<typeof useSelection>;

/** Checkbox that ticks every row shown; shows "partly ticked" when some are. */
export function PickAll({ sel, ids, label = 'Select all shown' }: { sel: Selection; ids: string[]; label?: string }) {
  const n = sel.of(ids).length;
  return (
    <input
      type="checkbox" className="adm-pick" aria-label={label} title={label}
      checked={ids.length > 0 && n === ids.length}
      ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }}
      onChange={(e) => sel.setMany(ids, e.target.checked)}
      disabled={!ids.length}
    />
  );
}

export function PickOne({ sel, id, label }: { sel: Selection; id: string; label: string }) {
  return (
    <input type="checkbox" className="adm-pick" aria-label={`Select ${label}`} checked={sel.has(id)}
      onChange={() => sel.toggle(id)} onClick={(e) => e.stopPropagation()} />
  );
}

/** Select-all + count + actions. Shows a hint until something is ticked. */
export function BulkBar({ sel, ids, hint, children }: { sel: Selection; ids: string[]; hint: string; children: ReactNode }) {
  const n = sel.of(ids).length;
  return (
    <div className={`adm-bulk${n ? ' on' : ''}`}>
      <PickAll sel={sel} ids={ids} />
      {n ? (
        <>
          <b>{n} selected</b>
          {children}
          <button type="button" className="adm-btn ghost sm" onClick={sel.clear}>Clear</button>
        </>
      ) : (
        <span className="muted">{hint}</span>
      )}
    </div>
  );
}
