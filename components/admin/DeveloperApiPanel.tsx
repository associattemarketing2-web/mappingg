'use client';

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
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
  enquiry_rate_per_minute: number; enquiry_daily_quota: number;
  expires_at: string | null; created_at: string; last_used_at: string | null; keys: Key[];
}
interface Usage { app_id: string; today: number; last_7_days: number; errors_7_days: number; rate_limited_7_days: number; avg_ms_7_days: number; enquiries_accepted_7_days?: number; enquiries_rejected_7_days?: number }
interface Ev { at: string; app_id: string | null; key_id: string | null; route: string; status: number; event: string; duration_ms: number; records: number; request_id: string; client: string | null }
interface DailyRow { app_id: string; day: string; route: string; requests: number; errors: number; rate_limited: number; records: number; avg_ms: number }
interface Overview { apps: App[]; usage: Usage[]; security: Ev[]; daily?: DailyRow[]; recent?: Ev[]; scopes: Record<string, string>; limits: Record<string, number> }
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

const emptyForm = { name: '', organization: '', contact_email: '', website: '', purpose: '', scopes: [] as string[], rate_per_minute: 60, daily_quota: 5000, max_page_size: 50, enquiry_rate_per_minute: 10, enquiry_daily_quota: 200, expires_at: '' };

export default function DeveloperApiPanel({ flash }: { flash: Flash }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form' | 'detail'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [secret, setSecret] = useState<{ value: string; app: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // List view: tab, filters, the open ⋮ menu and the usage chart's range.
  const [tab, setTab] = useState<'apps' | 'security' | 'logs'>('apps');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState<'' | App['status']>('');
  const [sortBy, setSortBy] = useState<'used' | 'name' | 'usage'>('used');
  const [logQ, setLogQ] = useState('');
  const [range, setRange] = useState<7 | 14>(7);
  // The ⋮ menu is fixed-position (the table scrolls sideways and would clip it).
  const [menu, setMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ right: 0, top: 0 });
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.ap-more, .ap-menu')) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

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
      rate_per_minute: a.rate_per_minute, daily_quota: a.daily_quota, max_page_size: a.max_page_size, enquiry_rate_per_minute: a.enquiry_rate_per_minute, enquiry_daily_quota: a.enquiry_daily_quota, expires_at: a.expires_at ? a.expires_at.slice(0, 10) : '' });
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

  async function act(body: Record<string, unknown>, done: string, confirmText?: string, appName?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      const out = await post(body);
      if (out?.secret) setSecret({ value: out.secret, app: appName || detail?.app.name || '' });
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
    await act({ action: 'rotate', id: a.id, grace_hours: grace }, 'New key issued', undefined, a.name);
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

  // Page header (all views): title, illustration and the documentation call-out.
  const head = (
    <header className="ap-head">
      <span className="ap-head-ic" aria-hidden="true"><i className="fas fa-plug" /></span>
      <div className="ap-head-t">
        <small>Integrations &amp; API</small>
        <h2>Developer API</h2>
        <p>Manage API applications and keys for partner websites. Let them read published project data or send enquiries — securely, with scopes and limits.</p>
      </div>
      <div className="ap-art" aria-hidden="true">
        <span className="ring" />
        <span className="core"><i className="fas fa-server" /><b>API</b></span>
        <span className="chip c1"><i className="fas fa-globe" /></span>
        <span className="chip c2"><i className="fas fa-database" /></span>
        <span className="chip c3"><i className="fas fa-cloud" /></span>
        <span className="chip c4"><i className="fas fa-cube" /></span>
      </div>
      <a className="ap-help" href="/developer-api" target="_blank" rel="noopener">
        <span className="ic" aria-hidden="true"><i className="fas fa-book-open" /></span>
        <span><b>Need help with integration?</b><small>Read the API documentation, guides and examples.</small></span>
        <i className="fas fa-chevron-right go" aria-hidden="true" />
      </a>
    </header>
  );

  // ---- form ----
  if (view === 'form' && ov) {
    return (
      <div className="ap">
      {head}
      <div className="adm-panel ap-panel">
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
        <div className="adm-field"><label>Scopes — what can this key do? <small>(nothing is granted unless ticked; only enquiries:submit writes)</small></label></div>
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
          {form.scopes.includes('enquiries:submit') && (
            <>
              <div className="adm-field"><label>Enquiries per minute <small>(max {ov.limits.maxEnquiryPerMinute})</small></label><input type="number" min={1} max={ov.limits.maxEnquiryPerMinute} value={form.enquiry_rate_per_minute} onChange={(e) => set('enquiry_rate_per_minute', Number(e.target.value))} /></div>
              <div className="adm-field"><label>Enquiries per day <small>(UTC, max {ov.limits.maxEnquiryDailyQuota.toLocaleString('en-IN')})</small></label><input type="number" min={1} max={ov.limits.maxEnquiryDailyQuota} value={form.enquiry_daily_quota} onChange={(e) => set('enquiry_daily_quota', Number(e.target.value))} /></div>
            </>
          )}
          <div className="adm-field"><label>Access expires on <small>(optional)</small></label><input type="date" value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} /></div>
        </div>
        {form.scopes.includes('enquiries:submit') && (
          <p className="adm-note" style={{ background: '#fff6d6', color: '#6b5200', marginBottom: 10 }}><i className="fas fa-triangle-exclamation" />
            <span><b>enquiries:submit</b> lets this partner send leads into your CRM. Enquiries are only accepted from pages on the <b>Website</b> above (and its subdomains), with the visitor’s consent wording. Leads arrive in Leads → map enquiries as “partner website …”. Grant it only to partners you trust.</span></p>
        )}
        <p className="adm-note"><i className="fas fa-circle-info" /><span>Read scopes give read-only access to public data only (published projects, articles and map data). They never give access to leads, accounts, drafts, the admin panel or the database.</span></p>
        <div className="adm-actions" style={{ marginTop: 16 }}>
          <button className="adm-btn primary" disabled={busy} onClick={save}><i className="fas fa-floppy-disk" /> {busy ? 'Saving…' : editId ? 'Save changes' : 'Create & generate key'}</button>
        </div>
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
      <div className="ap">
        {head}
        {secretBox}
        <div className="adm-panel ap-panel">
          <div className="adm-panel-head">
            <h3>{a.name} <span className={`adm-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></h3>
            <button className="adm-btn ghost sm" onClick={() => { setView('list'); setDetail(null); setTab('apps'); }}><i className="fas fa-arrow-left" /> All applications</button>
          </div>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            <code>{a.id}</code> · {a.organization || '—'} · {a.contact_email}{a.website ? <> · <a href={a.website} target="_blank" rel="noopener noreferrer nofollow">{a.website}</a></> : null}
            <br />{a.purpose}
          </p>
          <div className="viz-tiles" style={{ marginBottom: 14 }}>
            <StatTile label="Requests today" value={String(u?.today ?? 0)} note={`quota ${a.daily_quota.toLocaleString('en-IN')} / day`} meter={u ? Math.min(100, (u.today / a.daily_quota) * 100) : 0} />
            <StatTile label="Last 7 days" value={String(u?.last_7_days ?? 0)} note={`${u?.errors_7_days ?? 0} errors · ${u?.rate_limited_7_days ?? 0} rate-limited`} />
            <StatTile label="Avg response" value={`${u?.avg_ms_7_days ?? 0} ms`} note={`limit ${a.rate_per_minute}/min · ${a.max_page_size}/page`} />
            {a.scopes.includes('enquiries:submit') && (
              <StatTile label="Enquiries (7 days)" value={String(u?.enquiries_accepted_7_days ?? 0)} note={`${u?.enquiries_rejected_7_days ?? 0} rejected · limit ${a.enquiry_rate_per_minute}/min, ${a.enquiry_daily_quota}/day`} />
            )}
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

        <div className="adm-panel ap-panel">
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

        <div className="adm-panel ap-panel">
          <div className="adm-panel-head"><h3>Requests per day (UTC)</h3></div>
          {days.length ? (
            <table className="adm-table"><thead><tr><th>Day</th><th>Requests</th><th>Errors</th></tr></thead>
              <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.requests}</td><td className="muted">{d.errors}</td></tr>)}</tbody></table>
          ) : <div className="adm-empty"><i className="fas fa-chart-line" /><p>No requests yet.</p></div>}
        </div>

        <div className="adm-panel ap-panel">
          <div className="adm-panel-head"><h3>Recent requests</h3></div>
          <EventTable events={detail.events} />
        </div>

        <div className="adm-panel ap-panel">
          <div className="adm-panel-head"><h3>Audit trail</h3></div>
          <table className="adm-table"><tbody>{detail.audit.map((x, i) => <tr key={i}><td className="muted">{fmt(x.at)}</td><td>{x.action}</td><td className="muted">{x.actor}</td></tr>)}</tbody></table>
        </div>
      </div>
    );
  }

  // ---- list ----
  const apps = ov?.apps || [];
  const usage = (id: string) => ov?.usage.find((u) => u.app_id === id);
  const daily = ov?.daily || [];
  const days14 = utcDays(14);
  const perDay = (rows: DailyRow[], f: (r: DailyRow) => number) => days14.map((d) => rows.filter((r) => r.day === d).reduce((n, r) => n + f(r), 0));
  const reqSeries = perDay(daily, (r) => r.requests);
  const errSeries = perDay(daily, (r) => r.errors);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const todayTotal = (ov?.usage || []).reduce((n, u) => n + u.today, 0);
  const weekTotal = (ov?.usage || []).reduce((n, u) => n + u.last_7_days, 0);
  const prevWeek = sum(reqSeries.slice(0, 7));
  const weekErrors = sum(errSeries.slice(7));
  const weekReq = sum(reqSeries.slice(7));
  const successRate = weekReq ? ((weekReq - weekErrors) / weekReq) * 100 : null;
  const activeApps = apps.filter((a) => a.status === 'active').length;
  const appsSeries = days14.map((d) => apps.filter((a) => a.created_at.slice(0, 10) <= d).length);
  const rateSeries = days14.map((_, i) => (reqSeries[i] ? ((reqSeries[i] - errSeries[i]) / reqSeries[i]) * 100 : 100));
  const pct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);
  const health = successRate == null ? { label: 'No traffic yet', tone: 'muted' } : successRate >= 99 ? { label: 'Healthy', tone: 'ok' } : successRate >= 90 ? { label: 'Some errors', tone: 'warn' } : { label: 'Check errors', tone: 'bad' };

  const term = q.trim().toLowerCase();
  const shownApps = apps
    .filter((a) => (!statusF || a.status === statusF) && (!term || [a.name, a.organization, a.website, a.contact_email].some((v) => (v || '').toLowerCase().includes(term))))
    .sort((a, b) => (sortBy === 'name' ? a.name.localeCompare(b.name)
      : sortBy === 'usage' ? (usage(b.id)?.last_7_days ?? 0) - (usage(a.id)?.last_7_days ?? 0)
        : String(b.last_used_at || '').localeCompare(String(a.last_used_at || ''))));
  const appName = (id: string | null) => (id ? apps.find((a) => a.id === id)?.name || id : '—');
  const logTerm = logQ.trim().toLowerCase();
  const logs = (ov?.recent || []).filter((e) => !logTerm || [e.route, e.event, String(e.status), appName(e.app_id), e.request_id].some((v) => v.toLowerCase().includes(logTerm)));
  const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
  const activeKey = (a: App) => a.keys.find((k) => k.state === 'active');
  const copy = (text: string, msg: string) => navigator.clipboard?.writeText(text).then(() => flash(msg), () => flash('Copy failed', true));

  const eventRows = (events: Ev[], withActions = true) => (
    <div className="ap-scroll">
      <table className="ap-table ap-ev">
        <thead><tr><th>Time</th><th>Application</th><th>Endpoint</th><th>Status</th><th>Event</th><th>ms</th><th>Request ID</th>{withActions && <th className="r">Actions</th>}</tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.request_id}>
              <td className="nowrap">{fmt(e.at)}</td>
              <td>{appName(e.app_id)}</td>
              <td><code>{e.route}</code></td>
              <td><span className={`ap-code ${e.status >= 500 ? 'bad' : e.status >= 400 ? 'warn' : 'ok'}`}>{e.status}</span></td>
              <td><span className={`ap-ev-pill ${EVENT_TONE[e.event] || (e.event === 'ok' ? 'ok' : 'muted')}`}>{e.event}</span></td>
              <td className="muted">{e.duration_ms}</td>
              <td className="muted"><code title={e.request_id}>{e.request_id.slice(0, 8)}</code></td>
              {withActions && (
                <td className="r">
                  <button type="button" className="ap-btn sm" disabled={!e.app_id} onClick={() => e.app_id && openDetail(e.app_id)} title={e.app_id ? 'Open this application' : 'No application (no or unknown key)'}>View</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="ap">
      {head}
      {secretBox}

      <div className="ap-kpis">
        <ApiKpi icon="fa-shapes" tone="green" value={apps.length.toLocaleString('en-IN')} label="API Applications" badge={{ text: `${activeApps} active`, tone: 'ok', icon: 'fa-arrow-up' }} series={appsSeries} />
        <ApiKpi icon="fa-bolt" tone="blue" value={todayTotal.toLocaleString('en-IN')} label="API Requests (Today)" badge={growthBadge(pct(reqSeries[13], reqSeries[12]), 'vs yesterday')} series={reqSeries} />
        <ApiKpi icon="fa-chart-column" tone="violet" value={weekTotal.toLocaleString('en-IN')} label="API Requests (7 Days)" badge={growthBadge(pct(weekReq, prevWeek), 'vs the 7 days before')} series={reqSeries} />
        <ApiKpi icon="fa-shield-halved" tone="amber" value={successRate == null ? '—' : `${successRate >= 99.95 ? '100' : successRate.toFixed(1)}%`} label="Success Rate (7 Days)" badge={{ text: health.label, tone: health.tone, dot: true }} series={rateSeries} title="Share of API requests in the last 7 days that did not return an error" />
      </div>

      <div className="ap-bar">
        <div className="ap-tabs" role="tablist">
          {([['apps', 'fa-shield-halved', `API Applications (${apps.length})`], ['security', 'fa-user-shield', `Security Events (${ov?.security.length ?? 0})`], ['logs', 'fa-list-ul', 'API Logs']] as const).map(([k, ic, lbl]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><i className={`fas ${ic}`} /> {lbl}</button>
          ))}
        </div>
        <div className="ap-bar-acts">
          <a className="ap-btn" href="/developer-api" target="_blank" rel="noopener"><i className="fas fa-book-open" /> Documentation</a>
          {apps.length > 0 && <a className="ap-btn" href={`${API}?export=csv`}><i className="fas fa-file-arrow-down" /> Usage CSV</a>}
          <button type="button" className="ap-btn primary" onClick={openNew} disabled={!ov}><i className="fas fa-plus" /> New Application</button>
        </div>
      </div>

      {loading && !ov ? (
        <div className="ap-card"><div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div></div>
      ) : tab === 'apps' ? (
        <>
          <section className="ap-card">
            <div className="ap-card-head">
              <span className="ap-card-ic"><i className="fas fa-shield-halved" /></span>
              <h3>API Applications</h3>
              <p>Applications that can access Mappingg data through the Developer API.</p>
              <div className="ap-tools">
                <label className="ap-search"><i className="fas fa-magnifying-glass" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search application…" aria-label="Search applications" /></label>
                <select className="ap-select" value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} aria-label="Filter by status">
                  <option value="">All Status</option><option value="active">Active</option><option value="disabled">Disabled</option><option value="revoked">Revoked</option>
                </select>
                <select className="ap-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="Sort applications">
                  <option value="used">Last used (newest)</option><option value="usage">Most requests (7 days)</option><option value="name">Name (A–Z)</option>
                </select>
              </div>
            </div>
            {apps.length === 0 ? (
              <div className="adm-empty"><i className="fas fa-plug" /><p>No developer applications yet. Create one to give a partner read-only API access to public Mappingg data.</p></div>
            ) : shownApps.length === 0 ? (
              <div className="adm-empty"><i className="fas fa-filter" /><p>No applications match these filters.</p></div>
            ) : (
              <div className="ap-scroll">
                <table className="ap-table ap-apps">
                  <thead><tr><th>Application</th><th>Status</th><th>API Key</th><th>Scopes</th><th>Usage (Today)</th><th>Usage (7 Days)</th><th>Last used</th><th className="r">Actions</th></tr></thead>
                  <tbody>
                    {shownApps.map((a, i) => {
                      const u = usage(a.id);
                      const k = activeKey(a);
                      const bars = perDay(daily.filter((r) => r.app_id === a.id), (r) => r.requests).slice(7);
                      const used = Math.min(100, ((u?.today ?? 0) / a.daily_quota) * 100);
                      return (
                        <tr key={a.id}>
                          <td>
                            <button type="button" className="ap-app" onClick={() => openDetail(a.id)}>
                              <span className={`ap-app-ic t${i % 5}`}><i className={`fas ${APP_ICONS[i % APP_ICONS.length]}`} /></span>
                              <span><b>{a.name}</b><small>{a.website ? host(a.website) : a.organization || a.contact_email}</small></span>
                            </button>
                          </td>
                          <td><span className={`ap-status ${a.status}`}><i />{a.status[0].toUpperCase() + a.status.slice(1)}</span></td>
                          <td>
                            {k ? (
                              <span className="ap-key">
                                <code title={keyLabel(k)}>mgk_••••••••{k.last4}</code>
                                <button type="button" onClick={() => copy(keyLabel(k), 'Key ID copied (not the secret key)')} title="Copy the key ID — the secret is never shown again" aria-label="Copy key ID"><i className="far fa-copy" /></button>
                              </span>
                            ) : <span className="muted">No active key</span>}
                          </td>
                          <td title={a.scopes.join(', ') || 'No scopes — /metadata only'}>{a.scopes.length}</td>
                          <td className="ap-quota">
                            <span><b className={u?.today ? 'on' : ''}>{(u?.today ?? 0).toLocaleString('en-IN')}</b> / {a.daily_quota.toLocaleString('en-IN')}</span>
                            <span className="ap-meter" title={`${used.toFixed(1)}% of the daily quota`}><i style={{ width: `${Math.max(used, u?.today ? 3 : 0)}%` }} /></span>
                          </td>
                          <td>
                            <span className="ap-week"><b>{(u?.last_7_days ?? 0).toLocaleString('en-IN')}</b><MiniBars data={bars} /></span>
                            {u && (u.errors_7_days > 0 || u.rate_limited_7_days > 0) && <small className="muted">{u.errors_7_days} errors · {u.rate_limited_7_days} limited</small>}
                          </td>
                          <td className="nowrap">{a.last_used_at ? <>{fmtDate(a.last_used_at)}<small className="muted">{fmtTime(a.last_used_at)}</small></> : <span className="muted">Never</span>}</td>
                          <td className="r">
                            <div className="ap-acts">
                              <button type="button" className="ap-btn sm" onClick={() => openDetail(a.id)}>View</button>
                              <button type="button" className="ap-btn sm icon" disabled={a.status === 'revoked' || busy} onClick={() => openEdit(a)} title="Edit scopes & limits" aria-label={`Edit ${a.name}`}><i className="fas fa-pen" /></button>
                              <div className="ap-more">
                                <button type="button" className="ap-btn sm icon" onClick={(e) => {
                                  const r = e.currentTarget.getBoundingClientRect();
                                  setMenuPos({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 });
                                  setMenu(menu === a.id ? null : a.id);
                                }} aria-haspopup="menu" aria-expanded={menu === a.id} aria-label={`More actions for ${a.name}`}><i className="fas fa-ellipsis-vertical" /></button>
                                {menu === a.id && (
                                  <div className="ap-menu" role="menu" style={{ right: menuPos.right, top: menuPos.top }} onClick={() => setMenu(null)}>
                                    {a.status !== 'revoked' && <button type="button" role="menuitem" disabled={busy} onClick={() => rotate(a)}><i className="fas fa-rotate" /> Rotate key</button>}
                                    {a.status === 'active' && <button type="button" role="menuitem" disabled={busy} onClick={() => act({ action: 'status', id: a.id, status: 'disabled' }, 'Application disabled', `Disable ${a.name}? Its keys stop working immediately. You can enable it again later.`)}><i className="fas fa-pause" /> Disable</button>}
                                    {a.status === 'disabled' && <button type="button" role="menuitem" disabled={busy} onClick={() => act({ action: 'status', id: a.id, status: 'active' }, 'Application enabled')}><i className="fas fa-play" /> Enable</button>}
                                    <a role="menuitem" href={`${API}?export=csv&id=${encodeURIComponent(a.id)}`}><i className="fas fa-file-csv" /> Usage CSV</a>
                                    {a.status !== 'revoked' && <button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => act({ action: 'status', id: a.id, status: 'revoked' }, 'Application revoked', `Permanently revoke ${a.name}? Every key stops working immediately and this cannot be undone.`)}><i className="fas fa-ban" /> Revoke</button>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="ap-bottom">
            <section className="ap-card">
              <div className="ap-card-head">
                <span className="ap-card-ic"><i className="fas fa-shield-halved" /></span>
                <h3>Security Events</h3>
                <p>Failed authentication, scope denials, rate limits and other important events.</p>
                <div className="ap-tools"><button type="button" className="ap-btn sm" onClick={() => setTab('security')} disabled={!ov?.security.length}>View all</button></div>
              </div>
              {ov?.security.length ? eventRows(ov.security.slice(0, 5)) : <div className="adm-empty"><i className="fas fa-shield-halved" /><p>No security events. Failed sign-ins with a key, scope denials and rate limits show here.</p></div>}
            </section>
            <section className="ap-card">
              <div className="ap-card-head">
                <span className="ap-card-ic"><i className="fas fa-chart-simple" /></span>
                <h3>API Usage</h3>
                <div className="ap-tools">
                  <select className="ap-select" value={range} onChange={(e) => setRange(Number(e.target.value) as 7 | 14)} aria-label="Chart range">
                    <option value={7}>Last 7 Days</option><option value={14}>Last 14 Days</option>
                  </select>
                </div>
              </div>
              <UsageChart days={days14.slice(14 - range)} values={reqSeries.slice(14 - range)} errors={errSeries.slice(14 - range)} />
            </section>
          </div>
        </>
      ) : tab === 'security' ? (
        <section className="ap-card">
          <div className="ap-card-head">
            <span className="ap-card-ic"><i className="fas fa-user-shield" /></span>
            <h3>Security Events</h3>
            <p>The latest {ov?.security.length ?? 0}: failed authentication, scope denials, rate limits and blocks.</p>
          </div>
          {ov?.security.length ? eventRows(ov.security) : <div className="adm-empty"><i className="fas fa-shield-halved" /><p>No security events.</p></div>}
        </section>
      ) : (
        <section className="ap-card">
          <div className="ap-card-head">
            <span className="ap-card-ic"><i className="fas fa-list-ul" /></span>
            <h3>API Logs</h3>
            <p>The latest {(ov?.recent || []).length} requests to the Developer API, from every application.</p>
            <div className="ap-tools"><label className="ap-search"><i className="fas fa-magnifying-glass" /><input value={logQ} onChange={(e) => setLogQ(e.target.value)} placeholder="Search endpoint, status, app…" aria-label="Search logs" /></label></div>
          </div>
          {logs.length ? eventRows(logs) : <div className="adm-empty"><i className="fas fa-list-ul" /><p>{(ov?.recent || []).length ? 'Nothing matches this search.' : 'No API requests yet.'}</p></div>}
        </section>
      )}
    </div>
  );
}

const APP_ICONS = ['fa-globe', 'fa-cube', 'fa-link', 'fa-code', 'fa-server'];
const EVENT_TONE: Record<string, string> = { auth_missing: 'warn', auth_failed: 'bad', forbidden: 'bad', rate_limited: 'bad', quota_exceeded: 'bad', blocked: 'bad' };
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
/** The last `n` UTC days as YYYY-MM-DD, oldest first (usage is counted per UTC day). */
function utcDays(n: number) {
  return Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}
function growthBadge(p: number | null, what: string) {
  return p == null ? undefined : { text: `${Math.abs(p)}%`, tone: p >= 0 ? 'ok' : 'bad', icon: p >= 0 ? 'fa-arrow-up' : 'fa-arrow-down', title: `${p >= 0 ? 'Up' : 'Down'} ${Math.abs(p)}% ${what}` };
}

const TONE_HEX: Record<string, string> = { green: '#1f8a4c', blue: '#2a78d6', violet: '#7c4ddb', amber: '#1f8a4c' };
function Spark({ data, tone }: { data: number[]; tone: string }) {
  const w = 110, h = 30, c = TONE_HEX[tone] || '#1f8a4c';
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - 4 - ((v - min) / span) * (h - 8)).toFixed(1)}`);
  const id = `ap-spark-${tone}`;
  return (
    <svg className="ak-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity=".2" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      <path d={`M${pts.join(' L')} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={`M${pts.join(' L')}`} fill="none" stroke={c} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
function ApiKpi({ icon, tone, value, label, badge, series, title }: {
  icon: string; tone: string; value: string; label: string; series: number[]; title?: string;
  badge?: { text: string; tone: string; icon?: string; dot?: boolean; title?: string };
}) {
  return (
    <div className="ak" title={title}>
      <span className={`ak-ic ${tone}`} aria-hidden="true"><i className={`fas ${icon}`} /></span>
      <span className="ak-t"><b>{value}</b><small>{label}</small></span>
      <span className="ak-side">
        {badge && <em className={`ak-badge ${badge.tone}`} title={badge.title}>{badge.dot ? <i className="dot" /> : badge.icon ? <i className={`fas ${badge.icon}`} /> : null} {badge.text}</em>}
        <Spark data={series} tone={tone} />
      </span>
    </div>
  );
}
function MiniBars({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const any = data.some((v) => v > 0);
  return (
    <span className={`ap-bars${any ? '' : ' none'}`} aria-hidden="true">
      {data.map((v, i) => <i key={i} style={{ height: `${any ? Math.max(18, (v / max) * 100) : 30 + i * 10}%` }} />)}
    </span>
  );
}
/** Requests per day as a smooth area chart, with a tooltip on hover / tap. */
function UsageChart({ days, values, errors }: { days: string[]; values: number[]; errors: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the box's real width so the axis text stays readable on phones.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 230, L = 40, R = 14, T = 18, B = 30;
  const top = niceMax(Math.max(...values, 0));
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, days.length - 1);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  // Catmull-Rom → cubic Bézier for a smooth line through every point.
  const line = pts.map(([px, py], i) => {
    if (!i) return `M${px},${py}`;
    const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || [px, py];
    const c1x = p1[0] + (px - p0[0]) / 6, c1y = p1[1] + (py - p0[1]) / 6;
    const c2x = px - (p3[0] - p1[0]) / 6, c2y = py - (p3[1] - p1[1]) / 6;
    return `C${c1x.toFixed(1)},${Math.min(H - B, c1y).toFixed(1)} ${c2x.toFixed(1)},${Math.min(H - B, c2y).toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ticks = [0, .25, .5, .75, 1].map((f) => Math.round(top * f));
  const total = values.reduce((a, b) => a + b, 0);
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach(([qx], i) => { if (Math.abs(qx - px) < Math.abs(pts[best][0] - px)) best = i; });
    setHover(best);
  };
  return (
    <div className="ap-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${total.toLocaleString('en-IN')} API requests in the last ${days.length} days`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs><linearGradient id="ap-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f8a4c" stopOpacity=".22" /><stop offset="1" stopColor="#1f8a4c" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eef0ec" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ap-ax">{fmtK(t)}</text>
          </g>
        ))}
        {days.map((d, i) => ((W >= 440 && days.length <= 7) || i % 2 === (days.length - 1) % 2) && <text key={d} x={x(i)} y={H - 8} textAnchor={i === days.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} className="ap-ax">{label(d)}</text>)}
        <path d={`${line} L${x(days.length - 1)},${H - B} L${L},${H - B} Z`} fill="url(#ap-area)" />
        <path d={line} fill="none" stroke="#1f8a4c" strokeWidth="2.4" strokeLinejoin="round" />
        {pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={hover === i ? 5.5 : 3.5} fill={hover === i ? '#1f8a4c' : '#fff'} stroke="#1f8a4c" strokeWidth="2" />)}
        {hover != null && <line x1={pts[hover][0]} x2={pts[hover][0]} y1={T} y2={H - B} stroke="#1f8a4c" strokeDasharray="3 4" strokeOpacity=".5" />}
      </svg>
      {hover != null && (
        <div className="ap-tip" style={{ left: `${(pts[hover][0] / W) * 100}%`, top: `${(pts[hover][1] / H) * 100}%` }}>
          <b>{values[hover].toLocaleString('en-IN')} requests</b>
          <small>{label(days[hover])}{errors[hover] ? ` · ${errors[hover]} errors` : ''}</small>
        </div>
      )}
      {!total && <p className="ap-chart-empty">No API requests in this period yet.</p>}
    </div>
  );
}
const fmtK = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n));
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  // Steps that split into four round ticks (e.g. 8K → 2K, 4K, 6K).
  const m = [1, 2, 4, 8, 10].find((s) => s * p >= v) || 10;
  return m * p;
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
