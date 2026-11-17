'use client';

import { useCallback, useEffect, useState } from 'react';

// Super admin → Accounts → a developer → "Projects access".
// Give a developer access to existing map projects (e.g. every Gera project for a
// Gera employee) or take it away. Assigned projects appear in their dashboard,
// Map Editor and Projects intake next to the ones they added themselves; the
// projects themselves don't change (live stays live). API: /api/admin/dev-assign.

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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (text = '') => {
    const r = await fetch(`/api/admin/dev-assign?dev=${encodeURIComponent(devId)}${text ? `&q=${encodeURIComponent(text)}` : ''}`, { credentials: 'same-origin', cache: 'no-store' });
    const b = await r.json().catch(() => null);
    if (!r.ok) { flash(b?.error?.message || 'Could not load projects', true); return; }
    setMine(b.data.projects);
    if (text) setResults(b.data.results);
  }, [devId, flash]);
  useEffect(() => { setMine(null); setResults(null); setQ(''); setPicked(new Set()); load(); }, [load]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 2) { flash('Type at least 2 letters, e.g. a developer name like “Gera”', true); return; }
    setResults(null); setPicked(new Set());
    await load(q.trim());
  }

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
      await load(results ? q.trim() : '');
      onChanged?.();
    } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); }
  }

  const selectable = (results || []).filter((p) => p.owner?.id !== devId);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const label = (p: Proj) => `${p.number != null ? `#${p.number} · ` : ''}${p.title || 'Untitled project'}`;
  const pill = (s: Proj['state']) => <span className={`dp-state s-${s === 'live' ? 'approved' : s}`}>{STATE[s]}</span>;

  const given = (mine || []).filter((p) => p.assigned);
  const own = (mine || []).filter((p) => !p.assigned);
  const item = (p: Proj, removable: boolean) => (
    <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <span style={{ flex: 1, minWidth: 0 }}>{label(p)}<small style={{ display: 'block' }}>{p.developer || '—'} · {p.location || '—'}</small></span>
      {pill(p.state)}
      {removable && <button type="button" className="adm-btn ghost sm" disabled={busy} title="Remove access" aria-label={`Remove access to ${p.title}`} onClick={() => act('unassign', [p.id])}><i className="fas fa-xmark" /> Remove</button>}
    </li>
  );

  return (
    <div className="acs-d-projects">
      <p className="crm-meta" style={{ marginTop: 0 }}>Projects {devName} can see and edit in their dashboard. Their edits still need your approval.</p>

      <div className="acs-d-projects-head"><h4><i className="fas fa-key" /> Assigned by admin {mine ? `(${given.length})` : ''}</h4></div>
      {mine === null ? <p className="crm-meta"><i className="fas fa-spinner fa-spin" /> Loading…</p>
        : given.length === 0 ? <p className="crm-meta">No projects assigned yet — find them below and click Give access.</p>
          : <ul>{given.map((p) => item(p, true))}</ul>}

      {!!own.length && (
        <>
          <div className="acs-d-projects-head" style={{ marginTop: 12 }}><h4><i className="fas fa-map-pin" /> Added by them ({own.length})</h4></div>
          <ul>{own.map((p) => item(p, false))}</ul>
        </>
      )}

      <div className="acs-d-projects-head" style={{ marginTop: 16 }}><h4><i className="fas fa-plus" /> Assign more projects</h4></div>
      <form onSubmit={search} style={{ display: 'flex', gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find projects: developer, project name, area or pin #" style={{ flex: 1, minWidth: 0 }} aria-label="Find projects to give access to" />
        <button className="adm-btn sm" type="submit" disabled={busy}><i className="fas fa-magnifying-glass" /> Find</button>
      </form>

      {results && (
        <div style={{ marginTop: 10 }}>
          {results.length === 0 ? <p className="crm-meta">No map projects match “{q}”.</p> : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                <span className="crm-meta">{results.length} found{results.length >= 300 ? ' (first 300)' : ''}</span>
                {!!selectable.length && (
                  <button type="button" className="link-btn" onClick={() => setPicked(picked.size === selectable.length ? new Set() : new Set(selectable.map((p) => p.id)))}>
                    {picked.size === selectable.length ? 'Clear' : 'Select all'}
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" className="adm-btn primary sm" disabled={busy || !picked.size} onClick={() => act('assign', [...picked])}><i className="fas fa-plus" /> Give access ({picked.size})</button>
              </div>
              <ul style={{ maxHeight: 320, overflowY: 'auto' }}>
                {results.map((p) => {
                  const has = p.owner?.id === devId;
                  return (
                    <li key={p.id}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: has ? 'default' : 'pointer', padding: '4px 0' }}>
                        <input type="checkbox" disabled={has || busy} checked={has || picked.has(p.id)} onChange={() => toggle(p.id)} />
                        <span style={{ flex: 1, minWidth: 0 }}>{label(p)}<small style={{ display: 'block' }}>{p.developer || '—'} · {p.location || '—'}{has ? ' · already has access' : p.owner ? ` · now with ${p.owner.name || p.owner.email}` : ''}</small></span>
                        {pill(p.state)}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
