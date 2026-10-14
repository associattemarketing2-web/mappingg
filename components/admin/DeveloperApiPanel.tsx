'use client';

import { useEffect, useState } from 'react';
import { StatTile } from './SeoCharts';

// Super-admin → Developer API. Create applications for partners, choose their
// scopes and limits, issue / rotate / revoke keys and watch usage. The server
// (/api/admin/developer-api) is owner-only and re-checks every action.
// A key's secret is shown exactly once — right after create or rotate.

type Flash = (m: string, e?: boolean) => void;
interface Key { id: string; last4: string; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; state: 'active' | 'expired' | 'revoked' }
interface App {
  id: string; name: string; organization: string; contact_email: string; website: string; purpose: string; scopes: string[];
  status: 'active' | 'disabled' | 'revoked'; rate_per_minute: number; daily_quota: number; max_page_size: number;
  expires_at: string | null; created_at: string; last_used_at: string | null; keys: Key[];
}
interface Usage { app_id: string; today: number; last_7_days: number; errors_7_days: number; rate_limited_7_days: number; avg_ms_7_days: number }
interface Ev { at: string; app_id: string | null; key_id: string | null; route: string; status: number; event: string; duration_ms: number; records: number; request_id: string; client: string | null }
interface Overview { apps: App[]; usage: Usage[]; security: Ev[]; scopes: Record<string, string>; limits: Record<string, number> }
interface Detail { app: App; keys: Key[]; usage: { day: string; route: string; requests: number; errors: number; rate_limited: number; avg_ms: number }[]; events: Ev[]; audit: { at: string; actor: string; action: string }[] }

const API = '/api/admin/developer-api';
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const keyLabel = (k: Key) => `mgk_${k.id}_…${k.last4}`;
const STATUS_BADGE: Record<string, string> = { active: 'ok', disabled: 'muted', revoked: 'muted' };

async function post(body: Record<string, unknown>) {
  const r = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.details?.join?.('; ') || b?.error?.message || 'Failed');
  return b.data;
}

const emptyForm = { name: '', organization: '', contact_email: '', website: '', purpose: '', scopes: [] as string[], rate_per_minute: 60, daily_quota: 5000, max_page_size: 50, expires_at: '' };

export default function DeveloperApiPanel({ flash }: { flash: Flash }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form' | 'detail'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [secret, setSecret] = useState<{ value: string; app: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(API, { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setOv(b.data);
    } catch (e) { flash(e instanceof Error && e.message ? e.message : 'Could not load the Developer API', true); } finally { setLoading(false); }
  }
  async function openDetail(id: string) {
    try {
      const r = await fetch(`${API}?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setDetail(b.data); setView('detail');
    } catch { flash('Could not load the application', true); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditId(null); setForm(emptyForm); setView('form'); }
  function openEdit(a: App) {
    setEditId(a.id);
    setForm({ name: a.name, organization: a.organization, contact_email: a.contact_email, website: a.website, purpose: a.purpose, scopes: a.scopes,
      rate_per_minute: a.rate_per_minute, daily_quota: a.daily_quota, max_page_size: a.max_page_size, expires_at: a.expires_at ? a.expires_at.slice(0, 10) : '' });
    setView('form');
  }
  const set = (k: keyof typeof emptyForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const toggleScope = (s: string) => set('scopes', form.scopes.includes(s) ? form.scopes.filter((x) => x !== s) : [...form.scopes, s]);

  async function save() {
    if (!form.scopes.length && !confirm('No scopes selected — this key will only be able to call /metadata. Continue?')) return;
    setBusy(true);
    try {
      // A date picked in the form expires at the end of that day (UTC).
      const body = { ...form, expires_at: form.expires_at ? `${form.expires_at}T23:59:59Z` : null };
      if (editId) {
        await post({ action: 'update', id: editId, ...body });
        flash('Application updated');
        await openDetail(editId);
      } else {
        const out = await post({ action: 'create', ...body });
        setSecret({ value: out.secret, app: out.app.name });
        flash('Application created');
        await openDetail(out.app.id);
      }
      load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Save failed', true); } finally { setBusy(false); }
  }

  async function act(body: Record<string, unknown>, done: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      const out = await post(body);
      if (out?.secret) setSecret({ value: out.secret, app: detail?.app.name || '' });
      flash(done);
      if (detail) await openDetail(detail.app.id);
      load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(false); }
  }

  async function rotate(a: App) {
    const h = prompt('Rotate the key. Hours the CURRENT key keeps working so the integration can switch over (0 = stop it now):', '24');
    if (h == null) return;
    const grace = Math.max(0, Math.min(720, Math.round(Number(h))));
    if (!Number.isFinite(grace)) return flash('Enter a number of hours', true);
    await act({ action: 'rotate', id: a.id, grace_hours: grace }, 'New key issued');
  }

  const secretBox = secret && (
    <div className="adm-panel" style={{ borderColor: '#d9a400', marginBottom: 16 }}>
      <div className="adm-panel-head"><h3><i className="fas fa-key" /> New API key for {secret.app}</h3></div>
      <p className="adm-note" style={{ background: '#fff6d6', color: '#6b5200' }}><i className="fas fa-triangle-exclamation" />
        <span>Copy this key now — it is shown <b>only once</b> and Mappingg stores only a hash of it. Share it with the developer over a private channel (not email in plain text if you can avoid it). It must only be used from their <b>server</b>, never in website or app code.</span></p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <code style={{ flex: '1 1 320px', padding: '10px 12px', background: '#f4f1ea', borderRadius: 10, wordBreak: 'break-all', fontSize: 13 }}>{secret.value}</code>
        <button className="adm-btn primary sm" onClick={() => navigator.clipboard?.writeText(secret.value).then(() => flash('Key copied'), () => flash('Copy failed — select and copy it', true))}><i className="fas fa-copy" /> Copy</button>
        <button className="adm-btn ghost sm" onClick={() => { if (confirm('Have you copied the key? It cannot be shown again.')) setSecret(null); }}>I’ve saved it</button>
      </div>
    </div>
  );

  // ---- form ----
  if (view === 'form' && ov) {
    return (
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>{editId ? 'Edit application' : 'New developer application'}</h3>
          <button className="adm-btn ghost sm" onClick={() => (editId && detail ? setView('detail') : setView('list'))}><i className="fas fa-arrow-left" /> Back</button>
        </div>
        <div className="adm-grid2">
          <div className="adm-field"><label>Application name</label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme Realty website" /></div>
          <div className="adm-field"><label>Developer / organisation</label><input value={form.organization} onChange={(e) => set('organization', e.target.value)} placeholder="e.g. Acme Realty Pvt Ltd" /></div>
          <div className="adm-field"><label>Contact email</label><input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="tech@acme.example" /></div>
          <div className="adm-field"><label>Website <small>(optional)</small></label><input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://acme.example" /></div>
        </div>
        <div className="adm-field"><label>Purpose of the integration</label><input value={form.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. Show Kharadi projects on their agency website" /></div>
        <div className="adm-field"><label>Scopes — what can this key read? <small>(nothing is granted unless ticked)</small></label></div>
        <div className="adm-perms">
          {Object.entries(ov.scopes).map(([s, desc]) => (
            <button type="button" key={s} className={`adm-perm${form.scopes.includes(s) ? ' on' : ''}`} onClick={() => toggleScope(s)}>
              <span className="ic"><i className="fas fa-lock-open" /></span>
              <span className="t"><b>{s}</b><small>{desc}</small></span>
              <i className={`fas ${form.scopes.includes(s) ? 'fa-circle-check' : 'fa-circle'} chk`} />
            </button>
          ))}
        </div>
        <div className="adm-grid2" style={{ marginTop: 14 }}>
          <div className="adm-field"><label>Requests per minute <small>(max {ov.limits.maxRatePerMinute})</small></label><input type="number" min={1} max={ov.limits.maxRatePerMinute} value={form.rate_per_minute} onChange={(e) => set('rate_per_minute', Number(e.target.value))} /></div>
          <div className="adm-field"><label>Daily quota <small>(requests per UTC day, max {ov.limits.maxDailyQuota.toLocaleString('en-IN')})</small></label><input type="number" min={1} max={ov.limits.maxDailyQuota} value={form.daily_quota} onChange={(e) => set('daily_quota', Number(e.target.value))} /></div>
          <div className="adm-field"><label>Max records per page <small>(max {ov.limits.maxPageSize})</small></label><input type="number" min={1} max={ov.limits.maxPageSize} value={form.max_page_size} onChange={(e) => set('max_page_size', Number(e.target.value))} /></div>
          <div className="adm-field"><label>Access expires on <small>(optional)</small></label><input type="date" value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} /></div>
        </div>
        <p className="adm-note"><i className="fas fa-circle-info" /><span>Keys give read-only access to public data only (published projects, articles and map data). They never give access to leads, accounts, drafts, the admin panel or the database.</span></p>
        <div className="adm-actions" style={{ marginTop: 16 }}>
          <button className="adm-btn primary" disabled={busy} onClick={save}><i className="fas fa-floppy-disk" /> {busy ? 'Saving…' : editId ? 'Save changes' : 'Create & generate key'}</button>
        </div>
      </div>
    );
  }

  // ---- one application ----
  if (view === 'detail' && detail) {
    const a = detail.app;
    const u = ov?.usage.find((x) => x.app_id === a.id);
    const days = [...new Set(detail.usage.map((r) => r.day))].slice(0, 14).map((day) => ({
      day, requests: detail.usage.filter((r) => r.day === day).reduce((s, r) => s + r.requests, 0),
      errors: detail.usage.filter((r) => r.day === day).reduce((s, r) => s + r.errors, 0),
    }));
    return (
      <>
        {secretBox}
        <div className="adm-panel">
          <div className="adm-panel-head">
            <h3>{a.name} <span className={`adm-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></h3>
            <button className="adm-btn ghost sm" onClick={() => { setView('list'); setDetail(null); }}><i className="fas fa-arrow-left" /> All applications</button>
          </div>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            <code>{a.id}</code> · {a.organization || '—'} · {a.contact_email}{a.website ? <> · <a href={a.website} target="_blank" rel="noopener noreferrer nofollow">{a.website}</a></> : null}
            <br />{a.purpose}
          </p>
          <div className="viz-tiles" style={{ marginBottom: 14 }}>
            <StatTile label="Requests today" value={String(u?.today ?? 0)} note={`quota ${a.daily_quota.toLocaleString('en-IN')} / day`} meter={u ? Math.min(100, (u.today / a.daily_quota) * 100) : 0} />
            <StatTile label="Last 7 days" value={String(u?.last_7_days ?? 0)} note={`${u?.errors_7_days ?? 0} errors · ${u?.rate_limited_7_days ?? 0} rate-limited`} />
            <StatTile label="Avg response" value={`${u?.avg_ms_7_days ?? 0} ms`} note={`limit ${a.rate_per_minute}/min · ${a.max_page_size}/page`} />
            <StatTile label="Last used" value={a.last_used_at ? fmt(a.last_used_at) : 'Never'} note={a.expires_at ? `expires ${fmt(a.expires_at)}` : 'no expiry'} />
          </div>
          <div style={{ marginBottom: 12 }}>{a.scopes.length ? a.scopes.map((s) => <span key={s} className="adm-badge ok" style={{ marginRight: 6 }}>{s}</span>) : <span className="muted">No scopes — /metadata only</span>}</div>
          <div className="adm-actions" style={{ flexWrap: 'wrap' }}>
            {a.status !== 'revoked' && <button className="adm-btn ghost sm" disabled={busy} onClick={() => openEdit(a)}><i className="fas fa-pen" /> Edit scopes &amp; limits</button>}
            {a.status !== 'revoked' && <button className="adm-btn ghost sm" disabled={busy} onClick={() => rotate(a)}><i className="fas fa-rotate" /> Rotate key</button>}
            {a.status === 'active' && <button className="adm-btn ghost sm" disabled={busy} onClick={() => act({ action: 'status', id: a.id, status: 'disabled' }, 'Application disabled', `Disable ${a.name}? Its keys stop working immediately. You can enable it again later.`)}><i className="fas fa-pause" /> Disable</button>}
            {a.status === 'disabled' && <button className="adm-btn primary sm" disabled={busy} onClick={() => act({ action: 'status', id: a.id, status: 'active' }, 'Application enabled')}><i className="fas fa-play" /> Enable</button>}
            {a.status !== 'revoked' && <button className="adm-btn danger sm" disabled={busy} onClick={() => act({ action: 'status', id: a.id, status: 'revoked' }, 'Application revoked', `Permanently revoke ${a.name}? Every key stops working immediately and this cannot be undone.`)}><i className="fas fa-ban" /> Revoke</button>}
            <a className="adm-btn ghost sm" href={`${API}?export=csv&id=${encodeURIComponent(a.id)}`}><i className="fas fa-file-csv" /> Usage CSV</a>
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Keys</h3></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Key</th><th>State</th><th>Created</th><th>Expires</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {detail.keys.map((k) => (
                  <tr key={k.id}>
                    <td><code>{keyLabel(k)}</code></td>
                    <td><span className={`adm-badge ${k.state === 'active' ? 'ok' : 'muted'}`}>{k.state}</span></td>
                    <td className="muted">{fmt(k.created_at)}</td>
                    <td className="muted">{fmt(k.expires_at)}</td>
                    <td className="muted">{fmt(k.last_used_at)}</td>
                    <td>{k.state === 'active' && <button className="adm-btn danger sm" disabled={busy} onClick={() => act({ action: 'revoke_key', id: a.id, key_id: k.id }, 'Key revoked', `Revoke key …${k.last4}? It stops working immediately.`)}><i className="fas fa-ban" /> Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Requests per day (UTC)</h3></div>
          {days.length ? (
            <table className="adm-table"><thead><tr><th>Day</th><th>Requests</th><th>Errors</th></tr></thead>
              <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.requests}</td><td className="muted">{d.errors}</td></tr>)}</tbody></table>
          ) : <div className="adm-empty"><i className="fas fa-chart-line" /><p>No requests yet.</p></div>}
        </div>

        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Recent requests</h3></div>
          <EventTable events={detail.events} />
        </div>

        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Audit trail</h3></div>
          <table className="adm-table"><tbody>{detail.audit.map((x, i) => <tr key={i}><td className="muted">{fmt(x.at)}</td><td>{x.action}</td><td className="muted">{x.actor}</td></tr>)}</tbody></table>
        </div>
      </>
    );
  }

  // ---- list ----
  const apps = ov?.apps || [];
  const usage = (id: string) => ov?.usage.find((u) => u.app_id === id);
  return (
    <>
      {secretBox}
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>Developer API {apps.length ? `(${apps.length})` : ''}</h3>
          <div className="adm-actions">
            <a className="adm-btn ghost sm" href="/developer-api" target="_blank" rel="noopener"><i className="fas fa-book" /> Docs</a>
            {apps.length > 0 && <a className="adm-btn ghost sm" href={`${API}?export=csv`}><i className="fas fa-file-csv" /> Usage CSV</a>}
            <button className="adm-btn primary sm" onClick={openNew} disabled={!ov}><i className="fas fa-plus" /> New application</button>
          </div>
        </div>
        {loading && !ov ? (
          <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
        ) : apps.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-plug" /><p>No developer applications yet. Create one to give a partner read-only API access to public Mappingg data.</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Application</th><th>Status</th><th>Scopes</th><th>Today</th><th>7 days</th><th>Last used</th></tr></thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(a.id)}>
                    <td className="t-title"><b>{a.name}</b><small>{a.organization || a.contact_email}</small></td>
                    <td><span className={`adm-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                    <td className="muted">{a.scopes.length}</td>
                    <td>{usage(a.id)?.today ?? 0} <small className="muted">/ {a.daily_quota}</small></td>
                    <td>{usage(a.id)?.last_7_days ?? 0}</td>
                    <td className="muted">{fmt(a.last_used_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {ov && ov.security.length > 0 && (
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Security events <small className="muted">(failed authentication, scope denials, rate limits, blocks)</small></h3></div>
          <EventTable events={ov.security} showApp apps={apps} />
        </div>
      )}
    </>
  );
}

function EventTable({ events, showApp, apps }: { events: Ev[]; showApp?: boolean; apps?: App[] }) {
  if (!events.length) return <div className="adm-empty"><i className="fas fa-list" /><p>Nothing yet.</p></div>;
  const name = (id: string | null) => (id ? apps?.find((a) => a.id === id)?.name || id : '—');
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="adm-table">
        <thead><tr><th>Time</th>{showApp && <th>Application</th>}<th>Endpoint</th><th>Status</th><th>Event</th><th>ms</th><th>Request ID</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.request_id}>
              <td className="muted">{fmt(e.at)}</td>
              {showApp && <td>{name(e.app_id)}</td>}
              <td><code>{e.route}</code></td>
              <td>{e.status}</td>
              <td><span className={`adm-badge ${e.event === 'ok' ? 'ok' : 'muted'}`}>{e.event}</span></td>
              <td className="muted">{e.duration_ms}</td>
              <td className="muted"><small>{e.request_id.slice(0, 8)}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
