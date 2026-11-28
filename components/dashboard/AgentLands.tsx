'use client';

import { useEffect, useState } from 'react';
import SignOutButton from './SignOutButton';
import LandForm, { LandDetails, LandStatusPill, fieldsOf, landDate, type LandFields, type LandRow } from '@/components/lands/LandForm';

// /dashboard/agent/land — a channel partner's own land listings. They only ever
// see what they added. New listings and edits wait for super-admin approval;
// approved land is shown to developers with the partner's name and number.

export default function AgentLands({ name }: { name: string }) {
  const [rows, setRows] = useState<LandRow[] | null>(null);
  const [canAdd, setCanAdd] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'edit'; land: LandRow }>({ kind: 'list' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/my/lands', { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Could not load your land');
      setRows(Array.isArray(b.data) ? b.data : []); setCanAdd(!!b.can_add); setReason(b.reason || '');
    } catch (e) { setRows([]); setMsg({ text: e instanceof Error ? e.message : 'Could not load your land', err: true }); }
  }
  useEffect(() => { load(); }, []);

  async function save(f: LandFields) {
    setSaving(true); setMsg(null);
    const editing = mode.kind === 'edit' ? mode.land : null;
    try {
      const r = await fetch('/api/my/lands', {
        method: editing ? 'PUT' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...f } : f),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Save failed');
      setMode({ kind: 'list' });
      setMsg({ text: editing ? 'Changes sent for approval.' : 'Land added — the Mappingg team will review it, then developers can see it.' });
      load();
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Save failed', err: true }); } finally { setSaving(false); }
  }

  async function remove(l: LandRow) {
    if (!confirm(`Delete “${l.title}”? Developers will no longer see it.`)) return;
    try {
      const r = await fetch(`/api/my/lands?id=${encodeURIComponent(l.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setRows((x) => (x || []).filter((y) => y.id !== l.id));
      setMsg({ text: 'Land deleted.' });
    } catch { setMsg({ text: 'Delete failed', err: true }); }
  }

  const c = {
    all: rows?.length ?? 0,
    pending: rows?.filter((l) => l.status === 'pending').length ?? 0,
    approved: rows?.filter((l) => l.status === 'approved').length ?? 0,
    rejected: rows?.filter((l) => l.status === 'rejected').length ?? 0,
  };

  return (
    <div className="dsh bp">
      <header className="bp-top">
        <a className="bp-brand" href="/" aria-label="Mappingg.com home"><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></a>
        <div className="bp-top-actions">
          <a className="bp-btn ghost" href="/dashboard/agent"><i className="fas fa-arrow-left" /> <span className="bp-hide-sm">My profile</span></a>
          <SignOutButton className="bp-btn ghost" />
        </div>
      </header>

      <main className="bp-main">
        <section className="bp-hero">
          <span className="bp-av" aria-hidden="true"><i className="fas fa-mountain-sun" /></span>
          <div>
            <h1>My land</h1>
            <p>{name ? `${name} · ` : ''}Land you add is shown to developers once the Mappingg team approves it.</p>
          </div>
        </section>

        {msg && (
          <div className="dsh-notice" role={msg.err ? 'alert' : 'status'} style={msg.err ? { background: '#fdecec', color: '#b42318' } : undefined}>
            <i className={`fas ${msg.err ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} /> <span>{msg.text}</span>
          </div>
        )}

        {mode.kind !== 'list' ? (
          <section className="dsh-card">
            <h2><i className="fas fa-mountain-sun" /> {mode.kind === 'edit' ? 'Edit land' : 'Add land'}</h2>
            <LandForm
              key={mode.kind === 'edit' ? mode.land.id : 'new'}
              initial={mode.kind === 'edit' ? fieldsOf(mode.land) : undefined}
              saving={saving}
              submitLabel={mode.kind === 'edit' ? 'Save & send for approval' : 'Add land'}
              note="Your name and WhatsApp number are shown to developers with this listing."
              onSubmit={save}
              onCancel={() => setMode({ kind: 'list' })}
            />
          </section>
        ) : (
          <>
            {rows !== null && !canAdd && (
              <div className="dsh-notice"><i className="fas fa-lock" /> <span>{reason || 'Adding land is not switched on for your account yet.'}</span></div>
            )}
            <section className="dsh-card">
              <div className="land-head">
                <h2><i className="fas fa-mountain-sun" /> Your land {c.all ? <span className="dsh-count">{c.all}</span> : null}</h2>
                {canAdd && <button type="button" className="adm-btn primary sm" onClick={() => { setMsg(null); setMode({ kind: 'new' }); }}><i className="fas fa-plus" /> Add land</button>}
              </div>
              {!!c.all && (
                <p className="crm-meta" style={{ margin: '0 0 12px' }}>
                  {c.approved} approved · {c.pending} waiting approval{c.rejected ? ` · ${c.rejected} not approved` : ''}
                </p>
              )}
              {rows === null ? <p className="dsh-empty">Loading…</p>
                : !rows.length ? <p className="dsh-empty">{canAdd ? 'No land added yet. Tap “Add land” to list your first one.' : 'No land added yet.'}</p>
                  : (
                    <ul className="land-list">
                      {rows.map((l) => (
                        <li key={l.id} className={`land-item s-${l.status}`}>
                          <button type="button" className="land-sum" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}>
                            <span className="land-t"><b>{l.title}</b><small>{[l.location, l.city].filter(Boolean).join(', ')} · added {landDate(l.created_at)}</small></span>
                            <LandStatusPill status={l.status} />
                            <i className={`fas fa-chevron-${open === l.id ? 'up' : 'down'}`} />
                          </button>
                          {l.status === 'rejected' && l.review_note && <p className="land-reject"><i className="fas fa-circle-info" /> {l.review_note}</p>}
                          {open === l.id && (
                            <div className="land-body">
                              <LandDetails l={l} />
                              {canAdd && (
                                <div className="adm-actions" style={{ marginTop: 10 }}>
                                  <button type="button" className="adm-btn ghost sm" onClick={() => { setMsg(null); setMode({ kind: 'edit', land: l }); }}><i className="fas fa-pen" /> Edit</button>
                                  <button type="button" className="adm-btn danger sm" onClick={() => remove(l)}><i className="fas fa-trash" /> Delete</button>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
