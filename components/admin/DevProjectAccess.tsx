'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Super admin → Accounts → a developer → "Assigned projects" tab.
// Give a developer access to existing map projects (e.g. every Gera project for a
// Gera employee) or take it away. Assigned projects appear in their dashboard,
// Map Editor and Projects intake next to the ones they added themselves; the
// projects themselves don't change (live stays live). API: /api/admin/dev-assign.
// Search runs as you type: project name, pin number, developer or area.

type Proj = {
  id: string; number: number | string | null; title: string; developer: string; location: string;
  state: 'live' | 'pending' | 'rejected' | 'hidden';
  owner: { id: string; name: string; email: string } | null;
  assigned: boolean;
};
const STATE: Record<Proj['state'], string> = { live: 'Live', pending: 'Waiting', rejected: 'Not approved', hidden: 'Hidden' };

export default function DevProjectAccess({ devId, devName, flash, onChanged }: {
  devId: string; devName: string; flash: (m: string, e?: boolean) => void; onChanged?: () => void;
}) {
  const [mine, setMine] = useState<Proj[] | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Proj[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const fetchData = useCallback(async (text: string) => {
    const r = await fetch(`/api/admin/dev-assign?dev=${encodeURIComponent(devId)}${text ? `&q=${encodeURIComponent(text)}` : ''}`, { credentials: 'same-origin', cache: 'no-store' });
    const b = await r.json().catch(() => null);
    if (!r.ok) throw new Error(b?.error?.message || `Could not load projects (${r.status})`);
    return b.data as { projects: Proj[]; results: Proj[] };
  }, [devId]);

  const loadMine = useCallback(async () => {
    try { setMine((await fetchData('')).projects); } catch (e) { flash((e as Error).message, true); setMine([]); }
  }, [fetchData, flash]);
  useEffect(() => { setMine(null); setResults(null); setQ(''); setPicked(new Set()); loadMine(); }, [loadMine]);

  // Live search: 300 ms after typing stops; older answers are ignored.
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2 && !/^\d+$/.test(text)) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const d = await fetchData(text);
        if (my !== seq.current) return;
        setResults(d.results); setMine(d.projects);
      } catch (e) { if (my === seq.current) flash((e as Error).message, true); }
      finally { if (my === seq.current) setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, fetchData, flash]);

  async function act(action: 'assign' | 'unassign', ids: string[]) {
    if (!ids.length) return;
    const takeOver = action === 'assign' ? (results || []).filter((p) => ids.includes(p.id) && p.owner && p.owner.id !== devId) : [];
    if (takeOver.length && !confirm(`${takeOver.length} of these already belong to another developer account (${[...new Set(takeOver.map((p) => p.owner!.name || p.owner!.email))].join(', ')}). Move them to ${devName}?`)) return;
    if (action === 'unassign' && !confirm(`Remove ${devName}’s access to ${ids.length} project${ids.length === 1 ? '' : 's'}? The project${ids.length === 1 ? '' : 's'} stay on the map.`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/dev-assign', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dev: devId, action, pin_ids: ids }) });
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(b?.error?.message || 'Could not save');
      const n = b.data.changed;
      flash(action === 'assign' ? `${devName} now has access to ${n} more project${n === 1 ? '' : 's'}` : `Access removed from ${n} project${n === 1 ? '' : 's'}`);
      setPicked(new Set());
      const d = await fetchData(results ? q.trim() : '');
      setMine(d.projects); if (results) setResults(d.results);
      onChanged?.();
    } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); }
  }

  const given = (mine || []).filter((p) => p.assigned);
  const own = (mine || []).filter((p) => !p.assigned);
  const selectable = (results || []).filter((p) => p.owner?.id !== devId);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pill = (s: Proj['state']) => <span className={`dp-state s-${s === 'live' ? 'approved' : s}`}>{STATE[s]}</span>;
  const info = (p: Proj) => (
    <span className="dpa-info">
      <b>{p.number != null && <em>#{p.number}</em>}{p.title || 'Untitled project'}</b>
      <small>{p.developer || '—'} · {p.location || '—'}</small>
    </span>
  );

  return (
    <div className="dpa">
      <p className="crm-meta" style={{ marginTop: 0 }}>Projects {devName} can see and edit in their dashboard. Their edits still need your approval.</p>

      <h4 className="dpa-h"><i className="fas fa-key" /> Assigned by admin {mine ? `(${given.length})` : ''}</h4>
      {mine === null ? <p className="crm-meta"><i className="fas fa-spinner fa-spin" /> Loading…</p>
        : given.length === 0 ? <p className="dpa-empty">No projects assigned yet — search below and click <b>Assign</b>.</p>
          : (
            <ul className="dpa-list">
              {given.map((p) => (
                <li key={p.id}>
                  {info(p)}{pill(p.state)}
                  <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => act('unassign', [p.id])}><i className="fas fa-xmark" /> Remove</button>
                </li>
              ))}
            </ul>
          )}

      {!!own.length && (
        <>
          <h4 className="dpa-h"><i className="fas fa-map-pin" /> Added by them ({own.length})</h4>
          <ul className="dpa-list">{own.map((p) => <li key={p.id}>{info(p)}{pill(p.state)}</li>)}</ul>
        </>
      )}

      <h4 className="dpa-h"><i className="fas fa-plus" /> Assign more projects</h4>
      <div className="dpa-search">
        <i className="fas fa-magnifying-glass" aria-hidden="true" />
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
          placeholder="Type a project name, pin number, developer or area…" aria-label="Search projects to assign"
        />
        {searching && <i className="fas fa-spinner fa-spin" aria-hidden="true" />}
      </div>

      {results && !searching && results.length === 0 && (
        <p className="dpa-empty">No project on the map matches “{q.trim()}”. Check the spelling, or add the project first (Map Editor / Projects intake) and then assign it here.</p>
      )}

      {results && results.length > 0 && (
        <>
          <div className="dpa-bar">
            <span className="crm-meta">{results.length} found{results.length >= 300 ? ' (first 300 — type more to narrow)' : ''}</span>
            {selectable.length > 1 && (
              <button type="button" className="link-btn" onClick={() => setPicked(picked.size === selectable.length ? new Set() : new Set(selectable.map((p) => p.id)))}>
                {picked.size === selectable.length ? 'Clear selection' : `Select all ${selectable.length}`}
              </button>
            )}
            <span style={{ flex: 1 }} />
            {picked.size > 0 && <button type="button" className="adm-btn primary sm" disabled={busy} onClick={() => act('assign', [...picked])}><i className="fas fa-plus" /> Assign selected ({picked.size})</button>}
          </div>
          <ul className="dpa-list dpa-results">
            {results.map((p) => {
              const has = p.owner?.id === devId;
              return (
                <li key={p.id} className={picked.has(p.id) ? 'on' : ''}>
                  <input type="checkbox" disabled={has || busy} checked={has || picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.title}`} />
                  {info(p)}
                  {pill(p.state)}
                  {has
                    ? <span className="dpa-has"><i className="fas fa-check" /> Assigned</span>
                    : <button type="button" className="adm-btn primary sm" disabled={busy} title={p.owner ? `Now with ${p.owner.name || p.owner.email}` : undefined} onClick={() => act('assign', [p.id])}>Assign</button>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
