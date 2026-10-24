'use client';

import { useEffect, useMemo, useState } from 'react';
import { StatTile } from './SeoCharts';

// Super admin → Buyer leads. Where every buyer lead comes from (status, real
// record counts, last successful sync, latest error, setup steps), what the
// buyers want, and the tools to connect or import more. Owner only; the server
// (/api/admin/lead-sources) re-checks every request and never returns secrets.

type Flash = (m: string, e?: boolean) => void;
type Status = 'connected' | 'not_configured' | 'permission_required' | 'failed';
interface Credential { env: string; label: string; secret: boolean; required: boolean; set: boolean }
interface Portal { id: string; name: string; url: string; data_scope: string; terms_url: string; permission: string; permission_note: string; evidence_url: string; reviewed_by: string; reviewed_at: string | null }
interface Source {
  id: string; name: string; group: 'website' | 'ads' | 'import' | 'portal'; icon: string; description: string;
  status: Status; status_note: string; records: number; last_record_at: string | null;
  last_success_at: string | null; last_success_was_test: boolean; last_error: string | null; last_error_at: string | null;
  webhook_url?: string; credentials: Credential[]; setup: string[]; actions: ('test' | 'sync' | 'subscribe' | 'import')[]; portal?: Portal;
}
interface Row {
  id: string; crm_tab: string; source_id: string; source_label: string; name: string; phone: string; email: string; city: string; area: string;
  area_from_project: boolean; bhk: string; budget: string; timeline: string; project: string;
  consent: { enquiry: boolean; call: boolean; whatsapp: boolean; source: string; recorded: boolean }; status: string; created_at: string;
}
type Tally = [string, number][];
interface Summary {
  total: number; last_30_days: number; open: number; with_requirement: number; opted_in_call: number; opted_in_whatsapp: number; no_consent_record: number;
  by_source: Tally; by_area: Tally; by_bhk: Tally; by_budget: Tally; by_timeline: Tally;
}
interface LogRow { id: string; at: string; source: string; action: string; ok: boolean; imported: number; merged: number; skipped: number; is_test: boolean; error: string | null; detail: Record<string, unknown>; actor: string | null }

const API = '/api/admin/lead-sources';
const STATUS: Record<Status, { label: string; cls: string; icon: string }> = {
  connected: { label: 'Connected', cls: 'ok', icon: 'fa-circle-check' },
  not_configured: { label: 'Not configured', cls: 'muted', icon: 'fa-circle-minus' },
  permission_required: { label: 'Permission required', cls: 'warn', icon: 'fa-lock' },
  failed: { label: 'Failed', cls: 'bad', icon: 'fa-circle-exclamation' },
};
const GROUPS: [Source['group'], string][] = [['website', 'Mappingg website'], ['ads', 'Ad platforms'], ['import', 'Import'], ['portal', 'Public property portals']];
const PERMISSION_LABEL: Record<string, string> = { not_reviewed: 'Not reviewed', permission_required: 'Asked / waiting', permitted: 'Permitted in writing', denied: 'Refused' };
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const ROWS_CAP = 300;

async function post(body: Record<string, unknown>) {
  const r = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.message || 'Failed');
  return b.data;
}

function Bars({ title, data }: { title: string; data: Tally }) {
  const max = Math.max(1, ...data.map(([, n]) => n));
  return (
    <div className="bl-bars">
      <h4>{title}</h4>
      {data.length ? data.map(([k, n]) => (
        <div key={k} className="bl-bar"><span className="k" title={k}>{k}</span><span className="t"><span style={{ width: `${(n / max) * 100}%` }} /></span><span className="n">{n}</span></div>
      )) : <p className="muted">No data yet.</p>}
    </div>
  );
}

export default function BuyerLeadsPanel({ flash, onOpenLeads }: { flash: Flash; onOpenLeads: () => void }) {
  const [data, setData] = useState<{ sources: Source[]; rows: Row[]; summary: Summary } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; lines: string[] }>>({});
  const [log, setLog] = useState<{ source: string; rows: LogRow[] } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [portalEdit, setPortalEdit] = useState<Partial<Portal> | null>(null);
  const [q, setQ] = useState('');
  const [src, setSrc] = useState('');
  const [onlyNeeds, setOnlyNeeds] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(API, { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setData(b.data);
    } catch (e) { flash(e instanceof Error && e.message ? e.message : 'Could not load buyer leads', true); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(s: Source, action: 'test' | 'sync' | 'subscribe') {
    setBusy(`${s.id}:${action}`);
    try {
      const d = await post({ action, source: s.id });
      const lines: string[] = [];
      if (d.checks) for (const c of d.checks) lines.push(`${c.ok ? '✓' : '✗'} ${c.text}`);
      if (action === 'test' && s.id === 'meta_lead_ads') {
        if (d.ok) {
          lines.push(`✓ Page: ${d.page}`, `✓ ${d.forms.length} lead form(s) visible`);
          lines.push(d.leadgen_subscribed ? '✓ Page is subscribed to lead webhooks' : '✗ Page is not subscribed to lead webhooks — click "Subscribe Page"');
        } else lines.push(`✗ ${d.kind === 'permission' ? 'Permission required' : 'Failed'}: ${d.error}`);
      }
      if (action === 'subscribe') lines.push(d.ok ? '✓ Page subscribed to leadgen webhooks' : `✗ ${d.error}`);
      if (action === 'sync') lines.push(d.ok ? `✓ ${d.forms} form(s), ${d.seen} lead(s) checked: ${d.imported} new, ${d.merged} merged, ${d.skipped} already imported${d.tests ? `, ${d.tests} test lead(s) ignored` : ''}` : `✗ ${d.error}`);
      setResult((r) => ({ ...r, [s.id]: { ok: !!d.ok, lines } }));
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(null); }
  }

  async function showLog(source: string) {
    try {
      const r = await fetch(`${API}?log=${encodeURIComponent(source)}`, { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setLog({ source, rows: b.data });
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not load the log', true); }
  }

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) =>
      (!src || r.source_id === src) &&
      (!onlyNeeds || !!(r.bhk || r.budget || r.timeline || (r.area && !r.area_from_project))) &&
      (!t || [r.name, r.phone, r.email, r.area, r.city, r.project, r.bhk, r.budget].some((v) => v.toLowerCase().includes(t))));
  }, [data, q, src, onlyNeeds]);

  if (loading && !data) return <div className="adm-panel"><div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading buyer leads…</p></div></div>;
  if (!data) return <div className="adm-panel"><div className="adm-empty"><i className="fas fa-triangle-exclamation" /><p>Could not load buyer leads.</p><button className="adm-btn ghost sm" onClick={load}>Retry</button></div></div>;
  const { sources, summary } = data;

  return (
    <>
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3><i className="fas fa-people-roof" /> Buyer leads</h3>
          <button className="adm-btn ghost sm" onClick={load} disabled={loading}><i className={`fas fa-rotate${loading ? ' fa-spin' : ''}`} /> Refresh</button>
        </div>
        <p className="muted" style={{ margin: '0 0 14px' }}>Every lead below is a real record from your database. Work leads (status, notes, follow-ups) in <button className="bl-link" onClick={onOpenLeads}>Leads</button>.</p>
        <div className="viz-tiles">
          <StatTile label="Buyer leads" value={String(summary.total)} note={`${summary.last_30_days} in the last 30 days`} />
          <StatTile label="Open" value={String(summary.open)} note="not booked, lost or spam" />
          <StatTile label="With a requirement" value={String(summary.with_requirement)} note="area, BHK, budget or timeline given" />
          <StatTile label="Opted in" value={`${summary.opted_in_call} call · ${summary.opted_in_whatsapp} WhatsApp`} note={summary.no_consent_record ? `${summary.no_consent_record} older lead(s) have no consent record` : 'marketing opt-ins'} />
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>Lead sources</h3></div>
        {GROUPS.map(([g, title]) => {
          const list = sources.filter((s) => s.group === g);
          return (
            <section key={g} className="bl-group">
              <div className="bl-group-head">
                <h4>{title}</h4>
                {g === 'portal' && (
                  <div className="adm-actions">
                    <button className="adm-btn ghost sm" onClick={async () => { try { const d = await post({ action: 'portal_seed' }); flash(d.added ? `Added ${d.added} portal(s) — permission "Not reviewed"` : 'All common portals are already listed'); load(); } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } }}><i className="fas fa-list" /> Add common Indian portals</button>
                    <button className="adm-btn ghost sm" onClick={() => setPortalEdit({ permission: 'not_reviewed', data_scope: 'Public listing / project data only. Buyer contact details are never collected from portals.' })}><i className="fas fa-plus" /> Add portal</button>
                  </div>
                )}
              </div>
              {g === 'portal' && (
                <p className="adm-note" style={{ marginBottom: 10 }}><i className="fas fa-shield-halved" /><span>Nothing is fetched from any portal. Automated access needs the portal owner&apos;s written permission <b>and</b> a connector built for exactly that use. Buyer contact details are never collected from portals.</span></p>
              )}
              {!list.length && <p className="muted">{g === 'portal' ? 'No portals listed yet.' : '—'}</p>}
              <div className="bl-cards">
                {list.map((s) => {
                  const st = STATUS[s.status];
                  const isOpen = open === s.id;
                  const res = result[s.id];
                  return (
                    <article key={s.id} className={`bl-card st-${s.status}`}>
                      <header>
                        <span className="ic"><i className={s.icon} /></span>
                        <div className="tt"><b>{s.name}</b><small>{s.description}</small></div>
                        <span className={`adm-badge ${st.cls}`}><i className={`fas ${st.icon}`} /> {st.label}</span>
                      </header>
                      <p className="note">{s.status_note}</p>
                      <dl className="bl-facts">
                        <div><dt>Records</dt><dd>{s.group === 'portal' ? '—' : s.records.toLocaleString('en-IN')}</dd></div>
                        <div><dt>{s.group === 'website' ? 'Latest record' : 'Last successful sync'}</dt><dd>{fmt(s.last_success_at)}{s.last_success_was_test ? ' (test)' : ''}</dd></div>
                        <div className="wide"><dt>Latest error</dt><dd className={s.last_error ? 'err' : ''}>{s.last_error ? <>{s.last_error} <small>· {fmt(s.last_error_at)}</small></> : '—'}</dd></div>
                      </dl>
                      {res && <pre className={`bl-result ${res.ok ? 'ok' : 'bad'}`}>{res.lines.join('\n')}</pre>}
                      <div className="adm-actions" style={{ flexWrap: 'wrap' }}>
                        {s.actions.includes('test') && <button className="adm-btn ghost sm" disabled={!!busy} onClick={() => act(s, 'test')}><i className={`fas ${busy === `${s.id}:test` ? 'fa-spinner fa-spin' : 'fa-plug-circle-check'}`} /> Test connection</button>}
                        {s.actions.includes('subscribe') && <button className="adm-btn ghost sm" disabled={!!busy || !s.credentials.every((c) => !c.required || c.set)} onClick={() => act(s, 'subscribe')}><i className="fas fa-bell" /> Subscribe Page</button>}
                        {s.actions.includes('sync') && <button className="adm-btn ghost sm" disabled={!!busy || !s.credentials.every((c) => !c.required || c.set)} onClick={() => act(s, 'sync')}><i className={`fas ${busy === `${s.id}:sync` ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`} /> Run sync</button>}
                        {s.actions.includes('import') && <button className="adm-btn primary sm" onClick={() => setCsvOpen(true)}><i className="fas fa-file-import" /> Import CSV</button>}
                        {s.portal && <button className="adm-btn ghost sm" onClick={() => setPortalEdit(s.portal!)}><i className="fas fa-pen" /> Record permission</button>}
                        {s.group !== 'website' && <button className="adm-btn ghost sm" onClick={() => showLog(s.id)}><i className="fas fa-list-ul" /> Sync log</button>}
                        <button className="adm-btn ghost sm" onClick={() => setOpen(isOpen ? null : s.id)}><i className={isOpen ? 'fas fa-chevron-up' : 'fas fa-chevron-down'} /> Setup</button>
                      </div>
                      {isOpen && (
                        <div className="bl-setup">
                          {s.webhook_url && (
                            <div className="bl-hook"><span>Webhook URL</span><code>{s.webhook_url}</code>
                              <button className="adm-btn ghost sm" onClick={() => navigator.clipboard?.writeText(s.webhook_url!).then(() => flash('Copied'), () => flash('Copy failed', true))}><i className="fas fa-copy" /></button></div>
                          )}
                          {s.credentials.length > 0 && (
                            <>
                              <h5>Required credentials <small>(server environment variables — values are never shown here)</small></h5>
                              <ul className="bl-creds">
                                {s.credentials.map((c) => (
                                  <li key={c.env}><i className={`fas ${c.set ? 'fa-circle-check ok' : c.required ? 'fa-circle-xmark bad' : 'fa-circle muted'}`} /><code>{c.env}</code> <span>{c.label}</span> <small>{c.set ? 'set' : c.required ? 'not set' : 'optional, not set'}</small></li>
                                ))}
                              </ul>
                            </>
                          )}
                          {s.portal && (
                            <p className="muted"><a href={s.portal.url} target="_blank" rel="noopener noreferrer nofollow">{s.portal.url}</a>
                              {s.portal.terms_url && <> · <a href={s.portal.terms_url} target="_blank" rel="noopener noreferrer nofollow">Terms</a></>}
                              {' · '}Permission: <b>{PERMISSION_LABEL[s.portal.permission] || s.portal.permission}</b>
                              {s.portal.reviewed_by && <> · recorded by {s.portal.reviewed_by}, {fmt(s.portal.reviewed_at)}</>}
                              {s.portal.permission_note && <><br />{s.portal.permission_note}</>}</p>
                          )}
                          <h5>Setup</h5>
                          <ol>{s.setup.map((x, i) => <li key={i}>{x}</li>)}</ol>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>What buyers want</h3></div>
        <div className="bl-bars-grid">
          <Bars title="By source" data={summary.by_source} />
          <Bars title="Preferred area" data={summary.by_area} />
          <Bars title="Home size" data={summary.by_bhk} />
          <Bars title="Budget" data={summary.by_budget} />
          <Bars title="Buying timeline" data={summary.by_timeline} />
        </div>
        <p className="muted" style={{ marginTop: 8 }}>Areas marked <i className="fas fa-map-pin" /> in the list come from the project a buyer enquired about, not from something they typed.</p>
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>All buyer leads <small className="muted">({rows.length})</small></h3></div>
        <div className="bl-filters">
          <input className="bl-search" placeholder="Search name, phone, email, area, project…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">All sources</option>
            {sources.filter((s) => s.group !== 'portal').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="bl-check"><input type="checkbox" checked={onlyNeeds} onChange={(e) => setOnlyNeeds(e.target.checked)} /> Only with a requirement</label>
        </div>
        {rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table bl-table">
              <thead><tr><th>Buyer</th><th>Source</th><th>Area</th><th>BHK</th><th>Budget</th><th>Timeline</th><th>Consent</th><th>Status</th><th>Received</th></tr></thead>
              <tbody>
                {rows.slice(0, ROWS_CAP).map((r) => (
                  <tr key={`${r.crm_tab}:${r.id}`}>
                    <td><b>{r.name || '—'}</b><br /><small className="muted">{[r.phone, r.email].filter(Boolean).join(' · ')}</small>{r.project && <><br /><small>Asked about {r.project}</small></>}</td>
                    <td>{r.source_label}</td>
                    <td>{r.area ? <>{r.area_from_project && <i className="fas fa-map-pin muted" title="From the project they asked about" />} {r.area}{r.city && !r.area.includes(r.city) ? `, ${r.city}` : ''}</> : r.city || '—'}</td>
                    <td>{r.bhk || '—'}</td>
                    <td>{r.budget || '—'}</td>
                    <td>{r.timeline || '—'}</td>
                    <td title={r.consent.source}>{r.consent.recorded ? <>{r.consent.enquiry ? 'Enquiry' : '—'}{r.consent.call ? ' · Call' : ''}{r.consent.whatsapp ? ' · WhatsApp' : ''}</> : <span className="muted">Not recorded</span>}</td>
                    <td>{r.status}</td>
                    <td className="muted">{fmt(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > ROWS_CAP && <p className="muted">Showing the newest {ROWS_CAP} of {rows.length}. Narrow the search to see others.</p>}
          </div>
        ) : <div className="adm-empty"><i className="fas fa-user-group" /><p>No leads match.</p></div>}
      </div>

      {log && (
        <div className="bl-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setLog(null)}>
          <div className="bl-modal-box">
            <div className="adm-panel-head"><h3>Sync log · {sources.find((s) => s.id === log.source)?.name || log.source}</h3><button className="adm-btn ghost sm" onClick={() => setLog(null)}><i className="fas fa-xmark" /></button></div>
            {log.rows.length ? (
              <table className="adm-table">
                <thead><tr><th>When</th><th>What</th><th>Result</th><th>New</th><th>Merged</th><th>Skipped</th><th>Details</th></tr></thead>
                <tbody>{log.rows.map((x) => (
                  <tr key={x.id}>
                    <td className="muted">{fmt(x.at)}</td><td>{x.action}{x.is_test ? ' (test)' : ''}</td>
                    <td><span className={`adm-badge ${x.ok ? 'ok' : 'bad'}`}>{x.ok ? 'OK' : 'Failed'}</span></td>
                    <td>{x.imported}</td><td>{x.merged}</td><td>{x.skipped}</td>
                    <td><small>{x.error || Object.entries(x.detail || {}).filter(([, v]) => v !== '' && v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ')}{x.actor ? ` · by ${x.actor}` : ''}</small></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className="adm-empty"><i className="fas fa-list-ul" /><p>Nothing logged yet.</p></div>}
          </div>
        </div>
      )}

      {csvOpen && <CsvImport flash={flash} onClose={() => setCsvOpen(false)} onDone={load} />}
      {portalEdit && <PortalForm initial={portalEdit} flash={flash} onClose={() => setPortalEdit(null)} onDone={load} />}
    </>
  );
}

// ---- portal form ------------------------------------------------------------------------

function PortalForm({ initial, flash, onClose, onDone }: { initial: Partial<Portal>; flash: Flash; onClose: () => void; onDone: () => void }) {
  const [p, setP] = useState({ name: '', url: '', data_scope: '', terms_url: '', permission: 'not_reviewed', permission_note: '', evidence_url: '', ...initial });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof p, v: string) => setP((x) => ({ ...x, [k]: v }));
  async function save() {
    if (p.permission === 'permitted' && (!p.permission_note.trim() || !p.evidence_url.trim())) {
      return flash('To record permission, describe exactly what was permitted and link the written permission (email or agreement).', true);
    }
    setBusy(true);
    try {
      await post({ action: 'portal_save', portal: { id: initial.id, name: p.name, url: p.url, data_scope: p.data_scope, terms_url: p.terms_url, permission: p.permission, permission_note: p.permission_note, evidence_url: p.evidence_url } });
      flash('Saved'); onDone(); onClose();
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(false); }
  }
  async function remove() {
    if (!initial.id || !confirm(`Remove ${initial.name} from the registry?`)) return;
    try { await post({ action: 'portal_delete', id: initial.id }); flash('Removed'); onDone(); onClose(); } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); }
  }
  return (
    <div className="bl-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bl-modal-box" style={{ maxWidth: 640 }}>
        <div className="adm-panel-head"><h3>{initial.id ? initial.name : 'Add a portal'}</h3><button className="adm-btn ghost sm" onClick={onClose}><i className="fas fa-xmark" /></button></div>
        <div className="adm-grid2">
          <div className="adm-field"><label>Name</label><input value={p.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="adm-field"><label>Website</label><input value={p.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" /></div>
        </div>
        <div className="adm-field"><label>Data you would use <small>(never buyer contact details)</small></label><input value={p.data_scope} onChange={(e) => set('data_scope', e.target.value)} /></div>
        <div className="adm-field"><label>Terms of use URL</label><input value={p.terms_url} onChange={(e) => set('terms_url', e.target.value)} placeholder="https://" /></div>
        <div className="adm-field"><label>Permission for automated access</label>
          <select value={p.permission} onChange={(e) => set('permission', e.target.value)}>
            {Object.entries(PERMISSION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="adm-field"><label>What exactly was permitted / refused, by whom, when</label><input value={p.permission_note} onChange={(e) => set('permission_note', e.target.value)} /></div>
        <div className="adm-field"><label>Link to the written permission <small>(email, agreement or API terms)</small></label><input value={p.evidence_url} onChange={(e) => set('evidence_url', e.target.value)} placeholder="https://" /></div>
        <p className="adm-note"><i className="fas fa-circle-info" /><span>Recording permission does not switch anything on: no portal connector exists yet, so nothing is fetched until one is built for the permitted use.</span></p>
        <div className="adm-actions" style={{ marginTop: 12 }}>
          <button className="adm-btn primary" disabled={busy} onClick={save}><i className="fas fa-floppy-disk" /> Save</button>
          {initial.id && <button className="adm-btn danger" onClick={remove}><i className="fas fa-trash" /> Remove</button>}
        </div>
      </div>
    </div>
  );
}

// ---- CSV import -------------------------------------------------------------------------

interface Preview { headers: string[]; total: number; too_many: boolean; sample: string[][]; mapping: Record<string, number>; fields: [string, string][] }
interface Report { dry_run: boolean; total: number; valid: number; imported: number; merged: number; skipped: { row: number; reason: string }[]; skipped_count: number; by_reason: Record<string, number> }

function CsvImport({ flash, onClose, onDone }: { flash: Flash; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [prov, setProv] = useState({ kind: 'broker_referral', supplied_by: '', supplier_rera: '', consent_basis: '', attest: false });
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return flash('The file is too large (max 5 MB).', true);
    const text = await f.text();
    setCsv(text); setFileName(f.name); setReport(null);
    try {
      const p: Preview = await post({ action: 'csv_preview', csv: text });
      setPreview(p); setMapping(p.mapping);
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not read the file', true); }
  }
  async function run(dry: boolean) {
    if (!dry && !confirm(`Import ${report?.valid ?? 0} lead(s) into your CRM?`)) return;
    setBusy(true);
    try {
      const r: Report = await post({ action: 'csv_import', csv, file_name: fileName, mapping, provenance: prov, dry_run: dry });
      setReport(r);
      if (!dry) { flash(`Imported ${r.imported} lead(s)${r.merged ? `, merged ${r.merged}` : ''}`); onDone(); }
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(false); }
  }
  const setMap = (field: string, v: string) => setMapping((m) => { const n = { ...m }; if (v === '') delete n[field]; else n[field] = Number(v); setReport(null); return n; });

  return (
    <div className="bl-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bl-modal-box">
        <div className="adm-panel-head"><h3><i className="fas fa-file-csv" /> Import buyer leads from CSV</h3><button className="adm-btn ghost sm" onClick={onClose}><i className="fas fa-xmark" /></button></div>
        <p className="adm-note"><i className="fas fa-shield-halved" /><span>Only import people who <b>agreed to be contacted by Associatte PropTech (Mappingg)</b>, for example a broker&apos;s client who asked to be referred, or an enquiry taken at a site visit. Never import lists bought, scraped or copied from portals.</span></p>

        <div className="adm-field"><label>CSV file <small>(max 5 MB, 5,000 rows; first row = column names)</small></label><input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} /></div>

        {preview && (
          <>
            <p className="muted">{fileName}: {preview.total.toLocaleString('en-IN')} row(s), {preview.headers.length} column(s).{preview.too_many ? ' Too many rows — split the file.' : ''}</p>
            <h5>Match the columns</h5>
            <div className="bl-map">
              {preview.fields.map(([k, label]) => (
                <div key={k} className="adm-field"><label>{label}{k === 'consent' ? <small> (rows without a clear yes are skipped)</small> : null}</label>
                  <select value={mapping[k] ?? ''} onChange={(e) => setMap(k, e.target.value)}>
                    <option value="">— not in file —</option>
                    {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select></div>
              ))}
            </div>
            <h5>Where this file came from</h5>
            <div className="adm-grid2">
              <div className="adm-field"><label>Type</label>
                <select value={prov.kind} onChange={(e) => setProv({ ...prov, kind: e.target.value })}>
                  <option value="broker_referral">Broker / channel-partner referrals</option>
                  <option value="buyer_enquiry">Buyer enquiries we collected (offline, events, calls)</option>
                </select></div>
              <div className="adm-field"><label>Supplied by <small>(broker, firm or team member)</small></label><input value={prov.supplied_by} onChange={(e) => setProv({ ...prov, supplied_by: e.target.value })} /></div>
              {prov.kind === 'broker_referral' && <div className="adm-field"><label>Broker&apos;s RERA agent number <small>(optional)</small></label><input value={prov.supplier_rera} onChange={(e) => setProv({ ...prov, supplier_rera: e.target.value })} /></div>}
            </div>
            <div className="adm-field"><label>Consent basis <small>(how these people agreed to be contacted by Mappingg — stored with every lead)</small></label>
              <input value={prov.consent_basis} onChange={(e) => setProv({ ...prov, consent_basis: e.target.value })} placeholder="e.g. Each buyer asked the broker in writing to share their details with Mappingg for project shortlisting (Oct 2026)." /></div>
            <label className="bl-check"><input type="checkbox" checked={prov.attest} onChange={(e) => setProv({ ...prov, attest: e.target.checked })} /> I confirm every person in this file agreed to be contacted by Associatte PropTech (Mappingg) as described above.</label>

            <div className="adm-actions" style={{ marginTop: 12 }}>
              <button className="adm-btn ghost" disabled={busy || preview.too_many} onClick={() => run(true)}><i className="fas fa-magnifying-glass" /> Preview (dry run)</button>
              <button className="adm-btn primary" disabled={busy || !report || !report.dry_run || report.valid === 0} onClick={() => run(false)}><i className="fas fa-file-import" /> Import {report?.dry_run ? report.valid : ''} lead(s)</button>
            </div>
          </>
        )}

        {report && (
          <div className="bl-report">
            <p><b>{report.dry_run ? 'Dry run — nothing saved yet.' : 'Import finished.'}</b> {report.total} row(s): {report.dry_run ? `${report.valid} ready to import` : `${report.imported} imported${report.merged ? `, ${report.merged} merged` : ''}`}, {report.skipped_count} skipped.</p>
            {Object.keys(report.by_reason).length > 0 && <ul>{Object.entries(report.by_reason).map(([k, n]) => <li key={k}>{k}: {n}</li>)}</ul>}
            {report.skipped.length > 0 && <details><summary>Skipped rows</summary><ul>{report.skipped.map((s, i) => <li key={i}>Row {s.row}: {s.reason}</li>)}</ul>{report.skipped_count > report.skipped.length && <p className="muted">…and {report.skipped_count - report.skipped.length} more.</p>}</details>}
          </div>
        )}
      </div>
    </div>
  );
}
