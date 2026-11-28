'use client';

import { useEffect, useState } from 'react';
import LandForm, { LandDetails, LandStatusPill, areaText, fieldsOf, landDate, type LandFields, type LandRow } from '@/components/lands/LandForm';

// Super admin → Land: every land listing channel partners added. Approve to show
// it to developers, reject with a reason the partner sees, edit or delete it, and
// choose which partners may add land at all ("Partner access").

interface Partner { id: string; name: string; email: string; mobile: string; agency: string; can_add_land: boolean; verified: boolean }
type Filter = 'pending' | 'approved' | 'rejected' | 'all';

export default function LandsPanel({ flash, isOwner, onPendingChange }: {
  flash: (m: string, e?: boolean) => void;
  isOwner: boolean;
  onPendingChange?: (n: number) => void;
}) {
  const [rows, setRows] = useState<LandRow[] | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [pane, setPane] = useState<'land' | 'access'>('land');
  const [filter, setFilter] = useState<Filter>('pending');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<LandRow | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [pq, setPq] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/admin/lands', { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Could not load land');
      const list: LandRow[] = Array.isArray(b.data) ? b.data : [];
      setRows(list); setPartners(Array.isArray(b.partners) ? b.partners : []);
      // Open on "All" when nothing is waiting.
      if (!list.some((l) => l.status === 'pending')) setFilter((f) => (f === 'pending' ? 'all' : f));
    } catch (e) { setRows([]); flash(e instanceof Error ? e.message : 'Could not load land', true); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rows) onPendingChange?.(rows.filter((l) => l.status === 'pending').length); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (l: LandRow) => setRows((x) => (x || []).map((y) => (y.id === l.id ? l : y)));

  async function review(l: LandRow, decision: 'approve' | 'reject' | 'reset', note = '') {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/lands', {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: l.id, decision, note }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Failed');
      replace(b.data); setRejectFor(null); setReason('');
      flash(decision === 'approve' ? 'Approved — developers can see this land now' : decision === 'reject' ? 'Marked not approved — the partner sees your reason' : 'Moved back to waiting approval');
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(false); }
  }

  async function saveEdit(f: LandFields) {
    if (!editing) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/lands', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, ...f }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Save failed');
      replace(b.data); setEditing(null); flash('Land updated');
    } catch (e) { flash(e instanceof Error ? e.message : 'Save failed', true); } finally { setBusy(false); }
  }

  async function remove(l: LandRow) {
    if (!confirm(`Delete “${l.title}”? You can restore it from Backups → Recycle bin.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/lands?id=${encodeURIComponent(l.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setRows((x) => (x || []).filter((y) => y.id !== l.id)); flash('Land deleted — kept in the recycle bin');
    } catch { flash('Delete failed', true); } finally { setBusy(false); }
  }

  async function setAccess(p: Partner, on: boolean) {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/accounts', {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, can_add_land: on }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Failed');
      setPartners((x) => x.map((y) => (y.id === p.id ? { ...y, can_add_land: on } : y)));
      flash(on ? `${p.name || p.email} can now add land` : `${p.name || p.email} can no longer add land`);
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(false); }
  }

  const count = (s: Filter) => (rows || []).filter((l) => s === 'all' || l.status === s).length;
  const t = q.trim().toLowerCase();
  const shown = (rows || []).filter((l) => (filter === 'all' || l.status === filter)
    && (!t || [l.title, l.location, l.city, l.land_type, l.cp_name, l.cp_email, l.cp_mobile, l.cp_agency, l.survey_no].some((v) => v && v.toLowerCase().includes(t))));
  const pt = pq.trim().toLowerCase();
  const shownPartners = partners.filter((p) => !pt || [p.name, p.email, p.mobile, p.agency].some((v) => v && v.toLowerCase().includes(pt)));
  const allowedN = partners.filter((p) => p.can_add_land).length;

  if (editing) {
    return (
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>Edit land</h3>
          <button className="adm-btn ghost sm" onClick={() => setEditing(null)}><i className="fas fa-arrow-left" /> Back</button>
        </div>
        <p className="crm-meta" style={{ margin: '0 0 12px' }}>Added by {editing.cp_name || editing.cp_email}. Your correction keeps its current status (<LandStatusPill status={editing.status} />).</p>
        <LandForm initial={fieldsOf(editing)} saving={busy} submitLabel="Save changes" onSubmit={saveEdit} onCancel={() => setEditing(null)} />
      </div>
    );
  }

  return (
    <div className="adm-panel">
      <div className="land-tabs" role="tablist" aria-label="Land view">
        <button type="button" role="tab" aria-selected={pane === 'land'} className={pane === 'land' ? 'on' : ''} onClick={() => setPane('land')}><i className="fas fa-mountain-sun" /> Land listings <span className="n">{rows?.length ?? '…'}</span></button>
        <button type="button" role="tab" aria-selected={pane === 'access'} className={pane === 'access' ? 'on' : ''} onClick={() => setPane('access')}><i className="fas fa-key" /> Partner access <span className="n">{allowedN}</span></button>
      </div>

      {pane === 'access' ? (
        <>
          <p className="crm-meta" style={{ margin: '4px 0 12px' }}>Switch on <b>Can add land</b> for the channel partners who may list land. They see only their own listings; developers see a listing once you approve it.</p>
          <div className="land-tools">
            <input className="crm-search" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search partner name, email, number…" aria-label="Search partners" />
          </div>
          {!shownPartners.length ? <div className="adm-empty"><i className="fas fa-user-tie" /><p>{partners.length ? 'No partner matches your search.' : 'No channel partner accounts yet.'}</p></div> : (
            <ul className="land-list">
              {shownPartners.map((p) => (
                <li key={p.id} className="land-item">
                  <div className="land-sum" style={{ cursor: 'default' }}>
                    <span className="land-t">
                      <b>{p.name || p.email}</b>
                      <small>{[p.agency, p.email, p.mobile, p.verified ? '' : 'not verified yet'].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span className="land-when">{(rows || []).filter((l) => l.cp_id === p.id).length} land</span>
                    {isOwner ? (
                      <label className="land-switch" title={p.verified ? '' : 'They can add land once their account is verified'}>
                        <input type="checkbox" checked={p.can_add_land} disabled={busy} onChange={(e) => setAccess(p, e.target.checked)} />
                        <span>Can add land</span>
                      </label>
                    ) : <span className={`crm-pill ${p.can_add_land ? 'won' : 'new'}`}>{p.can_add_land ? 'Can add land' : 'Off'}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!isOwner && <p className="crm-meta"><i className="fas fa-lock" /> Only the super admin can change land access.</p>}
        </>
      ) : (
        <>
          <div className="land-tools">
            <div className="land-chips">
              {([['pending', 'Waiting approval'], ['approved', 'Approved'], ['rejected', 'Not approved'], ['all', 'All']] as const).map(([k, lbl]) => (
                <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{lbl} <span className="n">{count(k)}</span></button>
              ))}
            </div>
            <input className="crm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, location, partner…" aria-label="Search land" />
          </div>
          {rows === null ? <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
            : !shown.length ? <div className="adm-empty"><i className="fas fa-mountain-sun" /><p>{rows.length ? 'Nothing here.' : 'No land yet. Give a channel partner access under “Partner access” and their listings will show up here for approval.'}</p></div>
              : (
                <ul className="land-list">
                  {shown.map((l) => (
                    <li key={l.id} className={`land-item s-${l.status}`}>
                      <button type="button" className="land-sum" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}>
                        <span className="land-t">
                          <b>{l.title}</b>
                          <small>{[[l.location, l.city].filter(Boolean).join(', '), areaText(l), l.price, `by ${l.cp_name || l.cp_email}`, landDate(l.created_at)].filter(Boolean).join(' · ')}</small>
                        </span>
                        <LandStatusPill status={l.status} />
                        <i className={`fas fa-chevron-${open === l.id ? 'up' : 'down'}`} />
                      </button>
                      {l.status === 'rejected' && l.review_note && <p className="land-reject"><i className="fas fa-circle-info" /> Reason: {l.review_note}</p>}
                      {open === l.id && (
                        <div className="land-body">
                          <LandDetails l={l} showContact />
                          {l.cp_email && <p className="crm-meta" style={{ margin: '6px 0 0' }}>Partner email: {l.cp_email}</p>}
                          {l.reviewed_by && l.status !== 'pending' && <p className="crm-meta" style={{ margin: '4px 0 0' }}>{l.status === 'approved' ? 'Approved' : 'Reviewed'} by {l.reviewed_by} · {landDate(l.reviewed_at)}</p>}
                          {isOwner ? (
                            rejectFor === l.id ? (
                              <div style={{ marginTop: 10 }}>
                                <textarea className="crm-search" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why isn't it approved? The partner sees this." style={{ width: '100%' }} />
                                <div className="adm-actions" style={{ marginTop: 8 }}>
                                  <button type="button" className="adm-btn danger sm" disabled={busy || !reason.trim()} onClick={() => review(l, 'reject', reason.trim())}><i className="fas fa-circle-xmark" /> Not approved</button>
                                  <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => { setRejectFor(null); setReason(''); }}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="adm-actions" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                                {l.status !== 'approved' && <button type="button" className="adm-btn primary sm" disabled={busy} onClick={() => review(l, 'approve')}><i className="fas fa-circle-check" /> Approve</button>}
                                {l.status !== 'rejected' && <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => { setRejectFor(l.id); setReason(''); }}><i className="fas fa-circle-xmark" /> Reject</button>}
                                {l.status !== 'pending' && <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => review(l, 'reset')}><i className="fas fa-rotate-left" /> Back to waiting</button>}
                                <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => setEditing(l)}><i className="fas fa-pen" /> Edit</button>
                                <button type="button" className="adm-btn danger sm" disabled={busy} onClick={() => remove(l)}><i className="fas fa-trash" /> Delete</button>
                              </div>
                            )
                          ) : <p className="crm-meta" style={{ marginTop: 8 }}><i className="fas fa-lock" /> Only the super admin can approve or change land.</p>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
        </>
      )}
    </div>
  );
}
