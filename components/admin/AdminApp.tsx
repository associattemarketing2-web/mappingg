'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePersistedState } from './usePersistedState';
import { cssZoom } from './zoom';
import SettingsForm from './SettingsForm';
import ProfileForm from './ProfileForm';
import DevProjectsPanel, { type DevProject } from './DevProjectsPanel';
import { WHATSAPP_NUMBER } from '@/lib/contact';
import NotificationBell from './NotificationBell';
import PhoneInput from '@/components/PhoneInput';
import SearchConsolePanel from './SearchConsolePanel';
import { BulkBar, PickAll, PickOne, useSelection } from './bulk';
import TrafficPanel from './TrafficPanel';
import DevelopersPanel from './DevelopersPanel';
import BuyerLeadsPanel from './BuyerLeadsPanel';
import DeveloperApiPanel from './DeveloperApiPanel';
import WhatsAppPanel from './WhatsAppPanel';
import ShareLinkButton from './ShareLinkButton';
import { PageHead, StatCard } from './PageHead';
import OverviewMap, { loadProjectIndex, matchProjects, type ProjectHit } from './OverviewMap';
import { FULL_EDIT_EVENT, requestFullEdit, submissionForPin } from './fullEdit';
import { ChartCard, DayHeatmap, Donut, HBars, STATUS_META, StatTile, StatusStack, TYPE_COLORS, WeekColumns, dayStats } from './SeoCharts';

export interface AdminUser {
  email: string;
  name?: string;
  role: string; // 'admin' (owner) | 'employee'
  permissions: string[];
  avatar?: string;
}

const GRANTABLE = [
  { key: 'map', label: 'Map Editor', icon: 'fa-map-location-dot', desc: 'Add & edit project pins, infra and roads' },
  { key: 'intake', label: 'Projects Intake', icon: 'fa-file-arrow-up', desc: 'Bulk CSV upload, review queue & builder links' },
  { key: 'leads', label: 'Leads / CRM', icon: 'fa-address-book', desc: 'Contact enquiries & lead pipeline' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'fa-comments', desc: 'WhatsApp chats, AI auto-replies, OTP & automations' },
  { key: 'accounts', label: 'Accounts', icon: 'fa-users', desc: 'Buyer, developer & partner sign-ups' },
  { key: 'blogs', label: 'Blogs', icon: 'fa-newspaper', desc: 'Write & publish SEO articles' },
  { key: 'seo', label: 'SEO & Health', icon: 'fa-chart-line', desc: 'View search & site health' },
  { key: 'settings', label: 'Settings', icon: 'fa-gear', desc: 'Edit analytics & verification' },
];

const TAB_META: Record<string, { label: string; icon: string; desc: string }> = {
  dashboard: { label: 'Overview', icon: 'fa-house', desc: 'Today at a glance' },
  map: { label: 'Map Editor', icon: 'fa-map-location-dot', desc: 'Manage pins & locations' },
  developers: { label: 'Developers', icon: 'fa-building', desc: 'Builder directory & logos' },
  intake: { label: 'Projects Intake', icon: 'fa-file-arrow-up', desc: 'Add new projects, bulk CSV & review' },
  projects: { label: 'Developer projects', icon: 'fa-map-pin', desc: 'Approve & publish to the map' },
  leads: { label: 'Leads', icon: 'fa-address-book', desc: 'Enquiries & lead pipeline' },
  whatsapp: { label: 'WhatsApp', icon: 'fa-comments', desc: 'Chats, auto-replies & automations' },
  buyerleads: { label: 'Buyer leads', icon: 'fa-people-roof', desc: 'Buyer requirements & lead sources' },
  accounts: { label: 'Accounts', icon: 'fa-users', desc: 'Buyer, developer & partner sign-ups' },
  backups: { label: 'Backups', icon: 'fa-database', desc: 'Backups & recycle bin' },
  blogs: { label: 'Blogs', icon: 'fa-newspaper', desc: 'Write & publish SEO articles' },
  employees: { label: 'Employees', icon: 'fa-users-gear', desc: 'Teammates & their access' },
  devapi: { label: 'Developer API', icon: 'fa-plug', desc: 'Partner websites & API keys' },
  seo: { label: 'SEO & Health', icon: 'fa-chart-line', desc: 'Search, traffic & site health' },
  settings: { label: 'Settings', icon: 'fa-gear', desc: 'Analytics & verification' },
  profile: { label: 'Profile', icon: 'fa-user', desc: 'Your name, photo & password' },
};

// The top navigation: each group opens a dropdown of its sections (one-section
// groups open it directly). Every section keeps its own tab key, so ?tab= links,
// permissions and "Edit all details" work as before.
const NAV: { key: string; label: string; icon: string; tabs: string[] }[] = [
  { key: 'overview', label: 'Overview', icon: 'fa-house', tabs: ['dashboard'] },
  { key: 'mapproj', label: 'Map & Projects', icon: 'fa-map', tabs: ['map', 'intake', 'projects'] },
  { key: 'leads', label: 'CRM & Leads', icon: 'fa-user-group', tabs: ['leads', 'buyerleads', 'accounts'] },
  { key: 'developers', label: 'Developers', icon: 'fa-building', tabs: ['developers'] },
  { key: 'content', label: 'Content & SEO', icon: 'fa-file-lines', tabs: ['blogs', 'seo'] },
  { key: 'comms', label: 'Communication', icon: 'fa-comment-dots', tabs: ['whatsapp'] },
  { key: 'integrations', label: 'Integrations & API', icon: 'fa-plug', tabs: ['devapi'] },
  { key: 'team', label: 'Team & Administration', icon: 'fa-users-gear', tabs: ['employees'] },
];

function useToast() {
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const flash = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  };
  const node = toast ? (
    <div className={`adm-toast show${toast.err ? ' err' : ''}`}>
      <i className={`fas ${toast.err ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} />
      {toast.msg}
    </div>
  ) : null;
  return { flash, node };
}

/* ------------------------------- Dashboard ------------------------------- */

type DayProject = {
  id: string; number: number | null; title: string; developer: string; location: string; status: string; type: string;
  price: string; configuration: string; rera: string; created_at: string; hidden: boolean; pending: boolean; rejected: boolean;
  origin: 'intake' | 'developer' | 'map'; page: string | null;
};
const DAY_PAGE = 40;
const ORIGIN_LABEL: Record<DayProject['origin'], string> = { intake: 'From Projects Intake', developer: 'Added by a developer', map: 'Added on the map' };

/** The projects created on one day (click a square in "Projects created day by day"). */
function DayProjects({ date, onClose }: { date: string; onClose: () => void }) {
  const [rows, setRows] = useState<DayProject[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(DAY_PAGE);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let off = false;
    setRows(null); setError(''); setQ(''); setShown(DAY_PAGE);
    fetch(`/api/admin/pins-by-day?date=${encodeURIComponent(date)}`, { credentials: 'same-origin' })
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok || b.error) throw new Error(b?.error?.message || `Could not load (${r.status})`); return b.data.projects as DayProject[]; })
      .then((list) => { if (!off) setRows(list); })
      .catch((e) => { if (!off) setError(e instanceof Error ? e.message : 'Could not load the projects'); });
    // Bring the list into view (it opens under the calendar).
    requestAnimationFrame(() => boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    return () => { off = true; };
  }, [date]);

  const term = q.trim().toLowerCase();
  const list = (rows || []).filter((p) => !term || [p.title, p.developer, p.location, p.rera, String(p.number ?? '')].some((v) => v.toLowerCase().includes(term)));
  const day = new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const time = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); };

  return (
    <div className="day-pj" ref={boxRef} aria-live="polite">
      <div className="day-pj-head">
        <h4>{day}{rows ? ` — ${rows.length} project${rows.length === 1 ? '' : 's'} created` : ''}</h4>
        <div className="day-pj-tools">
          {rows && rows.length > 6 && (
            <label className="acs-search">
              <i className="fas fa-magnifying-glass" />
              <input type="search" placeholder="Search name, developer, RERA, #" value={q} onChange={(e) => { setQ(e.target.value); setShown(DAY_PAGE); }} aria-label="Search this day's projects" />
            </label>
          )}
          <button type="button" className="adm-btn ghost sm" onClick={onClose}><i className="fas fa-xmark" /> Close</button>
        </div>
      </div>
      {error ? <p className="muted"><i className="fas fa-triangle-exclamation" /> {error}</p>
        : !rows ? <p className="muted"><i className="fas fa-spinner fa-spin" /> Loading projects…</p>
          : !list.length ? <p className="muted">{rows.length ? 'No project matches your search.' : 'No projects were created on this day.'}</p>
            : (<>
              <ul className="day-pj-list">
                {list.slice(0, shown).map((p) => (
                  <li key={p.id}>
                    <div className="day-pj-main">
                      <b>{p.number != null ? `#${p.number} · ` : ''}{p.title || 'Untitled project'}</b>
                      <small>{[p.developer, p.location].filter(Boolean).join(' · ') || '—'}{p.created_at ? ` · added ${time(p.created_at)}` : ''}</small>
                      <div className="day-pj-tags">
                        {p.status && <span className="day-pj-tag">{STATUS_META[p.status]?.label || p.status}</span>}
                        {p.type && <span className="day-pj-tag">{p.type}</span>}
                        <span className="day-pj-tag muted">{ORIGIN_LABEL[p.origin]}</span>
                        {p.hidden && <span className="day-pj-tag muted">Hidden on the map</span>}
                        {p.pending && <span className="day-pj-tag warn">Waiting for approval</span>}
                        {p.rejected && <span className="day-pj-tag warn">Not approved</span>}
                        {!p.price && <span className="day-pj-tag warn">No price</span>}
                      </div>
                    </div>
                    <div className="day-pj-acts">
                      <button type="button" className="adm-btn primary sm" onClick={() => requestFullEdit(p.id)} title="Every field: price, configuration, RERA, media, amenities, sales contact…">
                        <i className="fas fa-pen-to-square" /> Edit all details
                      </button>
                      <a className="adm-btn ghost sm" href={`/map?pin=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener"><i className="fas fa-map-location-dot" /> View on map</a>
                      {!p.hidden && <ShareLinkButton pinId={p.id} />}
                      {p.page && <a className="adm-btn ghost sm" href={p.page} target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> Project page</a>}
                    </div>
                  </li>
                ))}
              </ul>
              {list.length > shown && (
                <div className="day-pj-more">
                  <button type="button" className="adm-btn ghost sm" onClick={() => setShown((n) => n + DAY_PAGE)}>
                    Show more ({list.length - shown} left)
                  </button>
                </div>
              )}
            </>)}
    </div>
  );
}

type Tally = { key: string; count: number };
interface CityStat { key: string; label: string; count: number; center: [number, number] | null; byType: Tally[]; byLocality: Tally[] }

function mergeTallies(lists: Tally[][]): Tally[] {
  const m = new Map<string, number>();
  for (const l of lists) for (const t of l) m.set(t.key, (m.get(t.key) || 0) + t.count);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
}

function timeAgo(at: string): string {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const ACTIVITY_ICON: Record<string, { icon: string; tone: string }> = {
  project: { icon: 'fa-plus', tone: 'green' },
  blog: { icon: 'fa-pen', tone: 'amber' },
  developer: { icon: 'fa-user-group', tone: 'blue' },
  enquiry: { icon: 'fa-comment-dots', tone: 'violet' },
  employee: { icon: 'fa-user-plus', tone: 'green' },
};

function KpiCard({ icon, tone, value, label, growth, onClick }: { icon: string; tone: string; value: number; label: string; growth?: number | null; onClick?: () => void }) {
  return (
    <button type="button" className="ov-kpi" onClick={onClick}>
      <span className={`ov-kpi-ic ${tone}`}><i className={`fas ${icon}`} /></span>
      <span className="ov-kpi-row">
        <span className="ov-kpi-main"><b>{value.toLocaleString('en-IN')}</b><span>{label}</span></span>
        <span className="ov-kpi-delta">
          {growth == null || growth === 0
            ? <em className="flat">—</em>
            : <em className="up"><i className="fas fa-arrow-trend-up" /> {growth}%</em>}
          <small>vs last month</small>
        </span>
      </span>
    </button>
  );
}

function TypeDonut({ slices, total }: { slices: { label: string; count: number; color: string }[]; total: number }) {
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="ov-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${total} projects by type`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eef1ee" strokeWidth="20" />
        {slices.map((s) => {
          const len = total ? (s.count / total) * C : 0;
          const el = <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="20"
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)"><title>{`${s.label}: ${s.count}`}</title></circle>;
          off += len;
          return el;
        })}
        <text x="70" y="70" textAnchor="middle" className="ov-donut-v">{total.toLocaleString('en-IN')}</text>
        <text x="70" y="88" textAnchor="middle" className="ov-donut-l">Projects</text>
      </svg>
      <table className="ov-donut-legend">
        <tbody>
          {slices.map((s) => (
            <tr key={s.label}>
              <td><span className="dot" style={{ background: s.color }} />{s.label}</td>
              <td className="n">{s.count.toLocaleString('en-IN')}</td>
              <td className="p">{total ? Math.round((s.count / total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeadsTrend({ days }: { days: { date: string; count: number }[] }) {
  const W = 520, H = 120, P = { l: 26, r: 10, t: 10, b: 22 };
  const max = Math.max(4, ...days.map((d) => d.count));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, days.length - 1);
  const y = (v: number) => P.t + (1 - v / top) * (H - P.t - P.b);
  const line = days.map((d, i) => `${x(i)},${y(d.count)}`).join(' ');
  const label = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ticks = days.length ? [0, 7, 14, 21, days.length - 1].filter((i) => i < days.length) : [];
  return (
    <svg className="ov-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Enquiries per day, last 30 days">
      {[0, 1, 2, 3, 4].map((k) => (
        <g key={k}>
          <line x1={P.l} x2={W - P.r} y1={y(k * step)} y2={y(k * step)} className="grid" />
          <text x={P.l - 6} y={y(k * step) + 3} textAnchor="end">{k * step}</text>
        </g>
      ))}
      {days.length > 1 && <polygon points={`${x(0)},${y(0)} ${line} ${x(days.length - 1)},${y(0)}`} className="area" />}
      <polyline points={line} className="line" />
      {days.map((d, i) => (
        <circle key={d.date} cx={x(i)} cy={y(d.count)} r={d.count ? 3 : 2} className="pt"><title>{`${label(d.date)}: ${d.count} enquir${d.count === 1 ? 'y' : 'ies'}`}</title></circle>
      ))}
      {ticks.map((i) => <text key={i} x={x(i)} y={H - 4} textAnchor="middle">{label(days[i].date)}</text>)}
    </svg>
  );
}

function DashboardPanel({ s, city, userName, onGo, can }: { s: any; city: string; userName: string; onGo: (t: string) => void; can: (t: string) => boolean }) {
  // A day picked on the "Projects created day by day" calendar (shows its projects).
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); }, []);
  if (!s) return <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>;

  const ch = s.charts || { byStatus: [], byType: [], newProjects: [], enquiries: [], addedThisMonth: 0, hiddenPins: 0 };
  const ov = s.overview || { cities: [], leadsDaily: [], growth: {}, directory: 0, recent: [] };
  const cities: CityStat[] = ov.cities || [];
  const inCity = city ? cities.filter((c) => c.key === city) : cities;
  const cityLabel = city ? (cities.find((c) => c.key === city)?.label || 'this city') : 'all cities';
  const byType = mergeTallies(inCity.map((c) => c.byType));
  const typeTotal = byType.reduce((a, t) => a + t.count, 0);
  const typeSlices = [...byType.slice(0, 4), ...(byType.length > 4 ? [{ key: 'Other', count: byType.slice(4).reduce((a, t) => a + t.count, 0) }] : [])]
    .map((t) => ({ label: t.key, count: t.count, color: TYPE_COLORS[t.key] || TYPE_COLORS.Other }));
  const byLoc = mergeTallies(inCity.map((c) => c.byLocality)).slice(0, 5);
  const locMax = Math.max(1, ...byLoc.map((l) => l.count));

  const publicPins = ch.byStatus.reduce((a: number, x: { count: number }) => a + x.count, 0);
  const statusSlices = ch.byStatus.map((x: { key: string; count: number }) => ({ key: x.key, label: STATUS_META[x.key]?.label || x.key, count: x.count, color: STATUS_META[x.key]?.color || '#9b9a94' }));
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const weekLabel = (w: string) => new Date(w + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const newTotal = ch.newProjects.reduce((a: number, w: { count: number }) => a + w.count, 0);
  const enqTotal = ch.enquiries.reduce((a: number, w: { count: number }) => a + w.count, 0);
  const pending = s.accounts?.pending || 0;
  const daily = ch.daily || { today: '', days: [] };
  const ds = dayStats(daily.days, daily.today);
  const longDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const health = [
    { ok: s.dbOk ? 'ok' : 'bad', b: 'Database', v: s.dbOk ? 'Connected' : 'Error' },
    { ok: 'ok', b: 'Sitemap & robots', v: 'Active' },
    { ok: s.seo?.gsc ? 'ok' : 'warn', b: 'Search Console verification', v: s.seo?.gsc ? 'Set' : 'Not set' },
    { ok: s.seo?.gtm ? 'ok' : 'warn', b: 'Google Tag Manager', v: s.seo?.gtm ? 'Set' : 'Not set' },
    { ok: s.seo?.ga ? 'ok' : 'warn', b: 'Google Analytics 4', v: s.seo?.ga ? 'Set' : 'Not set' },
  ];
  const greeting = hour == null ? 'Welcome' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const leads30 = (ov.leadsDaily || []).reduce((a: number, d: { count: number }) => a + d.count, 0);

  const actions = [
    { k: 'intake', icon: 'fa-plus', tone: 'green', b: 'Add Project', s: 'List a new project' },
    { k: 'developers', icon: 'fa-building', tone: 'amber', b: 'Manage Developers', s: 'Add / edit developers' },
    { k: 'leads', icon: 'fa-user-group', tone: 'blue', b: 'View Leads', s: 'Check new enquiries' },
    { k: 'blogs', icon: 'fa-file-lines', tone: 'violet', b: 'Create Blog', s: 'Publish new content' },
    { k: 'map', icon: 'fa-map', tone: 'teal', b: 'Map Editor', s: 'Edit pins & locations' },
    { k: 'whatsapp', icon: 'fa-whatsapp', brand: true, tone: 'wa', b: 'WhatsApp', s: 'Send updates / campaigns' },
  ].filter((a) => can(a.k));

  return (
    <div className="ov">
      <div className="ov-top">
        <section className="ov-hero">
          <div className="ov-hero-text">
            <small>Welcome back{userName ? `, ${userName}` : ''}</small>
            <h2>{greeting}{userName ? <>,<br /><span className="ov-hero-name">{userName.split(/\s+/)[0]}</span></> : ''}</h2>
            <p>Here&apos;s what&apos;s happening on Mappingg today.</p>
          </div>
          <div className="ov-hero-img" aria-hidden="true" title="Kharadi, Pune — photo: Akshit 77, CC BY-SA 4.0" />
        </section>
        <div className="ov-kpis">
          <KpiCard icon="fa-building" tone="green" value={s.pins ?? 0} label="Projects on Map" growth={ov.growth?.pins} onClick={() => onGo('map')} />
          <KpiCard icon="fa-users" tone="amber" value={ov.directory ?? 0} label="Developers" growth={ov.growth?.developers} onClick={() => onGo('developers')} />
          <KpiCard icon="fa-bullseye" tone="blue" value={s.enquiriesTotal ?? 0} label="Lead Enquiries" growth={ov.growth?.enquiries} onClick={() => onGo('leads')} />
          <KpiCard icon="fa-file-lines" tone="violet" value={s.posts?.published ?? 0} label="Blog Posts" growth={ov.growth?.posts} onClick={() => onGo('blogs')} />
        </div>
      </div>

      {pending > 0 && (
        <button className="dash-alert" onClick={() => onGo('accounts')}>
          <i className="fas fa-user-shield" />
          <span><b>{pending} account{pending === 1 ? '' : 's'} waiting for verification</b> — developers / channel partners can&apos;t use their dashboard until you approve them.</span>
          <span className="dash-alert-go">Review <i className="fas fa-arrow-right" /></span>
        </button>
      )}

      <div className="ov-mid">
        <OverviewMap onOpenEditor={can('map') ? () => onGo('map') : undefined} />
        <div className="ov-side">
          <section className="ov-card">
            <div className="ov-card-head"><h3><i className="fas fa-bolt ov-bolt" /> Quick Actions</h3></div>
            <div className="ov-actions">
              {actions.map((a) => (
                <button type="button" key={a.k} className={`ov-action ${a.tone}`} onClick={() => onGo(a.k)}>
                  <span className="ic"><i className={`${a.brand ? 'fab' : 'fas'} ${a.icon}`} /></span>
                  <i className="fas fa-arrow-right go" />
                  <b>{a.b}</b><small>{a.s}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="ov-card">
            <div className="ov-card-head"><h3><i className="fas fa-file-lines" /> Recent Activity</h3></div>
            {(ov.recent || []).length ? (
              <ul className="ov-activity">
                {ov.recent.map((r: { kind: string; title: string; detail: string; at: string }, i: number) => {
                  const m = ACTIVITY_ICON[r.kind] || ACTIVITY_ICON.project;
                  return (
                    <li key={i}>
                      <span className={`ic ${m.tone}`}><i className={`fas ${m.icon}`} /></span>
                      <span className="t"><b>{r.title}</b><small>{r.detail}</small></span>
                      <time dateTime={r.at}>{timeAgo(r.at)}</time>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="muted ov-none">Nothing new yet.</p>}
          </section>
        </div>
      </div>

      <div className="ov-bottom">
        <section className="ov-card">
          <div className="ov-card-head"><h3>Projects by Type</h3><span className="ov-chip">{city ? cityLabel : 'All locations'}</span></div>
          {typeTotal ? <TypeDonut slices={typeSlices} total={typeTotal} /> : <p className="muted ov-none">No projects in {cityLabel} yet.</p>}
        </section>
        <section className="ov-card">
          <div className="ov-card-head"><h3>Top Locations (Projects)</h3><span className="ov-chip">{city ? cityLabel : 'All locations'}</span></div>
          {byLoc.length ? (
            <div className="ov-bars">
              {byLoc.map((l, i) => (
                <div className="ov-bar" key={l.key}>
                  <span className="n">{l.key}</span>
                  <span className="track"><span style={{ width: `${(l.count / locMax) * 100}%`, opacity: 1 - i * 0.12 }} /></span>
                  <span className="v">{l.count.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted ov-none">No localities in {cityLabel} yet.</p>}
        </section>
        <section className="ov-card">
          <div className="ov-card-head"><h3>Leads Trend</h3><span className="ov-chip">Last 30 days · {leads30}</span></div>
          <LeadsTrend days={ov.leadsDaily || []} />
        </section>
      </div>

      <h3 className="ov-more">More insights</h3>
      <div className="viz">
        <ChartCard
          title="Projects created day by day"
          subtitle="Each square is one day (India time) for the last 6 months — grey means no new projects that day. Click a day to see its projects."
          table={{ head: ['Day', 'Projects created'], rows: [...daily.days].filter((d: { count: number }) => d.count > 0).reverse().map((d: { date: string; count: number }) => [longDay(d.date), d.count]) }}
        >
          {(show, hide) => (
            <>
              <div className={`day-today ${ds.todayCount ? 'yes' : 'no'}`}>
                <i className={`fas ${ds.todayCount ? 'fa-circle-check' : 'fa-circle-minus'}`} aria-hidden="true" />
                <span>{ds.todayCount
                  ? <b>Today: {ds.todayCount} project{ds.todayCount === 1 ? '' : 's'} created</b>
                  : <><b>Today: no projects created yet</b>{ds.lastActive ? <> · last new project on {longDay(ds.lastActive)}</> : null}</>}</span>
              </div>
              <div className="day-stats">
                <div><b>{ds.activeDays}</b><span>days with new projects<br /><small>out of {ds.totalDays}</small></span></div>
                <div><b>{ds.totalDays - ds.activeDays}</b><span>days with none</span></div>
                <div><b>{ds.streak}</b><span>day streak<br /><small>in a row, up to today</small></span></div>
                <div><b>{ds.busiest ? ds.busiest.count : 0}</b><span>busiest day<br /><small>{ds.busiest ? longDay(ds.busiest.date) : '—'}</small></span></div>
              </div>
              <DayHeatmap days={daily.days} today={daily.today} show={show} hide={hide}
                picked={pickedDay} onPick={(d) => setPickedDay((cur) => (cur === d ? null : d))} />
              {pickedDay && <DayProjects date={pickedDay} onClose={() => setPickedDay(null)} />}
            </>
          )}
        </ChartCard>

        <div className="viz-grid2">
          <ChartCard
            title="Projects by status" subtitle="Same colours as the live map"
            table={{ head: ['Status', 'Projects', 'Share'], rows: statusSlices.map((x: { label: string; count: number }) => [x.label, x.count, `${pct(x.count, publicPins)}%`]) }}
          >
            {(show, hide) => <Donut slices={statusSlices} centerValue={publicPins.toLocaleString('en-IN')} centerLabel="public projects" show={show} hide={hide} />}
          </ChartCard>
          <div className="adm-panel">
            <div className="adm-panel-head"><h3>Website health</h3><button className="adm-btn ghost sm" onClick={() => onGo('seo')}>Full report</button></div>
            <div className="adm-health">
              {health.map((h) => (
                <div className="adm-health-row" key={h.b}><span className={`dot ${h.ok}`} /><div><b>{h.b}</b></div><span className="val">{h.v}</span></div>
              ))}
              <div className="adm-health-row"><span className="dot ok" /><div><b>Infrastructure &amp; roads</b></div><span className="val">{s.infra ?? 0} markers · {s.roads ?? 0} roads</span></div>
            </div>
          </div>
        </div>

        <div className="viz-grid2">
          <ChartCard
            title="Projects added per week" subtitle={`${newTotal} in the last 12 weeks`}
            table={{ head: ['Week of', 'New projects'], rows: ch.newProjects.map((w: { week: string; count: number }) => [weekLabel(w.week), w.count]) }}
          >
            {(show, hide) => <WeekColumns data={ch.newProjects} noun={['project', 'projects']} show={show} hide={hide} />}
          </ChartCard>
          <ChartCard
            title="Enquiries per week" subtitle={enqTotal ? `${enqTotal} in the last 12 weeks` : 'No enquiries in the last 12 weeks yet'}
            table={{ head: ['Week of', 'Enquiries'], rows: ch.enquiries.map((w: { week: string; count: number }) => [weekLabel(w.week), w.count]) }}
          >
            {(show, hide) => <WeekColumns data={ch.enquiries} noun={['enquiry', 'enquiries']} show={show} hide={hide} />}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Map editor ------------------------------ */
function MapPanel() {
  return (
    <div className="adm-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <iframe title="Map editor" src="/dashboard/s-admin/map" className="adm-frame" />
    </div>
  );
}

/* ---------------------------- Projects Intake ---------------------------- */
// The partners intake app (bulk CSV/Excel upload, review queue, builders &
// links, live projects) runs as a self-contained app under /s-admin and is
// embedded here so it lives inside the super admin too. It shares this session.
// `hash` opens a specific screen, e.g. #/review/<id> for "Edit all details" on a pin;
// changing only the hash navigates inside the already-loaded app (no reload).
function IntakePanel({ hash = '' }: { hash?: string }) {
  return (
    <div className="adm-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <iframe title="Projects intake" src={`/intake${hash}`} className="adm-frame" />
    </div>
  );
}

/* --------------------------------- SEO ----------------------------------- */
function SeoPanel() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch('/api/admin/seo-insights', { credentials: 'same-origin' })
      .then((r) => r.json()).then((b) => (b?.data ? setD(b.data) : setErr(true))).catch(() => setErr(true));
  }, []);
  if (err) return <div className="adm-empty"><i className="fas fa-triangle-exclamation" /><p>Could not load SEO data.</p></div>;
  if (!d) return <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>;

  const scorePct = Math.round((d.score.passed / d.score.total) * 100);
  const compRows = [...d.completeness]
    .map((c: { label: string; count: number; total: number }) => ({ label: c.label, value: c.total ? Math.round((c.count / c.total) * 100) : 0, count: c.count, total: c.total }))
    .sort((a, b) => a.value - b.value);
  const areaRows = [...d.areas.top.map((a: { area: string; count: number }) => ({ label: a.area, value: a.count })),
    ...(d.areas.other ? [{ label: `Other ${d.areas.distinct - d.areas.top.length} areas`, value: d.areas.other }] : [])];
  const areaMax = Math.max(...areaRows.map((r) => r.value), 1);
  const newTotal = d.newProjects.reduce((a: number, w: { count: number }) => a + w.count, 0);
  const enqTotal = d.enquiries.reduce((a: number, w: { count: number }) => a + w.count, 0);
  const weekLabel = (w: string) => new Date(w + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const steps = [
    ['Verify your domain', 'Paste the Search Console value in Settings, then click Verify in Google Search Console.'],
    ['Submit the sitemap', 'In Search Console → Sitemaps, submit /sitemap.xml.'],
    ['Fill in project details', 'Descriptions, Key USP, location and MahaRERA numbers make each project page rank for real searches.'],
    ['Publish blogs regularly', 'Target real searches like “2 BHK in Kharadi price”. Each post is a rankable page.'],
    ['Build links', 'Share on Instagram, WhatsApp, Google Business Profile & partner sites.'],
  ];

  return (
    <div className="viz">
      <TrafficPanel />

      <h2 className="gsc-title" style={{ marginTop: 12 }}><i className="fas fa-heart-pulse" /> Site health &amp; content</h2>
      <div className="viz-tiles">
        <StatTile label="SEO health score" value={`${scorePct}%`} meter={scorePct} note={`${d.score.passed} of ${d.score.total} checks passing`} />
        <StatTile label="Project page completeness" value={`${d.avgCompleteness}%`} meter={d.avgCompleteness} note="Average across the details below" />
        <StatTile label="Public projects" value={d.projects.public.toLocaleString('en-IN')} note={d.projects.hidden ? `${d.projects.hidden} hidden from the public map` : 'All visible on the live map'} />
        <StatTile label="Pages in sitemap" value={String(d.sitemap.total)} note={`${d.sitemap.pages} site pages · ${d.sitemap.blog} blog posts`} />
      </div>

      <ChartCard
        title="What project pages are missing"
        subtitle={`Share of the ${d.projects.public} public projects that have each detail — the weakest are at the top. Fuller pages rank better.`}
        table={{ head: ['Detail', 'Projects with it', 'Share'], rows: compRows.map((r) => [r.label, `${r.count} / ${r.total}`, `${r.value}%`]) }}
      >
        {(show, hide) => (
          <HBars rows={compRows} max={100} unit="%" show={show} hide={hide} valueText={(v) => String(v)}
            tipLines={(r) => { const c = compRows.find((x) => x.label === r.label)!; return [`${c.count} of ${c.total} projects`, `${c.total - c.count} still missing it`]; }} />
        )}
      </ChartCard>

      <div className="viz-grid2">
        <ChartCard
          title="Projects by status"
          subtitle="Same colours as the live map"
          table={{ head: ['Status', 'Projects', 'Share'], rows: d.byStatus.map((s: { key: string; count: number }) => [STATUS_META[s.key]?.label || s.key, s.count, `${d.projects.public ? Math.round((s.count / d.projects.public) * 100) : 0}%`]) }}
        >
          {(show, hide) => <StatusStack data={d.byStatus} show={show} hide={hide} />}
        </ChartCard>

        <ChartCard
          title="Top areas covered"
          subtitle={`${d.areas.distinct} areas in total — each is a local search you can rank for`}
          table={{ head: ['Area', 'Projects'], rows: areaRows.map((r) => [r.label, r.value]) }}
        >
          {(show, hide) => (
            <HBars rows={areaRows} max={areaMax} show={show} hide={hide} valueText={(v) => String(v)}
              tipLines={(r) => [`${r.value} project${r.value === 1 ? '' : 's'}`]} muted={(l) => l.startsWith('Other ')} />
          )}
        </ChartCard>
      </div>

      <div className="viz-grid2">
        <ChartCard
          title="New projects per week"
          subtitle={`${newTotal} added in the last 12 weeks — fresh content helps rankings`}
          table={{ head: ['Week of', 'New projects'], rows: d.newProjects.map((w: { week: string; count: number }) => [weekLabel(w.week), w.count]) }}
        >
          {(show, hide) => <WeekColumns data={d.newProjects} noun={['project', 'projects']} show={show} hide={hide} />}
        </ChartCard>

        <ChartCard
          title="Enquiries per week"
          subtitle={enqTotal ? `${enqTotal} enquiries in the last 12 weeks` : 'No enquiries recorded in the last 12 weeks yet'}
          table={{ head: ['Week of', 'Enquiries'], rows: d.enquiries.map((w: { week: string; count: number }) => [weekLabel(w.week), w.count]) }}
        >
          {(show, hide) => <WeekColumns data={d.enquiries} noun={['enquiry', 'enquiries']} show={show} hide={hide} />}
        </ChartCard>
      </div>

      <div className="viz-grid2">
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Health checks</h3><span className="muted">{d.score.passed}/{d.score.total} passing</span></div>
          <div className="adm-health">
            {d.health.map((h: { label: string; ok: boolean; fix?: string }) => (
              <div className="adm-health-row" key={h.label}>
                <i className={`fas ${h.ok ? 'fa-circle-check' : 'fa-circle-exclamation'} viz-check ${h.ok ? 'ok' : 'warn'}`} aria-hidden="true" />
                <div><b>{h.label}</b></div>
                <span className="val">{h.ok ? 'OK' : h.fix || 'Needs attention'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Get ranked on Google — checklist</h3></div>
          <div className="adm-health">
            {steps.map(([t, desc], i) => (
              <div className="adm-health-row" key={t}><span className="viz-step">{i + 1}</span><div><b>{t}</b><br /><span className="muted">{desc}</span></div></div>
            ))}
          </div>
          <p className="adm-note" style={{ marginTop: 16 }}><i className="fas fa-lightbulb" /><span>Google search clicks, impressions and rankings are in the Search Console section below. Tag IDs in use: Search Console <code>{d.tags?.gsc}</code>, GTM <code>{d.tags?.gtm}</code>, GA4 <code>{d.tags?.ga}</code>.</span></p>
        </div>
      </div>

      {/* Google Search Console — kept at the bottom of SEO & Health. */}
      <SearchConsolePanel />
    </div>
  );
}

/* -------------------------------- Blogs ---------------------------------- */
interface Post {
  id: string; slug: string; title: string; status: 'draft' | 'published';
  cover_image?: string; tags?: string[]; created_at?: string; updated_at?: string; published_at?: string | null;
}
// Category chip colours, picked from the category name so each keeps its colour.
const CAT_COLORS = ['#2a78d6', '#7c4ddb', '#0f7a55', '#c98a2c', '#d1435b', '#1baf7a', '#b0924f', '#3b6ea5'];
function catColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return name === 'Uncategorised' ? '#9b9a94' : CAT_COLORS[h % CAT_COLORS.length];
}
const EMPTY_BLOG = { title: '', slug: '', excerpt: '', content: '', cover_image: '', tags: '', author: 'Mappingg Team', seo_title: '', seo_description: '' };

function BlogsPanel({ flash, onGo }: { flash: (m: string, e?: boolean) => void; onGo?: (t: string) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  // Page views per post slug (null = not available).
  const [views, setViews] = useState<Record<string, number> | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = usePersistedState<'all' | 'published' | 'draft'>('blogs-status', 'all', ['all', 'published', 'draft']);
  const [sort, setSort] = usePersistedState<'latest' | 'oldest' | 'views' | 'title'>('blogs-sort', 'latest', ['latest', 'oldest', 'views', 'title']);
  const [cat, setCat] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(EMPTY_BLOG);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/blogs', { credentials: 'same-origin' });
      const b = await r.json();
      setPosts(Array.isArray(b.data) ? b.data : []);
      setViews(b.views && typeof b.views === 'object' ? b.views : null);
    } catch { flash('Could not load posts', true); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditId(null); setForm(EMPTY_BLOG); setView('form'); }
  async function openEdit(id: string) {
    try {
      const r = await fetch(`/api/admin/blogs?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      const b = await r.json(); const p = b.data;
      if (!p) throw new Error();
      setForm({ ...EMPTY_BLOG, ...p, tags: (p.tags || []).join(', ') });
      setEditId(id); setView('form');
    } catch { flash('Could not open post', true); }
  }
  const sel = useSelection();
  async function remove(p: Post) {
    if (!confirm(`Delete “${p.title}”? It moves to Backups → Recycle bin, where you can restore it.`)) return;
    await removeMany([p.id]);
  }
  async function removeMany(ids: string[]) {
    try {
      const r = await fetch(`/api/admin/blogs?ids=${ids.map(encodeURIComponent).join(',')}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setPosts((l) => l.filter((x) => !ids.includes(x.id))); sel.clear();
      flash(`${ids.length === 1 ? 'Post' : `${ids.length} posts`} moved to the recycle bin`);
    } catch { flash('Delete failed', true); }
  }
  // Publish / unpublish several posts: re-save each with the new status.
  async function setStatusMany(ids: string[], status: 'draft' | 'published') {
    let ok = 0;
    for (const id of ids) {
      try {
        const g = await fetch(`/api/admin/blogs?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' }).then((r) => r.json());
        const p = g.data; if (!p) continue;
        const r = await fetch('/api/admin/blogs', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ id, title: p.title, slug: p.slug, excerpt: p.excerpt, content: p.content, cover_image: p.cover_image, tags: p.tags || [],
            author: p.author, seo_title: p.seo_title, seo_description: p.seo_description, status }),
        });
        if (r.ok) ok++;
      } catch { /* counted as failed */ }
    }
    sel.clear(); load();
    flash(`${ok} post${ok === 1 ? '' : 's'} ${status === 'published' ? 'published' : 'moved to drafts'}${ok < ids.length ? `, ${ids.length - ok} failed` : ''}`, ok < ids.length);
  }
  function onCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2_000_000) return flash('Image too large (max 2 MB) — use a URL', true);
    const rd = new FileReader(); rd.onload = () => setForm((f: any) => ({ ...f, cover_image: String(rd.result || '') })); rd.readAsDataURL(file);
  }
  async function save(status: 'draft' | 'published') {
    if (!form.title.trim()) return flash('Add a title first', true);
    setSaving(true);
    const payload: any = {
      title: form.title, slug: form.slug || undefined, excerpt: form.excerpt, content: form.content,
      cover_image: form.cover_image, tags: String(form.tags).split(',').map((t: string) => t.trim()).filter(Boolean),
      author: form.author, seo_title: form.seo_title, seo_description: form.seo_description, status,
    };
    if (editId) payload.id = editId;
    try {
      const r = await fetch('/api/admin/blogs', {
        method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(payload),
      });
      if (!r.ok) {
        // Say what to fix (field too long etc.) instead of a bare "Save failed".
        const b = await r.json().catch(() => null);
        const why = b?.error?.message && b.error.message !== 'Invalid post' ? b.error.message
          : r.status === 413 ? 'The post is too large — use a cover image URL instead of uploading, or shorten the content.'
          : r.status === 401 ? 'Your session has expired — sign in again.' : `Server error (${r.status}).`;
        flash(`Not saved: ${why}`, true);
        return;
      }
      flash(status === 'published' ? 'Published!' : 'Saved as draft');
      setView('list'); load();
    } catch { flash('Not saved: could not reach the server — check your connection and try again.', true); } finally { setSaving(false); }
  }
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));
  const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  if (view === 'form') {
    return (
      <>
        <div className="adm-panel">
          <div className="adm-panel-head">
            <h3>{editId ? 'Edit post' : 'New post'}</h3>
            <button className="adm-btn ghost sm" onClick={() => setView('list')}><i className="fas fa-arrow-left" /> Back</button>
          </div>
          <div className="adm-field"><label>Title</label><input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Top 5 areas to buy a home in Pune (2026)" /></div>
          <div className="adm-grid2">
            <div className="adm-field"><label>Slug <small>(blank = auto)</small></label><input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="top-areas-to-buy-pune-2026" /></div>
            <div className="adm-field"><label>Tags <small>(comma separated)</small></label><input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="Pune, Investment, Guide" /></div>
          </div>
          <div className="adm-field"><label>Excerpt</label><input value={form.excerpt} onChange={(e) => set('excerpt', e.target.value)} placeholder="Short summary for listings & search." /></div>
          <div className="adm-grid2">
            <div className="adm-field"><label>Cover image URL</label><input value={String(form.cover_image).startsWith('data:') ? '' : form.cover_image} onChange={(e) => set('cover_image', e.target.value)} placeholder="https://…" /></div>
            <div className="adm-field"><label>…or upload <small>(max 2 MB)</small></label><input type="file" accept="image/*" onChange={onCover} /></div>
          </div>
          {form.cover_image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="adm-cover" src={form.cover_image} alt="Cover" style={{ marginBottom: 14 }} />
          ) : null}
          <div className="adm-field"><label>Content <small>(HTML supported)</small></label><textarea value={form.content} onChange={(e) => set('content', e.target.value)} placeholder={'<h2>Heading</h2>\n<p>Write your article…</p>'} /></div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>SEO</h3></div>
          <div className="adm-field"><label>SEO title <small>(defaults to title)</small></label><input value={form.seo_title} onChange={(e) => set('seo_title', e.target.value)} /></div>
          <div className="adm-field"><label>Meta description</label><input value={form.seo_description} onChange={(e) => set('seo_description', e.target.value)} placeholder="150–160 characters for Google" /></div>
          <div className="adm-actions" style={{ marginTop: 8 }}>
            <button className="adm-btn primary" disabled={saving} onClick={() => save('published')}><i className="fas fa-globe" /> {saving ? 'Saving…' : 'Publish'}</button>
            <button className="adm-btn ghost" disabled={saving} onClick={() => save('draft')}><i className="fas fa-floppy-disk" /> Save draft</button>
          </div>
        </div>
      </>
    );
  }

  // ---- list view: filters, categories (each post's first tag), views
  const totalViews = views ? Object.values(views).reduce((a, n) => a + n, 0) : null;
  const viewsOf = (p: Post) => (views ? views[p.slug] || 0 : null);
  const catOf = (p: Post) => (p.tags && p.tags[0] ? p.tags[0] : 'Uncategorised');
  const published = posts.filter((p) => p.status === 'published').length;
  const drafts = posts.filter((p) => p.status !== 'published');
  const cats = (() => {
    const m = new Map<string, number>();
    for (const p of posts) m.set(catOf(p), (m.get(catOf(p)) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  })();
  const t = q.trim().toLowerCase();
  const shown = posts
    .filter((p) => (status === 'all' ? true : status === 'published' ? p.status === 'published' : p.status !== 'published'))
    .filter((p) => !cat || catOf(p) === cat)
    .filter((p) => !t || [p.title, p.slug, ...(p.tags || [])].some((v) => v && v.toLowerCase().includes(t)))
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'views') return (viewsOf(b) || 0) - (viewsOf(a) || 0);
      const d = String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
      return sort === 'oldest' ? -d : d;
    });
  const shownIds = shown.map((p) => p.id);
  const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n));
  async function copyLink(p: Post) {
    try { await navigator.clipboard.writeText(`${window.location.origin}/blog/${p.slug}`); flash('Link copied'); } catch { flash('Could not copy the link', true); }
  }

  return (
    <div className="bg">
      <section className="bg-head">
        <div className="bg-title">
          <span className="bg-title-ic"><i className="fas fa-file-lines" /></span>
          <div><h2>Blogs</h2><p>Create, manage and publish blog posts for Mappingg.com</p></div>
        </div>
        <div className="bg-stats">
          <button type="button" className={`bg-stat green${status === 'all' ? ' on' : ''}`} onClick={() => { setStatus('all'); setCat(''); }}>
            <span className="ic"><i className="fas fa-file-lines" /></span><span><b>{posts.length}</b><small>Total Posts</small></span>
          </button>
          <button type="button" className={`bg-stat teal${status === 'published' ? ' on' : ''}`} onClick={() => setStatus('published')}>
            <span className="ic"><i className="fas fa-check" /></span><span><b>{published}</b><small>Published</small></span>
          </button>
          <button type="button" className={`bg-stat amber${status === 'draft' ? ' on' : ''}`} onClick={() => setStatus('draft')}>
            <span className="ic"><i className="far fa-clock" /></span><span><b>{drafts.length}</b><small>Drafts</small></span>
          </button>
          <div className="bg-stat rose" title="Page views of all blog posts over the last 180 days (signed-in team members are not counted)">
            <span className="ic"><i className="fas fa-eye" /></span><span><b>{totalViews == null ? '—' : compact(totalViews)}</b><small>Total Views</small></span>
          </div>
        </div>
        <button type="button" className="bg-new" onClick={openNew}><i className="fas fa-plus" /> New Blog Post</button>
      </section>

      <div className="bg-body">
        <section className="bg-card bg-main">
          <div className="bg-card-head">
            <h3>{cat ? `${cat} (${shown.length})` : `All Blog Posts (${posts.length})`}</h3>
            <div className="bg-tools">
              <label className="bg-search">
                <i className="fas fa-magnifying-glass" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search posts by title, slug…" aria-label="Search posts" />
              </label>
              <select className="ov-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
                <option value="all">All Status</option>
                <option value="published">Published</option>
                <option value="draft">Drafts</option>
              </select>
              <select className="ov-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                <option value="latest">Latest First</option>
                <option value="oldest">Oldest First</option>
                <option value="views">Most Viewed</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
          ) : posts.length === 0 ? (
            <div className="adm-empty"><i className="fas fa-newspaper" /><p>No posts yet. Create your first SEO article.</p></div>
          ) : (
            <>
              {sel.of(shownIds).length > 0 && (
                <BulkBar sel={sel} ids={shownIds} hint="">
                  <button className="adm-btn primary sm" onClick={() => setStatusMany(sel.of(shownIds), 'published')}><i className="fas fa-globe" /> Publish</button>
                  <button className="adm-btn ghost sm" onClick={() => setStatusMany(sel.of(shownIds), 'draft')}><i className="fas fa-eye-slash" /> Make draft</button>
                  <button className="adm-btn danger sm" onClick={() => { const ids = sel.of(shownIds); if (confirm(`Delete ${ids.length} post${ids.length === 1 ? '' : 's'}? They move to Backups → Recycle bin, where you can restore them.`)) removeMany(ids); }}><i className="fas fa-trash" /> Delete</button>
                </BulkBar>
              )}
              {shown.length === 0 ? (
                <div className="adm-empty"><i className="fas fa-filter" /><p>No posts match these filters.</p>
                  <button className="adm-btn ghost sm" onClick={() => { setQ(''); setStatus('all'); setCat(''); }}>Show all posts</button></div>
              ) : (
                <div className="bg-table-wrap">
                  <table className="bg-table">
                    <thead>
                      <tr>
                        <th className="pick"><PickAll sel={sel} ids={shownIds} label="Select all shown posts" /></th>
                        <th>#</th><th>Thumbnail</th><th>Title</th><th>Slug</th><th>Status</th><th>Category</th><th>Views</th><th>Updated</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p, i) => (
                        <tr key={p.id} className={sel.has(p.id) ? 'picked' : undefined}>
                          <td className="pick"><PickOne sel={sel} id={p.id} label={p.title} /></td>
                          <td className="num">{i + 1}</td>
                          <td className="thumb">
                            {p.cover_image
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={p.cover_image} alt="" loading="lazy" />
                              : <span className="ph"><i className="far fa-image" /></span>}
                          </td>
                          <td className="title"><button type="button" onClick={() => openEdit(p.id)}>{p.title}</button></td>
                          <td className="slug">{p.slug}</td>
                          <td><span className={`bg-status ${p.status === 'published' ? 'pub' : 'draft'}`}>{p.status === 'published' ? 'Published' : 'Draft'}</span></td>
                          <td><button type="button" className="bg-cat" style={{ ['--c' as string]: catColor(catOf(p)) }} onClick={() => setCat(catOf(p))} title={(p.tags || []).join(', ') || 'No tags'}>{catOf(p)}</button></td>
                          <td className="views">{viewsOf(p) == null ? '—' : viewsOf(p)!.toLocaleString('en-IN')}</td>
                          <td className="date">{fmt(p.updated_at || p.created_at)}</td>
                          <td>
                            <div className="bg-acts">
                              <button type="button" onClick={() => openEdit(p.id)} title="Edit" aria-label={`Edit ${p.title}`}><i className="fas fa-pen" /></button>
                              {p.status === 'published'
                                ? <a href={`/blog/${p.slug}`} target="_blank" rel="noopener" title="Open on the website" aria-label="Open on the website"><i className="fas fa-arrow-up-right-from-square" /></a>
                                : <span className="off" title="Drafts are not on the website yet"><i className="fas fa-arrow-up-right-from-square" /></span>}
                              <div className="bg-more">
                                <button type="button" onClick={() => setMenuFor((m) => (m === p.id ? null : p.id))} title="More" aria-label="More actions" aria-expanded={menuFor === p.id}><i className="fas fa-ellipsis-vertical" /></button>
                                {menuFor === p.id && (
                                  <div className="bg-menu" onMouseLeave={() => setMenuFor(null)}>
                                    {p.status === 'published'
                                      ? <button type="button" onClick={() => { setMenuFor(null); setStatusMany([p.id], 'draft'); }}><i className="fas fa-eye-slash" /> Make draft</button>
                                      : <button type="button" onClick={() => { setMenuFor(null); setStatusMany([p.id], 'published'); }}><i className="fas fa-globe" /> Publish</button>}
                                    {p.status === 'published' && <button type="button" onClick={() => { setMenuFor(null); copyLink(p); }}><i className="fas fa-link" /> Copy link</button>}
                                    <button type="button" className="danger" onClick={() => { setMenuFor(null); remove(p); }}><i className="fas fa-trash" /> Delete</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="bg-side">
          <section className="bg-card">
            <h3>Quick Actions</h3>
            <div className="bg-quick">
              <button type="button" className="primary" onClick={openNew}><i className="fas fa-plus" /> New Blog Post</button>
              <button type="button" onClick={() => document.getElementById('bg-cats')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><i className="fas fa-folder" /> Manage Categories</button>
              {onGo && <button type="button" onClick={() => onGo('seo')}><i className="fas fa-chart-column" /> SEO &amp; Analytics</button>}
              <a href="/blog" target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> View blog</a>
            </div>
          </section>

          <section className="bg-card" id="bg-cats">
            <div className="bg-card-head sm"><h3>Categories</h3>{cat && <button type="button" className="bg-link" onClick={() => setCat('')}>Clear</button>}</div>
            <ul className="bg-cats">
              <li><button type="button" className={!cat ? 'on' : ''} onClick={() => setCat('')}><span className="dot" style={{ background: 'var(--forest)' }} />All Categories<b>{posts.length}</b></button></li>
              {cats.map(([c, n]) => (
                <li key={c}><button type="button" className={cat === c ? 'on' : ''} onClick={() => setCat(c)}><span className="dot" style={{ background: catColor(c) }} />{c}<b>{n}</b></button></li>
              ))}
            </ul>
            <p className="bg-hint">A post&apos;s category is its first tag — change it in the post&apos;s Tags field.</p>
          </section>

          <section className="bg-card">
            <div className="bg-card-head sm"><h3>Recent Drafts</h3>{drafts.length > 0 && <button type="button" className="bg-link" onClick={() => { setStatus('draft'); setCat(''); }}>View all</button>}</div>
            {drafts.length ? (
              <ul className="bg-drafts">
                {[...drafts].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 4).map((p) => (
                  <li key={p.id}><button type="button" onClick={() => openEdit(p.id)}><i className="far fa-file-lines" /><span><b>{p.title}</b><small>Edited {fmt(p.updated_at || p.created_at)}</small></span></button></li>
                ))}
              </ul>
            ) : (
              <div className="bg-nodrafts">
                <i className="far fa-file-lines" />
                <p>No draft posts</p>
                <button type="button" className="bg-link" onClick={openNew}>Create a new blog post <i className="fas fa-arrow-right" /></button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------ Employees -------------------------------- */
interface Emp { id: string; email: string; name?: string; permissions: string[]; mobile?: string; avatar?: string; created_at?: string; last_login_at?: string; login_count?: number; }

function EmployeesPanel({ flash, owner, onProfile }: {
  flash: (m: string, e?: boolean) => void;
  /** The signed-in super admin, listed first. */
  owner?: { name?: string; email: string; avatar?: string };
  onProfile?: () => void;
}) {
  const [list, setList] = useState<Emp[]>([]);
  const [pane, setPane] = usePersistedState<'employees' | 'roles' | 'activity'>('team.pane', 'employees', ['employees', 'roles', 'activity']);
  const [q, setQ] = useState('');
  const [perm, setPerm] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Activity Log: what the team did on leads (same feed as Leads → Team activity).
  const [feed, setFeed] = useState<LeadEvent[] | null>(null);
  const [feedWho, setFeedWho] = useState('');
  async function loadFeed() {
    setFeed(null);
    try {
      const r = await fetch('/api/admin/leads?activity=1', { credentials: 'same-origin' });
      const b = await r.json();
      setFeed(r.ok && Array.isArray(b.data) ? b.data : []);
    } catch { setFeed([]); }
  }
  useEffect(() => { if (pane === 'activity') loadFeed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const [mobile, setMobile] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/employees', { credentials: 'same-origin' });
      const b = await r.json();
      setList(Array.isArray(b.data) ? b.data : []);
    } catch { flash('Could not load employees', true); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditId(null); setName(''); setEmail(''); setPassword(''); setPerms([]); setMobile(''); setView('form'); }
  function openEdit(e: Emp) { setEditId(e.id); setName(e.name || ''); setEmail(e.email); setPassword(''); setPerms(e.permissions || []); setMobile(e.mobile || ''); setView('form'); }
  function togglePerm(k: string) { setPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])); }

  async function save() {
    if (!editId && (!email.trim() || password.length < 8)) return flash('Email and a password (8+ chars) are required', true);
    setSaving(true);
    try {
      const payload: any = { name, permissions: perms, mobile };
      let r;
      if (editId) {
        payload.id = editId; if (password) payload.password = password;
        r = await fetch('/api/admin/employees', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
      } else {
        payload.email = email.trim(); payload.password = password;
        r = await fetch('/api/admin/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
      }
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Failed');
      flash(editId ? 'Employee updated' : 'Employee added'); setView('list'); load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Save failed', true); } finally { setSaving(false); }
  }
  const sel = useSelection();
  async function remove(e: Emp) {
    if (!confirm(`Remove ${e.email}? They will lose access. You can restore them from Backups → Recycle bin.`)) return;
    await removeMany([e.id]);
  }
  async function removeMany(ids: string[]) {
    try {
      const r = await fetch(`/api/admin/employees?ids=${ids.map(encodeURIComponent).join(',')}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setList((l) => l.filter((x) => !ids.includes(x.id))); sel.clear();
      flash(`${ids.length === 1 ? 'Employee' : `${ids.length} employees`} removed — kept in the recycle bin`);
    } catch { flash('Delete failed', true); }
  }

  if (view === 'form') {
    return (
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>{editId ? 'Edit employee' : 'Add employee'}</h3>
          <button className="adm-btn ghost sm" onClick={() => setView('list')}><i className="fas fa-arrow-left" /> Back</button>
        </div>
        <div className="adm-grid2">
          <div className="adm-field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" /></div>
          <div className="adm-field"><label>Email {editId && <small>(cannot change)</small>}</label><input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!editId} placeholder="employee@example.com" /></div>
        </div>
        <div className="adm-field">
          <label>WhatsApp number <small>(to send them leads on WhatsApp)</small></label>
          <PhoneInput value={mobile} onChange={setMobile} />
        </div>
        <div className="adm-field">
          <label>{editId ? 'Reset password ' : 'Password '}<small>{editId ? '(leave blank to keep current)' : '(min 8 characters)'}</small></label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editId ? '••••••••' : 'Set a password they will use to log in'} />
        </div>
        <div className="adm-field"><label>Access — which tabs can they use?</label></div>
        <div className="adm-perms">
          {GRANTABLE.map((g) => (
            <button type="button" key={g.key} className={`adm-perm${perms.includes(g.key) ? ' on' : ''}`} onClick={() => togglePerm(g.key)}>
              <span className="ic"><i className={`fas ${g.icon}`} /></span>
              <span className="t"><b>{g.label}</b><small>{g.desc}</small></span>
              <i className={`fas ${perms.includes(g.key) ? 'fa-circle-check' : 'fa-circle'} chk`} />
            </button>
          ))}
        </div>
        <p className="adm-note" style={{ marginTop: 4 }}><i className="fas fa-circle-info" /><span>Everyone can see the Dashboard and their own Profile. They sign in from the website’s Sign-in with the email &amp; password you set here.</span></p>
        <div className="adm-actions" style={{ marginTop: 16 }}>
          <button className="adm-btn primary" disabled={saving} onClick={save}><i className="fas fa-floppy-disk" /> {saving ? 'Saving…' : editId ? 'Save changes' : 'Add employee'}</button>
        </div>
      </div>
    );
  }

  // ---- list view
  const ACTIVE_DAYS = 30;
  const isActive = (e: { last_login_at?: string }) => !!e.last_login_at && Date.now() - new Date(e.last_login_at).getTime() < ACTIVE_DAYS * 86_400_000;
  const fullAccess = (e: Emp) => GRANTABLE.every((g) => e.permissions.includes(g.key));
  const activeN = list.filter(isActive).length;
  const t = q.trim().toLowerCase();
  const shown = list.filter((e) =>
    (!t || [e.name, e.email, e.mobile, ...e.permissions.map((p) => TAB_META[p]?.label)].some((v) => v && v.toLowerCase().includes(t)))
    && (!perm || (perm === '__full' ? fullAccess(e) : perm === '__none' ? !e.permissions.length : e.permissions.includes(perm)))
    && (!status || (status === 'active' ? isActive(e) : !isActive(e))));
  const ownerShown = !!owner && (!t || [owner.name, owner.email, 'super admin'].some((v) => v && v.toLowerCase().includes(t))) && (!perm || perm === '__full') && status !== 'inactive';
  const ini = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const AV_TONES = ['#0f5c47', '#2a78d6', '#7c4ddb', '#c98a2c', '#d1435b', '#0f7a55'];
  const avTone = (s: string) => AV_TONES[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % AV_TONES.length];
  const day = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const ids = shown.map((e) => e.id);

  return (
    <div className="tm">
      <PageHead icon="fa-users-gear" title="Team & Administration" sub="Manage team members, their access to each section and what they do on leads.">
        <button type="button" className="pg-btn" onClick={openNew}><i className="fas fa-plus" /> Add Employee</button>
      </PageHead>

      <div className="pg-tabs" role="tablist">
        {([['employees', 'Employees'], ['roles', 'Access Roles'], ['activity', 'Activity Log']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={pane === k} className={pane === k ? 'on' : ''} onClick={() => { setPane(k); if (k === 'activity' && feed === null) loadFeed(); }}>{l}</button>
        ))}
      </div>

      {pane === 'employees' && (
        <>
          <div className="sc-row four">
            <StatCard icon="fa-users" tone="violet" value={list.length} label="Total Employees" on={!status && !perm} onClick={() => { setStatus(''); setPerm(''); }} />
            <StatCard icon="fa-user-check" tone="green" value={activeN} label="Active" on={status === 'active'} onClick={() => setStatus(status === 'active' ? '' : 'active')} title={`Signed in during the last ${ACTIVE_DAYS} days`} />
            <StatCard icon="fa-user-clock" tone="rose" value={list.length - activeN} label="Inactive" on={status === 'inactive'} onClick={() => setStatus(status === 'inactive' ? '' : 'inactive')} title={`No sign-in in the last ${ACTIVE_DAYS} days`} />
            <StatCard icon="fa-user-shield" tone="blue" value={list.filter(fullAccess).length + (owner ? 1 : 0)} label="Admin Users" on={perm === '__full'} onClick={() => setPerm(perm === '__full' ? '' : '__full')} title="The super admin plus employees with access to every section" />
          </div>

          <section className="pg-card">
            <div className="pg-card-head">
              <label className="pg-search">
                <i className="fas fa-magnifying-glass" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or access…" aria-label="Search employees" />
              </label>
              <div className="pg-tools">
                <select className="ov-select" value={perm} onChange={(e) => setPerm(e.target.value)} aria-label="Access">
                  <option value="">All Roles</option>
                  <option value="__full">Full access</option>
                  {GRANTABLE.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  <option value="__none">Overview only</option>
                </select>
                <select className="ov-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
                  <option value="">Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
            ) : list.length === 0 && !owner ? (
              <div className="adm-empty"><i className="fas fa-users-gear" /><p>No employees yet. Add teammates and choose which tabs they can access.</p></div>
            ) : (
              <>
                {sel.of(ids).length > 0 && (
                  <BulkBar sel={sel} ids={ids} hint="">
                    <button className="adm-btn danger sm" onClick={() => { const pickedIds = sel.of(ids); if (confirm(`Remove ${pickedIds.length} employee${pickedIds.length === 1 ? '' : 's'}? They will lose access. You can restore them from Backups → Recycle bin.`)) removeMany(pickedIds); }}><i className="fas fa-trash" /> Remove</button>
                  </BulkBar>
                )}
                <div className="table-scroll">
                  <table className="pg-table tm-table">
                    <thead>
                      <tr><th className="pick"><PickAll sel={sel} ids={ids} label="Select all shown employees" /></th><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {ownerShown && owner && (
                        <tr className="tm-owner">
                          <td className="pick" />
                          <td><span className="tm-person"><span className="tm-av" style={{ background: '#0f5c47' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {owner.avatar ? <img src={owner.avatar} alt="" /> : ini(owner.name || owner.email)}</span><b>{owner.name || owner.email.split('@')[0]}</b></span></td>
                          <td className="muted">{owner.email}</td>
                          <td className="muted">—</td>
                          <td><span className="tm-role admin">Super Admin</span></td>
                          <td><span className="tm-st on">Active</span></td>
                          <td className="muted">You</td>
                          <td><div className="bg-acts">{onProfile && <button type="button" onClick={onProfile} title="Edit your profile" aria-label="Edit your profile"><i className="fas fa-pen" /></button>}</div></td>
                        </tr>
                      )}
                      {shown.map((e) => (
                        <tr key={e.id} className={sel.has(e.id) ? 'picked' : undefined}>
                          <td className="pick"><PickOne sel={sel} id={e.id} label={e.name || e.email} /></td>
                          <td><span className="tm-person"><span className="tm-av" style={{ background: avTone(e.email) }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {e.avatar ? <img src={e.avatar} alt="" /> : ini(e.name || e.email)}</span><b>{e.name || e.email.split('@')[0]}</b></span></td>
                          <td className="muted">{e.email}</td>
                          <td className="muted">{e.mobile || '—'}</td>
                          <td>
                            {fullAccess(e) ? <span className="tm-role admin">Full access</span>
                              : e.permissions.length
                                ? <span className="tm-roles">{e.permissions.map((p) => <span key={p} className={`tm-role p-${p}`}>{TAB_META[p]?.label || p}</span>)}</span>
                                : <span className="tm-role">Overview only</span>}
                          </td>
                          <td><span className={`tm-st${isActive(e) ? ' on' : ''}`}>{isActive(e) ? 'Active' : 'Inactive'}</span></td>
                          <td className="muted" title={e.last_login_at ? fullDate(e.last_login_at) : 'Has not signed in yet'}>{e.last_login_at ? day(e.last_login_at) : 'Never'}{e.login_count ? <small className="tm-sub">{e.login_count} sign-in{e.login_count === 1 ? '' : 's'}</small> : null}</td>
                          <td>
                            <div className="bg-acts">
                              <button type="button" onClick={() => openEdit(e)} title="Edit" aria-label={`Edit ${e.name || e.email}`}><i className="fas fa-pen" /></button>
                              <div className="bg-more">
                                <button type="button" onClick={() => setMenuFor((m) => (m === e.id ? null : e.id))} title="More" aria-label="More actions" aria-expanded={menuFor === e.id}><i className="fas fa-ellipsis-vertical" /></button>
                                {menuFor === e.id && (
                                  <div className="bg-menu" onMouseLeave={() => setMenuFor(null)}>
                                    {e.mobile && <a className="bg-menu-a" href={`https://wa.me/${e.mobile.replace(/\D/g, '')}`} target="_blank" rel="noopener" onClick={() => setMenuFor(null)}><i className="fab fa-whatsapp" /> WhatsApp</a>}
                                    <a className="bg-menu-a" href={`mailto:${e.email}`} onClick={() => setMenuFor(null)}><i className="fas fa-envelope" /> Email</a>
                                    <button type="button" className="danger" onClick={() => { setMenuFor(null); remove(e); }}><i className="fas fa-trash" /> Remove</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!shown.length && !ownerShown && (
                  <div className="adm-empty"><i className="fas fa-filter" /><p>No team members match these filters.</p>
                    <button className="adm-btn ghost sm" onClick={() => { setQ(''); setPerm(''); setStatus(''); }}>Show everyone</button></div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {pane === 'roles' && (
        <section className="pg-card">
          <div className="pg-card-head"><h3>Access Roles</h3><span className="muted tm-sub">Who can open each section. Change it from an employee&apos;s Edit screen.</span></div>
          <div className="tm-roles-grid">
            <div className="tm-rcard admin">
              <span className="ic"><i className="fas fa-crown" /></span>
              <div><b>Super Admin</b><small>Every section, plus Employees, Backups and Developer API.</small></div>
              <span className="tm-who">{owner ? (owner.name || owner.email) : '—'}</span>
            </div>
            {GRANTABLE.map((g) => {
              const who = list.filter((e) => e.permissions.includes(g.key));
              return (
                <div className="tm-rcard" key={g.key}>
                  <span className="ic"><i className={`fas ${g.icon}`} /></span>
                  <div><b>{g.label}</b><small>{g.desc}</small></div>
                  <span className="tm-who">
                    {who.length ? (
                      <span className="tm-stack" title={who.map((e) => e.name || e.email).join(', ')}>
                        {who.slice(0, 5).map((e) => <span key={e.id} className="tm-av sm" style={{ background: avTone(e.email) }}>{ini(e.name || e.email)}</span>)}
                        <em>{who.length} member{who.length === 1 ? '' : 's'}</em>
                      </span>
                    ) : <span className="muted">No one yet</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="adm-note" style={{ marginTop: 16 }}><i className="fas fa-circle-info" /><span>Everyone can see the Overview and their own Profile. Employees only see the leads transferred to them.</span></p>
        </section>
      )}

      {pane === 'activity' && (
        <section className="pg-card">
          <div className="pg-card-head">
            <h3>Activity Log</h3>
            <div className="pg-tools">
              <select className="ov-select" value={feedWho} onChange={(e) => setFeedWho(e.target.value)} aria-label="Filter by person">
                <option value="">Everyone</option>
                {Array.from(new Map((feed || []).map((e) => [e.by_id || '', e.by_name || 'Someone'])).entries()).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
              <button type="button" className="adm-btn ghost sm" onClick={loadFeed}><i className="fas fa-rotate" /> Refresh</button>
            </div>
          </div>
          <p className="muted tm-sub" style={{ margin: '0 0 10px' }}>Notes, status changes, follow-ups and transfers on leads, newest first. Sign-ins are in the Last Login column.</p>
          {feed === null ? <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
            : !feed.filter((e) => !feedWho || e.by_id === feedWho).length ? <div className="adm-empty"><i className="fas fa-clock-rotate-left" /><p>Nothing yet. When anyone adds a note, changes a status or sets a follow-up on a lead, it shows here.</p></div>
              : (
                <ul className="tm-feed">
                  {feed.filter((e) => !feedWho || e.by_id === feedWho).map((e) => (
                    <li key={`${e.lead_id}-${e.id}`}>
                      <span className="tm-av sm" style={{ background: avTone(e.by_name || '?') }}>{ini(e.by_name || '?')}</span>
                      <div>
                        <b>{e.by_name || 'Someone'}</b> <span className="muted">on</span> <b>{e.lead_name || 'a lead'}</b>
                        <span className="tm-ev"><i className={`fas ${LEAD_EVENT_ICON[e.type]}`} /> {leadEventText(e)}</span>
                      </div>
                      <time title={fullDate(e.at)}>{leadWhen(e.at)}</time>
                    </li>
                  ))}
                </ul>
              )}
        </section>
      )}
    </div>
  );
}

/* ---------------------- Shared: people, locations, CSV ---------------------- */
// The three kinds of public user (and of map enquirer), in the admin's order.
const PEOPLE_ROLES = ['buyer', 'agent', 'developer'] as const;
type PersonRole = (typeof PEOPLE_ROLES)[number];
const ROLE_META: Record<PersonRole, { label: string; short: string; icon: string; file: string }> = {
  buyer: { label: 'Buyer / Investor', short: 'Buyers', icon: 'fa-house-chimney', file: 'buyers-investors' },
  agent: { label: 'Agent / Channel Partner', short: 'Agents', icon: 'fa-handshake', file: 'agents-channel-partners' },
  developer: { label: 'Developer / Builder', short: 'Developers', icon: 'fa-building', file: 'developers-builders' },
};

// Location filter: '' = every location, NO_LOCATION = rows without one.
const NO_LOCATION = '__none';
type Located = { locations?: string[] };
const matchesLocation = (it: Located, loc: string) =>
  !loc || (loc === NO_LOCATION ? !it.locations?.length : !!it.locations?.includes(loc));
/** [location, count] pairs across items, busiest first. */
function locationCounts(items: Located[]): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) for (const l of it.locations || []) m.set(l, (m.get(l) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function LocationSelect({ items, value, onChange }: { items: Located[]; value: string; onChange: (v: string) => void }) {
  const opts = locationCounts(items);
  const none = items.filter((it) => !it.locations?.length).length;
  return (
    <select className="crm-select" aria-label="Filter by location" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All locations</option>
      {opts.map(([l, n]) => <option key={l} value={l}>{l} ({n})</option>)}
      {none > 0 && <option value={NO_LOCATION}>No location given ({none})</option>}
    </select>
  );
}
const locationLabel = (loc: string) => (loc === NO_LOCATION ? 'no-location' : loc);

// Spreadsheet-safe CSV: a UTF-8 BOM so Excel shows ₹ and accents, every cell
// quoted, and a leading ' on cells that would otherwise run as a formula.
function downloadCsv(filename: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    let s = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileSlug = (...parts: string[]) =>
  ['mappingg', ...parts, new Date().toISOString().slice(0, 10)]
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean).join('-') + '.csv';
const csvDate = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/* ------------------------------ Leads / CRM ------------------------------ */
// Two sources: "Enquire" requests from project cards on the live map (from
// buyers/investors, agents and developers) and Contact-form messages.
type LeadSource = 'map' | 'signup' | 'contact';
interface Lead {
  id: string; name: string; email?: string; phone?: string; subject?: string;
  message?: string; source?: string; status: 'new' | 'contacted' | 'not_answered' | 'call_back' | 'site_visit' | 'negotiation' | 'won' | 'lost' | 'spam';
  notes?: string; created_at?: string; updated_at?: string;
  // Leads added by hand (Add Lead): where they are looking, and who added them.
  location?: string; added_by?: string;
  // The employee this lead was transferred to (any source).
  assigned_to?: string | null; assigned_name?: string | null; assigned_at?: string | null; assigned_by?: string | null;
  // CRM work on the lead: timeline (newest first), next follow-up, last touch.
  activity?: LeadEvent[]; follow_up_at?: string | null; last_activity_at?: string; last_activity_by?: string;
  // Map enquiries only:
  role?: PersonRole; pin_id?: string; locations?: string[];
  project?: {
    id: string; title: string; number: number | null; location: string;
    developer?: string; status?: string; type?: string; price?: string; configuration?: string; sqft?: string; possession?: string;
  } | null;
  // Map enquiries only: how many times they tapped "Enquire now" on this project, and when last.
  enquiry_clicks?: number; last_enquired_at?: string | null;
  // Map enquiries only: when they tapped "Book Site Visit" on the project.
  site_visit_requested_at?: string | null;
  // …and the day + time slot they picked, e.g. "Sat, 25 Oct 2026 · 10:00 AM – 12:00 PM".
  site_visit_slot?: string;
  // Enquiries sent by a partner website through the Developer API (POST /api/v1/enquiries).
  integration?: { app_id: string; app_name: string; website: string; source_page?: string; reference?: string } | null;
  // Map enquiries only: the enquirer's account (buyer, agent or developer), if they have one.
  account?: {
    id: string; signed_in: boolean; role?: string; name?: string; email?: string; mobile?: string;
    last_login_at: string | null; login_count: number; profile: Record<string, string>;
    compare_count: number; enquiry_count: number; member_since: string | null;
  } | null;
  // Buyer sign-ups only: that buyer's account activity.
  buyer?: {
    last_login_at: string | null; login_count: number; profile: Record<string, string>; account_exists: boolean;
    enquiries: { at: string; site_visit?: boolean; site_visit_slot?: string; project: { id: string; title: string; number: number | null; location: string } }[];
    compare: { id: string; title: string; number: number | null; location: string }[];
  };
}
interface LeadEvent {
  id: string; at: string; type: 'note' | 'status' | 'follow_up' | 'assigned' | 'unassigned';
  text?: string; from?: string; to?: string; by_id?: string; by_name?: string; by_role?: string;
  // Team activity feed only: which lead it was on.
  lead_id?: string; lead_name?: string; lead_source?: LeadSource;
}
const LEAD_EVENT_ICON: Record<LeadEvent['type'], string> = {
  note: 'fa-note-sticky', status: 'fa-arrow-right', follow_up: 'fa-calendar-check', assigned: 'fa-user-tie', unassigned: 'fa-user-slash',
};
/** "Moved from New to Contacted", "Follow-up set for 12 Oct, 4:00 pm", or the note itself. */
function leadEventText(e: LeadEvent) {
  const stage = (k?: string) => LEAD_STAGES.find((x) => x.key === k)?.label || k || '';
  switch (e.type) {
    case 'note': return e.text || '';
    case 'status': return `Moved from ${stage(e.from)} to ${stage(e.to)}`;
    case 'follow_up': return e.to ? `Follow-up set for ${fullDate(e.to)}` : 'Follow-up cleared';
    case 'assigned': return e.from ? `Transferred from ${e.from} to ${e.to}` : `Transferred to ${e.to}`;
    case 'unassigned': return `Taken back from ${e.from || 'employee'}`;
  }
}
/** A follow-up value for <input type="datetime-local"> (local time). */
const toLocalInput = (d?: string | null) => {
  if (!d) return '';
  const t = new Date(d); if (Number.isNaN(t.getTime())) return '';
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const isOverdue = (d?: string | null) => !!d && new Date(d).getTime() < Date.now();

/** A lead as a WhatsApp message (plain text, *bold* lines), for sharing with the team or a partner. */
function leadShareText(l: Lead): string {
  const pf = l.buyer?.profile || l.account?.profile || {};
  const lines = [
    `*Lead: ${l.name || l.email || 'Unknown'}*`,
    l.phone && `📞 ${l.phone}`,
    l.email && `✉️ ${l.email}`,
    l.project && `🏢 Project: ${l.project.title || 'Untitled'}${l.project.number != null ? ` #${l.project.number}` : ''}${l.project.location ? `, ${l.project.location}` : ''}`,
    l.project?.price && `💰 Price: ${l.project.price}`,
    pf.configuration && `🏠 Looking for: ${pf.configuration}`,
    pf.budget && `💰 Budget: ${pf.budget}`,
    pf.area && `📍 Preferred area: ${pf.area}`,
    pf.timeline && `🗓️ Planning to buy: ${pf.timeline}`,
    pf.purpose && `🎯 Buying for: ${pf.purpose}`,
    !l.project && !l.buyer && l.message && `💬 ${l.message}`,
    `Status: ${LEAD_STAGES.find((x) => x.key === l.status)?.label || l.status}`,
    l.follow_up_at && `Next follow-up: ${fullDate(l.follow_up_at)}`,
  ].filter(Boolean);
  return lines.join('\n');
}
/** Opens WhatsApp with the text ready to send — to the given number, or the company number (+91 82288 28200). */
function shareOnWhatsApp(text: string, to: string = WHATSAPP_NUMBER) {
  window.open(`https://wa.me/${to.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
/**
 * Share with anyone: on phones the system share sheet (WhatsApp, WhatsApp
 * Business, …); on a computer WhatsApp opens with the text ready and you pick
 * the chat or group.
 */
async function shareWithAnyone(text: string) {
  const touch = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (touch) {
    try { await navigator.share({ text }); return; } catch (e) { if ((e as Error)?.name === 'AbortError') return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
const joinLeads = (leads: Lead[]) => leads.map(leadShareText).join('\n\n────────\n\n');

/** "2 BHK · ₹1 – 2 Cr · Mundhwa" from a buyer's sign-up preferences. */
const buyerWants = (l: Lead) => {
  const pf = l.buyer?.profile || {};
  return [pf.configuration, pf.budget, pf.area].filter(Boolean).join(' · ');
};
// The lead table is paged so it stays fast with thousands of leads; counts,
// filters and downloads still run over the full list.
const LEAD_PAGE_SIZES = ['10', '25', '50', '100'] as const;
const UNASSIGNED = '__none';

// Real-estate sales pipeline, in order.
const LEAD_STAGES: { key: Lead['status']; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'not_answered', label: 'Call not answered' },
  { key: 'call_back', label: 'Call back' },
  { key: 'site_visit', label: 'Site visit' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won', label: 'Booked' },
  { key: 'lost', label: 'Lost' },
  { key: 'spam', label: 'Spam' },
];
/** Booked, lost and spam leads are closed: no follow-up is due on them. */
const isClosed = (s: Lead['status']) => s === 'won' || s === 'lost' || s === 'spam';
/** Follow-up due today (or already overdue). */
const isDue = (d?: string | null) => {
  if (!d) return false;
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return new Date(d).getTime() <= end.getTime();
};
const leadWhen = (d?: string) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const projectName = (l: Lead) =>
  l.project ? `${l.project.title || 'Untitled project'}${l.project.number != null ? ` #${l.project.number}` : ''}` : '';
const stageLabel = (s: Lead['status']) => LEAD_STAGES.find((x) => x.key === s)?.label || s;
const fullDate = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const accountRole = (r?: string) => ROLE_META[(PEOPLE_ROLES as readonly string[]).includes(String(r)) ? (r as PersonRole) : 'buyer'];
const PIN_STATUS: Record<string, string> = { available: 'Ready to move', under_construction: 'Under construction', upcoming: 'Upcoming', sold: 'Sold out' };

// CRM & Leads page pieces: KPI cards with a 14-day sparkline, avatars, status icons.
const DAY_MS = 86_400_000;
/** How many of these dates fall on each of the last `days` days (oldest first). */
function daySeries(dates: (string | null | undefined)[], days = 14) {
  const out: number[] = new Array(days).fill(0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime() - (days - 1) * DAY_MS;
  for (const d of dates) {
    if (!d) continue;
    const i = Math.floor((new Date(d).getTime() - t0) / DAY_MS);
    if (i >= 0 && i < days) out[i]++;
  }
  return out;
}
/** Last 30 days vs the 30 before, in %; null when there is nothing to compare with. */
function growthPct(dates: (string | null | undefined)[]) {
  const now = Date.now();
  let cur = 0, prev = 0;
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (t > now) continue;
    if (t > now - 30 * DAY_MS) cur++; else if (t > now - 60 * DAY_MS) prev++;
  }
  return prev ? Math.round(((cur - prev) / prev) * 100) : null;
}
const KPI_HEX: Record<string, string> = { green: '#1f8a4c', blue: '#2a78d6', amber: '#e08a1e', violet: '#7c4ddb', teal: '#0f7a55' };
function Sparkline({ data, tone }: { data: number[]; tone: string }) {
  const w = 96, h = 30, c = KPI_HEX[tone] || '#0f7a55';
  const max = Math.max(1, ...data);
  const step = w / Math.max(1, data.length - 1);
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 8)).toFixed(1)}`).join(' ');
  const id = `ck-spark-${tone}`;
  return (
    <svg className="ck-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity=".22" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={c} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
function CrmKpi({ icon, tone, value, label, title, series, growth, on, onClick }: {
  icon: string; tone: string; value: number; label: string; title?: string; series: number[]; growth?: number | null; on?: boolean; onClick?: () => void;
}) {
  const inner = (
    <>
      <span className={`ck-ic ${tone}`} aria-hidden="true"><i className={`fas ${icon}`} /></span>
      <span className="ck-t"><b>{value.toLocaleString('en-IN')}</b><small>{label}</small></span>
      <span className="ck-trend">
        {growth != null && <em className={growth >= 0 ? 'up' : 'down'} title="Last 30 days vs the 30 before"><i className={`fas fa-arrow-${growth >= 0 ? 'up' : 'down'}`} /> {Math.abs(growth)}%</em>}
        <Sparkline data={series} tone={tone} />
      </span>
    </>
  );
  return onClick
    ? <button type="button" className={`ck${on ? ' on' : ''}`} onClick={onClick} title={title} aria-pressed={!!on}>{inner}</button>
    : <div className="ck" title={title}>{inner}</div>;
}
const AV_TONES = ['rose', 'green', 'blue', 'amber', 'violet', 'teal'];
const avTone = (s: string) => AV_TONES[Array.from(s || '?').reduce((a, c) => a + c.charCodeAt(0), 0) % AV_TONES.length];
const nameInitials = (s: string) => {
  const w = s.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
};
// Sources for a lead added by hand — keep in step with app/api/admin/leads/route.ts.
const MANUAL_SOURCES = ['Phone call', 'Walk-in', 'Referral', 'WhatsApp', 'Website', 'Google Ads', 'Facebook Ads', 'Instagram', 'Other'] as const;
/** Icon + colour for a contact-list lead's source (contact form, WhatsApp chat, or one picked in Add Lead). */
const CONTACT_SOURCE_META: Record<string, { icon: string; tone: string; label?: string }> = {
  'contact-form': { icon: 'fas fa-envelope', tone: 'amber', label: 'Contact Form' },
  'WhatsApp chat': { icon: 'fab fa-whatsapp', tone: 'green' },
  'Phone call': { icon: 'fas fa-phone', tone: 'teal' },
  'Walk-in': { icon: 'fas fa-person-walking', tone: 'violet' },
  Referral: { icon: 'fas fa-user-group', tone: 'amber' },
  WhatsApp: { icon: 'fab fa-whatsapp', tone: 'green' },
  Website: { icon: 'fas fa-globe', tone: 'blue' },
  'Google Ads': { icon: 'fab fa-google', tone: 'blue' },
  'Facebook Ads': { icon: 'fab fa-facebook', tone: 'blue' },
  Instagram: { icon: 'fab fa-instagram', tone: 'rose' },
  Other: { icon: 'fas fa-circle-dot', tone: 'teal' },
};
const STAGE_ICON: Record<string, string> = {
  new: 'fa-bolt', contacted: 'fa-phone', not_answered: 'fa-phone-slash', call_back: 'fa-clock-rotate-left', site_visit: 'fa-calendar-check',
  negotiation: 'fa-handshake', won: 'fa-circle-check', lost: 'fa-circle-xmark', spam: 'fa-ban',
};

function LeadsPanel({ flash, isOwner, focusId, onFocusDone }: { flash: (m: string, e?: boolean) => void; isOwner: boolean; focusId?: string | null; onFocusDone?: () => void }) {
  const [bySource, setBySource] = useState<Record<LeadSource, Lead[]>>({ map: [], signup: [], contact: [] });
  // Opens on map enquiries (people who tapped Enquire / Book site visit on a project) —
  // for the super admin and employees alike. Source and status filter survive a refresh (sessionStorage).
  const [source, setSource] = usePersistedState<LeadSource>('leads.src', 'map', ['map', 'signup', 'contact']);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = usePersistedState<'all' | 'due' | Lead['status']>('leads.filter', 'all', ['all', 'due', ...LEAD_STAGES.map((s) => s.key)]);
  const [role, setRole] = useState<'all' | PersonRole>('all');
  const [loc, setLoc] = useState('');
  const [sel, setSel] = useState<Lead | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [followDraft, setFollowDraft] = useState('');
  // The open lead's panel: which tab, and whether it sits beside the table (wide screens) or slides over.
  const [ptab, setPtab] = useState<'overview' | 'activity' | 'notes'>('overview');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1600px)');
    const on = () => setDocked(m.matches);
    on(); m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const [sort, setSort] = useState<'new' | 'old' | 'activity'>('new');
  // Table paging (rows per page survives a refresh in this tab).
  const [page, setPage] = useState(1);
  const [perPageS, setPerPage] = usePersistedState<(typeof LEAD_PAGE_SIZES)[number]>('leads.perPage', '25', LEAD_PAGE_SIZES);
  const perPage = Number(perPageS);
  // Add Lead (super admin): a lead from a call, walk-in, referral, ad…
  const EMPTY_ADD = { name: '', phone: '', email: '', source: 'Phone call' as (typeof MANUAL_SOURCES)[number], subject: '', location: '', message: '', status: 'new' as Lead['status'], follow_up: '' };
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [adding, setAdding] = useState(false);
  async function addLead() {
    if (!addForm.name.trim()) { flash('Enter the lead’s name', true); return; }
    if (!addForm.phone.trim() && !addForm.email.trim()) { flash('Add a phone number or an email', true); return; }
    setAdding(true);
    try {
      const { follow_up, ...rest } = addForm;
      const r = await fetch('/api/admin/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ ...rest, follow_up_at: follow_up ? new Date(follow_up).toISOString() : null }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.data) throw new Error(b?.error?.message || 'Could not add the lead');
      const lead = b.data as Lead;
      setBySource((s) => ({ ...s, contact: [lead, ...s.contact] }));
      setAddOpen(false); setAddForm(EMPTY_ADD);
      switchSource('contact'); open(lead);
      flash(`Lead added — ${lead.name}`);
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not add the lead', true); } finally { setAdding(false); }
  }
  // Super admin: everything the team did on leads.
  const [teamFeed, setTeamFeed] = useState<LeadEvent[] | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamWho, setTeamWho] = useState('');
  async function loadTeamFeed() {
    setTeamFeed(null);
    try {
      const r = await fetch('/api/admin/leads?activity=1', { credentials: 'same-origin' });
      const b = await r.json();
      setTeamFeed(r.ok && Array.isArray(b.data) ? b.data : []);
    } catch { setTeamFeed([]); }
  }

  // Employees a lead can be transferred to, and the "Assigned to" filter
  // ('' = everyone, UNASSIGNED = nobody yet, else an employee id).
  const [staff, setStaff] = useState<{ id: string; name: string; email: string; mobile?: string }[]>([]);
  const [assignee, setAssignee] = useState('');
  useEffect(() => {
    if (!isOwner) return; // only the super admin transfers leads
    fetch('/api/admin/leads?staff=1', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((b) => setStaff(Array.isArray(b?.data) ? b.data : [])).catch(() => {});
  }, [isOwner]);

  const [live, setLive] = useState(false);
  // Total leads per source when the API had to leave older ones out.
  const [truncated, setTruncated] = useState<Partial<Record<LeadSource, number>>>({});

  // `silent` refreshes (triggered by the real-time stream) skip the spinner so
  // the table doesn't flash while the admin is reading it.
  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      // Each source loads on its own: one failing request (e.g. a slow database)
      // must not leave the other tabs showing an old list. A failed source keeps
      // its previous rows and the admin is told.
      const get = (s: LeadSource) => fetch(`/api/admin/leads?source=${s}`, { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null)).then((b) => (b && Array.isArray(b.data) ? b : null)).catch(() => null);
      // Employees work the map enquiries and buyer accounts transferred to them.
      const none = Promise.resolve({ data: [] });
      const [m, su, c] = await Promise.all([get('map'), get('signup'), isOwner ? get('contact') : none]);
      setBySource((prev) => ({ map: m ? m.data : prev.map, signup: su ? su.data : prev.signup, contact: c ? c.data : prev.contact }));
      setTruncated((prev) => ({
        ...prev,
        ...(m ? { map: m.truncated ? Number(m.total) : undefined } : {}),
        ...(su ? { signup: su.truncated ? Number(su.total) : undefined } : {}),
        ...(c ? { contact: c.truncated ? Number(c.total) : undefined } : {}),
      }));
      if (!m || !su || !c) flash(`Could not load ${[!m && 'map enquiries', !su && 'buyer accounts', !c && 'contact leads'].filter(Boolean).join(', ')} — tap Refresh`, true);
    } catch { if (!silent) flash('Could not load leads', true); } finally { if (!silent) setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Near-real-time updates via SSE: refetch when the server signals a lead
  // table changed. EventSource auto-reconnects on drop; we refetch
  // authoritative data so no duplicate rows/notifications can appear.
  // Refresh every 5 min while the tab is visible, and on coming back to it (at most
  // once a minute — each refresh costs several database operations). (The SSE
  // stream at /api/admin/leads/stream kept a serverless function running the whole
  // time the panel was open, which used up the hosting CPU/memory quota.)
  useEffect(() => {
    setLive(true);
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return;
      last = Date.now();
      void load(true);
    };
    const t = setInterval(refresh, 300_000);
    const onVis = refresh;
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from another tab (e.g. a WhatsApp chat's lead): show that contact lead.
  useEffect(() => {
    if (!focusId || loading) return;
    const l = bySource.contact.find((x) => x.id === focusId) || bySource.signup.find((x) => x.id === focusId);
    if (l) { setSource(bySource.contact.includes(l) ? 'contact' : 'signup'); open(l); } else flash('That lead is not in your list', true);
    onFocusDone?.();
  }, [focusId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useSelection();
  function switchSource(s: LeadSource) {
    setSource(s); setRole('all'); setLoc(''); setFilter('all'); setQ(''); setAssignee(''); pick.clear();
  }

  const isMap = source === 'map';
  const isSignup = source === 'signup';
  const all = bySource[source];
  // Type + location narrow everything below (status chips, table, downloads).
  const matchesAssignee = (l: Lead) => !assignee || (assignee === UNASSIGNED ? !l.assigned_to : l.assigned_to === assignee);
  const scoped = all.filter((l) => (!isMap || role === 'all' || l.role === role) && (!isMap || matchesLocation(l, loc)) && matchesAssignee(l));
  const counts: Record<'all' | 'due' | Lead['status'], number> = {
    all: scoped.length,
    due: scoped.filter((l) => isDue(l.follow_up_at) && !isClosed(l.status)).length,
    ...Object.fromEntries(LEAD_STAGES.map((st) => [st.key, scoped.filter((l) => l.status === st.key).length])) as Record<Lead['status'], number>,
  };
  const term = q.trim().toLowerCase();
  const matchesSearch = (l: Lead) => !term || [l.name, l.email, l.phone, l.subject, l.message, l.project?.title, l.project?.location]
    .some((x) => (x || '').toLowerCase().includes(term));
  const inFilter = (l: Lead) => filter === 'all' || (filter === 'due' ? isDue(l.follow_up_at) && !isClosed(l.status) : l.status === filter);
  const list = scoped.filter((l) => inFilter(l) && matchesSearch(l))
    // Follow-ups due first (oldest due on top), then newest.
    .sort((a, b) => (filter === 'due' ? String(a.follow_up_at).localeCompare(String(b.follow_up_at)) : 0));
  // Downloads follow the location / status / search filters, split by type.
  const forDownload = (r: PersonRole) => all.filter((l) => l.role === r && matchesLocation(l, loc) && inFilter(l) && matchesSearch(l));

  function downloadMap(r: PersonRole) {
    const rows = forDownload(r);
    downloadCsv(fileSlug('map-enquiries', ROLE_META[r].file, loc ? locationLabel(loc) : ''),
      ['Name', 'Email', 'WhatsApp', 'Type', 'Signed in', 'Project', 'Project no.', 'Project location', 'Locality', 'Developer', 'Price', 'Status', 'Notes', 'Received', 'Times tapped', 'Last enquired'],
      rows.map((l) => [l.name, l.email, l.phone, ROLE_META[r].label, l.account?.signed_in ? 'Yes' : 'No', l.project?.title, l.project?.number, l.project?.location, l.locations, l.project?.developer, l.project?.price, stageLabel(l.status), l.notes, csvDate(l.created_at), l.enquiry_clicks || 1, csvDate(l.last_enquired_at)]));
  }
  function downloadContact() {
    if (isSignup) {
      downloadCsv(fileSlug('buyer-signups'),
        ['Name', 'Email', 'WhatsApp', 'Looking for', 'Status', 'Assigned to', 'Notes', 'Signed up'],
        list.map((l) => [l.name, l.email, l.phone, l.message, stageLabel(l.status), l.assigned_name, l.notes, csvDate(l.created_at)]));
      return;
    }
    downloadCsv(fileSlug('contact-leads'),
      ['Name', 'Email', 'Phone', 'Source', 'Topic / looking for', 'Location', 'Message', 'Status', 'Notes', 'Received'],
      list.map((l) => [l.name, l.email, l.phone, l.source, l.subject, l.location, l.message, stageLabel(l.status), l.notes, csvDate(l.created_at)]));
  }

  function open(l: Lead) { setSel(l); setPtab('overview'); setNotes(l.notes || ''); setNoteDraft(''); setFollowDraft(toLocalInput(l.follow_up_at)); }
  async function addNote() {
    if (!sel || !noteDraft.trim()) return;
    if (await patch(sel.id, { add_note: noteDraft.trim() })) { setNoteDraft(''); flash('Note added'); }
  }
  async function saveFollowUp(clear = false) {
    if (!sel) return;
    const v = clear ? null : followDraft ? new Date(followDraft).toISOString() : null;
    if (await patch(sel.id, { follow_up_at: v })) { if (clear) setFollowDraft(''); flash(v ? 'Follow-up saved' : 'Follow-up cleared'); }
  }
  /** Open a lead from the team activity feed (switching to its tab first). */
  function openFromFeed(e: LeadEvent) {
    const src = e.lead_source || 'contact';
    const l = bySource[src].find((x) => x.id === e.lead_id);
    if (!l) { flash('That lead no longer exists', true); return; }
    if (src !== source) switchSource(src);
    setTeamOpen(false); open(l);
  }
  const replace = (id: string, next: Lead | null) =>
    setBySource((b) => ({
      ...b,
      [source]: next
        ? b[source].map((x) => (x.id === id ? { ...next, account: x.account ?? next.account, buyer: x.buyer ?? next.buyer } : x))
        : b[source].filter((x) => x.id !== id),
    }));

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/leads', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ id, source, ...body }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Failed');
      replace(id, b.data);
      setSel((s) => (s && s.id === id ? { ...b.data, account: s.account ?? b.data.account, buyer: s.buyer ?? b.data.buyer } : s));
      return true;
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); return false; } finally { setBusy(false); }
  }

  async function setStatus(l: Lead, status: Lead['status']) {
    if (await patch(l.id, { status })) flash(`Marked ${status}`);
  }
  async function saveNotes() {
    if (sel && await patch(sel.id, { notes })) flash('Notes saved');
  }
  async function remove(l: Lead) {
    if (!confirm(`Delete lead from ${l.name}? You can restore it from Backups → Recycle bin.`)) return;
    await removeMany([l.id]);
  }
  async function removeMany(ids: string[]) {
    try {
      const r = await fetch(`/api/admin/leads?source=${source}&ids=${ids.map(encodeURIComponent).join(',')}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setBySource((b) => ({ ...b, [source]: b[source].filter((x) => !ids.includes(x.id)) }));
      if (sel && ids.includes(sel.id)) setSel(null);
      pick.clear();
      flash(`${ids.length === 1 ? 'Lead' : `${ids.length} leads`} moved to the recycle bin`);
    } catch { flash('Delete failed', true); }
  }
  const staffName = (id: string) => staff.find((e) => e.id === id)?.name || 'employee';
  // Employees who can get leads on WhatsApp (a number is saved under Employees).
  const waStaff = staff.filter((e) => e.mobile);
  /** Sends these leads to an employee on WhatsApp (their chat opens with the details filled in). */
  function sendToEmployee(leads: Lead[], empId: string) {
    const emp = staff.find((e) => e.id === empId);
    if (!emp?.mobile || !leads.length) return;
    const intro = `Hi ${emp.name.split(' ')[0]}, ${leads.length === 1 ? 'a new lead for you' : `${leads.length} new leads for you`} from Mappingg:`;
    shareOnWhatsApp([intro, ...leads.map(leadShareText)].join('\n\n────────\n\n'), emp.mobile);
  }
  async function assign(l: Lead, to: string) {
    if ((l.assigned_to || '') === to) return;
    if (await patch(l.id, { assigned_to: to || null })) flash(to ? `Lead transferred to ${staffName(to)}` : 'Lead unassigned');
  }
  async function assignMany(ids: string[], to: string) {
    let ok = 0;
    for (const id of ids) if (await patch(id, { assigned_to: to === UNASSIGNED ? null : to })) ok++;
    pick.clear();
    flash(`${ok} lead${ok === 1 ? '' : 's'} ${to === UNASSIGNED ? 'unassigned' : `transferred to ${staffName(to)}`}${ok < ids.length ? `, ${ids.length - ok} failed` : ''}`, ok < ids.length);
  }
  async function setStatusMany(ids: string[], status: Lead['status']) {
    let ok = 0;
    for (const id of ids) if (await patch(id, { status })) ok++;
    pick.clear();
    flash(`${ok} lead${ok === 1 ? '' : 's'} marked ${stageLabel(status)}${ok < ids.length ? `, ${ids.length - ok} failed` : ''}`, ok < ids.length);
  }

  const initials = (l: Lead) => nameInitials(l.name || l.email || '?');
  const roleCount = (r: PersonRole) => bySource.map.filter((l) => l.role === r && matchesLocation(l, loc)).length;

  // Header numbers for the source being viewed (after type / location / employee filters).
  const monthAgo = Date.now() - 30 * 86_400_000;
  const new30 = scoped.filter((l) => l.created_at && new Date(l.created_at).getTime() >= monthAgo).length;
  const visitLeads = scoped.filter((l) => l.status === 'site_visit' || !!l.site_visit_requested_at);
  const visits = visitLeads.length;
  const allLeads = [...bySource.map, ...bySource.signup, ...(isOwner ? bySource.contact : [])];
  const totalAll = allLeads.length;
  const sourceLabel = isMap ? 'Map enquiries' : isSignup ? 'Buyer accounts' : 'Contact form';
  const isContact = !isMap && !isSignup;
  const digits = (p?: string) => (p || '').replace(/\D/g, '');
  const dueLeads = scoped.filter((l) => isDue(l.follow_up_at) && !isClosed(l.status));
  const wonLeads = scoped.filter((l) => l.status === 'won');
  const visitDate = (l: Lead) => l.site_visit_requested_at || (l.status === 'site_visit' ? l.updated_at : null);

  // Sort: newest first (as loaded), oldest first, or most recently worked on. Follow-up due keeps its own order.
  const ts = (d?: string | null) => (d ? new Date(d).getTime() : 0);
  const ordered = filter === 'due' || sort === 'new' ? list
    : [...list].sort((a, b) => (sort === 'old'
      ? ts(a.created_at) - ts(b.created_at)
      : ts(b.last_activity_at || b.created_at) - ts(a.last_activity_at || a.created_at)));
  // Back to page 1 whenever the list itself changes (source, stage, search, filters, sort, page size).
  const listKey = [source, filter, q, role, loc, assignee, sort, perPage].join('|');
  useEffect(() => { setPage(1); }, [listKey]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / perPage));
  const pg = Math.min(page, pageCount);
  const firstRow = (pg - 1) * perPage;
  const shown = ordered.slice(firstRow, firstRow + perPage);
  const shownIds = shown.map((l) => l.id);
  /** 1 … 4 5 6 … 20 — every page when there are few. */
  const pageList: (number | '…')[] = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, i) => i + 1)
    : pg <= 4 ? [1, 2, 3, 4, 5, '…', pageCount]
      : pg >= pageCount - 3 ? [1, '…', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
        : [1, '…', pg - 1, pg, pg + 1, '…', pageCount];
  // Stage tabs above the table; the less-used stages sit under "More stages".
  const STAGE_TABS: (typeof filter)[] = ['all', 'new', 'due', 'site_visit', 'won', 'lost', 'spam'];
  const MORE_STAGES: Lead['status'][] = ['contacted', 'not_answered', 'call_back', 'negotiation'];
  const stageTabLabel = (k: typeof filter) => (k === 'all' ? (isOwner ? 'All Leads' : 'My Leads') : k === 'due' ? 'Follow-up' : k === 'site_visit' ? 'Site Visits' : k === 'won' ? 'Converted' : stageLabel(k));
  const activeFilters = (role !== 'all' ? 1 : 0) + (assignee ? 1 : 0) + (sort !== 'new' ? 1 : 0);
  /** What they want (configuration · budget) and where (project / area), for the table and the lead panel. */
  const wantOf = (l: Lead) => isMap
    ? [l.project?.configuration, l.project?.price].filter(Boolean).join(' · ') || [l.account?.profile?.configuration, l.account?.profile?.budget].filter(Boolean).join(' · ')
    : isSignup ? [l.buyer?.profile?.configuration, l.buyer?.profile?.budget].filter(Boolean).join(' · ') : l.subject || '';
  const showAssign = isOwner && !isContact;

  const srcInfo = (l: Lead) => isMap
    ? (l.integration
      ? { icon: 'fas fa-globe', tone: 'teal', label: 'Partner website', sub: l.integration.website }
      : { icon: 'fas fa-map-location-dot', tone: 'blue', label: 'Map Enquiry', sub: ROLE_META[l.role || 'buyer'].short.replace(/s$/, '') })
    : isSignup ? { icon: 'fas fa-user-plus', tone: 'green', label: 'Buyer Account', sub: 'Signed up on the site' }
      : (() => {
        const m = CONTACT_SOURCE_META[l.source || 'contact-form'] || { icon: 'fas fa-envelope', tone: 'amber' };
        return { icon: m.icon, tone: m.tone, label: m.label || l.source || 'Contact Form', sub: l.added_by ? 'Added by hand' : '' };
      })();
  const locationOf = (l: Lead) => isMap
    ? (l.locations?.length ? l.locations.join(', ') : l.project?.location || '')
    : isSignup ? l.buyer?.profile?.area || '' : l.location || '';

  const detail = sel && (
    <aside className={`crm3-panel${docked ? ' docked' : ''}`} onClick={(e) => e.stopPropagation()} aria-label={`Lead: ${sel.name || sel.email || ''}`}>
      <div className="crm3-ph">
        <span className={`crm3-av lg ${avTone(sel.name || sel.email || '')}`}>{initials(sel)}</span>
        <div className="crm3-ph-t">
          <div className="crm3-ph-name"><b>{sel.name || '—'}</b><span className={`crm3-pill ${sel.status}`}><i className={`fas ${STAGE_ICON[sel.status] || 'fa-circle'}`} />{stageLabel(sel.status)}</span></div>
          <small>{isMap ? ROLE_META[sel.role || 'buyer'].label : isSignup ? 'Buyer account' : (sel.subject || 'Contact form')}</small>
          {sel.phone && <a href={`tel:${sel.phone.replace(/\s/g, '')}`}><i className="fas fa-phone" /> {sel.phone}</a>}
          {sel.email && <a href={`mailto:${sel.email}`} title={sel.email}><i className="fas fa-envelope" /> <span>{sel.email}</span></a>}
        </div>
        {isOwner && <button type="button" className="crm3-x crm3-del" onClick={() => remove(sel)} title="Delete lead (restorable from Backups → Recycle bin)" aria-label={`Delete lead from ${sel.name || sel.email || 'this person'}`}><i className="fas fa-trash" /></button>}
        <button type="button" className="crm3-x" onClick={() => setSel(null)} aria-label="Close"><i className="fas fa-xmark" /></button>
      </div>

      <div className="crm3-ptabs" role="tablist">
        {([['overview', 'Overview'], ['activity', `Activity${sel.activity?.length ? ` (${sel.activity.length})` : ''}`], ['notes', 'Notes']] as const).map(([k, lbl]) => (
          <button key={k} type="button" role="tab" aria-selected={ptab === k} className={ptab === k ? 'on' : ''} onClick={() => setPtab(k)}>{lbl}</button>
        ))}
      </div>

      <div className="crm3-pbody">
        {ptab === 'overview' && (
          <>
            <dl className="crm3-kv">
              <div><dt><i className="fas fa-house" /> {isContact ? 'Topic' : 'Looking for'}</dt><dd>{wantOf(sel) || '—'}</dd></div>
              <div><dt><i className="fas fa-location-dot" /> Location</dt><dd>{locationOf(sel) || '—'}</dd></div>
              {isMap && <div><dt><i className="fas fa-building" /> Project</dt><dd>{projectName(sel) || 'Project removed'}</dd></div>}
              <div><dt><i className="fas fa-globe" /> Source</dt><dd>{srcInfo(sel).label}{srcInfo(sel).sub ? <small>{srcInfo(sel).sub}</small> : null}</dd></div>
              <div>
                <dt><i className="fas fa-circle-half-stroke" /> Status</dt>
                <dd>
                  <select className="crm-select" value={sel.status} disabled={busy} aria-label="Lead status" onChange={(e) => setStatus(sel, e.target.value as Lead['status'])}>
                    {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </dd>
              </div>
              {showAssign && (
                <div>
                  <dt><i className="fas fa-user-tie" /> Assigned to</dt>
                  <dd>
                    {staff.length ? (
                      <select className="crm-select" value={sel.assigned_to || ''} disabled={busy} onChange={(e) => assign(sel, e.target.value)} aria-label="Transfer this lead to an employee">
                        <option value="">Nobody yet</option>
                        {sel.assigned_to && !staff.some((e) => e.id === sel.assigned_to) && <option value={sel.assigned_to}>{sel.assigned_name || 'Former employee'}</option>}
                        {staff.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.email}</option>)}
                      </select>
                    ) : <small>No employees with access to Leads yet — add one under Employees and tick Leads.</small>}
                    {sel.assigned_to && sel.assigned_at && <small>Since {leadWhen(sel.assigned_at)}{sel.assigned_by ? ` · by ${sel.assigned_by}` : ''}</small>}
                  </dd>
                </div>
              )}
              <div><dt><i className="fas fa-calendar-plus" /> {isSignup ? 'Signed up' : 'Created on'}</dt><dd>{fullDate(sel.created_at)}</dd></div>
              <div><dt><i className="fas fa-clock" /> Last activity</dt><dd>{sel.last_activity_at ? <>{leadWhen(sel.last_activity_at)}<small>by {sel.last_activity_by}</small></> : '—'}</dd></div>
              <div>
                <dt><i className="fas fa-calendar-check" /> Next follow-up</dt>
                <dd>
                  <div className="crm3-follow">
                    <input className="crm-search" type="datetime-local" value={followDraft} onChange={(e) => setFollowDraft(e.target.value)} aria-label="Next follow-up" />
                    <button className="adm-btn ghost sm" disabled={busy || !followDraft || toLocalInput(sel.follow_up_at) === followDraft} onClick={() => saveFollowUp()}>Save</button>
                    {sel.follow_up_at && <button className="adm-btn ghost sm" disabled={busy} onClick={() => saveFollowUp(true)}>Clear</button>}
                  </div>
                  {sel.follow_up_at && isOverdue(sel.follow_up_at) && <small style={{ color: '#b42318' }}><i className="fas fa-triangle-exclamation" /> Follow-up was due {leadWhen(sel.follow_up_at)}</small>}
                </dd>
              </div>
            </dl>

            {isMap ? (
              <>
                <div className="crm-block">
                  <h4>Enquiry</h4>
                  <table className="adm-table">
                    <tbody>
                      <tr><td className="muted">Name</td><td>{sel.name}</td></tr>
                      <tr><td className="muted">Email</td><td>{sel.email || '—'}</td></tr>
                      <tr><td className="muted">WhatsApp</td><td>{sel.phone || '—'}</td></tr>
                      <tr><td className="muted">Enquirer type</td><td>{ROLE_META[sel.role || 'buyer'].label}</td></tr>
                      <tr><td className="muted">How</td><td>{sel.account?.signed_in ? 'Enquire now while signed in' : 'Enquiry form (not signed in)'}</td></tr>
                      <tr><td className="muted">First enquired</td><td>{fullDate(sel.created_at)}</td></tr>
                      {sel.site_visit_requested_at && <tr><td className="muted">Site visit</td><td><b style={{ color: '#2f7a3c' }}>{sel.site_visit_slot || 'Requested'}</b><small className="muted" style={{ display: 'block' }}>Booked {fullDate(sel.site_visit_requested_at)}</small></td></tr>}
                      <tr><td className="muted">Times tapped</td><td>{sel.enquiry_clicks || 1}</td></tr>
                      {(sel.enquiry_clicks || 1) > 1 && <tr><td className="muted">Last enquired</td><td>{fullDate(sel.last_enquired_at)}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="crm-block">
                  <h4>Asked about</h4>
                  {sel.project ? (
                    <table className="adm-table">
                      <tbody>
                        <tr><td className="muted">Project</td><td>{projectName(sel)}</td></tr>
                        <tr><td className="muted">Location</td><td>{sel.project.location || '—'}</td></tr>
                        <tr><td className="muted">Developer</td><td>{sel.project.developer || '—'}</td></tr>
                        <tr><td className="muted">Status</td><td>{PIN_STATUS[sel.project.status || ''] || sel.project.status || '—'}</td></tr>
                        <tr><td className="muted">Type</td><td>{sel.project.type || '—'}</td></tr>
                        <tr><td className="muted">Configuration</td><td>{sel.project.configuration || '—'}</td></tr>
                        <tr><td className="muted">Size</td><td>{sel.project.sqft || '—'}</td></tr>
                        <tr><td className="muted">Price</td><td>{sel.project.price || '—'}</td></tr>
                        <tr><td className="muted">Possession</td><td>{sel.project.possession || '—'}</td></tr>
                      </tbody>
                    </table>
                  ) : <p className="crm-msg">This project has since been removed from the map.</p>}
                  {sel.project && (
                    <div className="adm-actions" style={{ marginTop: 8 }}>
                      <a className="adm-btn ghost sm" href={`/map?pin=${encodeURIComponent(sel.project.id)}`} target="_blank" rel="noopener"><i className="fas fa-map-location-dot" /> View on map</a>
                      <ShareLinkButton pinId={sel.project.id} />
                    </div>
                  )}
                </div>
                {sel.account ? (
                  <div className="crm-block">
                    <h4>{accountRole(sel.account.role).label} account {sel.account.signed_in ? <span className="ml-badge"><i className="fas fa-user-check" /> Enquired while signed in</span> : null}</h4>
                    <div className="acs-stats">
                      <div><b>{sel.account.last_login_at ? leadWhen(sel.account.last_login_at) : '—'}</b><span>Last login</span></div>
                      <div><b>{sel.account.login_count}</b><span>Sign-ins</span></div>
                      <div><b>{sel.account.enquiry_count}</b><span>Enquiries</span></div>
                    </div>
                    <table className="adm-table">
                      <tbody>
                        <tr><td className="muted">Account name</td><td>{sel.account.name || '—'}</td></tr>
                        <tr><td className="muted">Account email</td><td>{sel.account.email || '—'}</td></tr>
                        <tr><td className="muted">Account mobile</td><td>{sel.account.mobile || '—'}</td></tr>
                        {([['configuration', 'Looking for'], ['budget', 'Budget'], ['area', 'Preferred area'], ['timeline', 'Planning to buy'], ['purpose', 'Buying for']] as const).map(([k, lbl]) => (
                          <tr key={k}><td className="muted">{lbl}</td><td>{sel.account?.profile?.[k] || '—'}</td></tr>
                        ))}
                        <tr><td className="muted">Compare list</td><td>{sel.account.compare_count ? `${sel.account.compare_count} project${sel.account.compare_count === 1 ? '' : 's'}` : '—'}</td></tr>
                        {sel.account.member_since && <tr><td className="muted">Member since</td><td>{new Date(sel.account.member_since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="crm-meta">Guest enquiry — this person doesn&apos;t have an account.</p>
                )}
              </>
            ) : isSignup && sel.buyer ? (
              <>
                <div className="acs-stats">
                  <div><b>{sel.buyer.last_login_at ? leadWhen(sel.buyer.last_login_at) : '—'}</b><span>Last login</span></div>
                  <div><b>{sel.buyer.login_count}</b><span>Sign-ins</span></div>
                  <div><b>{sel.buyer.enquiries.length}</b><span>Enquiries</span></div>
                </div>
                <div className="crm-block">
                  <h4>Looking for</h4>
                  <table className="adm-table">
                    <tbody>
                      {([['configuration', 'Configuration'], ['budget', 'Budget'], ['area', 'Preferred area'], ['timeline', 'Planning to buy'], ['purpose', 'Buying for']] as const).map(([k, lbl]) => (
                        <tr key={k}><td className="muted">{lbl}</td><td>{sel.buyer?.profile?.[k] || '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="crm-block">
                  <h4>Projects they enquired about {sel.buyer.enquiries.length ? `(${sel.buyer.enquiries.length})` : ''}</h4>
                  {sel.buyer.enquiries.length ? (
                    <ul className="bl-list">
                      {sel.buyer.enquiries.map((e, i) => (
                        <li key={i}>
                          <a href={`/map?pin=${encodeURIComponent(e.project.id)}`} target="_blank" rel="noopener">{e.project.title}{e.project.number != null ? ` #${e.project.number}` : ''}</a>
                          {e.site_visit && <small style={{ color: '#2f7a3c', fontWeight: 600 }}><i className="fas fa-calendar-check" /> Site visit{e.site_visit_slot ? `: ${e.site_visit_slot}` : ' requested'}</small>}
                          <small>{e.project.location || ''}{e.at ? ` · ${leadWhen(e.at)}` : ''}</small>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="crm-meta" style={{ marginTop: 0 }}>No enquiries yet.</p>}
                </div>
                <div className="crm-block">
                  <h4>Compare list {sel.buyer.compare.length ? `(${sel.buyer.compare.length})` : ''}</h4>
                  {sel.buyer.compare.length ? (
                    <ul className="bl-list">
                      {sel.buyer.compare.map((c) => (
                        <li key={c.id}>
                          <a href={`/map?pin=${encodeURIComponent(c.id)}`} target="_blank" rel="noopener">{c.title}{c.number != null ? ` #${c.number}` : ''}</a>
                          <small>{c.location}</small>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="crm-meta" style={{ marginTop: 0 }}>Nothing in their compare list.</p>}
                </div>
                {!sel.buyer.account_exists && <p className="crm-meta">This buyer&apos;s account has since been deleted.</p>}
              </>
            ) : (
              <div className="crm-block"><h4>Message</h4><p className="crm-msg">{sel.message || '—'}</p></div>
            )}

            {isOwner && (
              <div className="crm-block lead-wa">
                <h4><i className="fab fa-whatsapp" /> Share this lead</h4>
                <div className="lead-wa-btns">
                  <button type="button" className="adm-btn primary sm" onClick={() => shareWithAnyone(leadShareText(sel))} title="Share this lead's details — you choose the app and contact"><i className="fas fa-share-nodes" /> Share</button>
                  {/* The employee this lead is transferred to comes first. */}
                  {[...waStaff].sort((a, b) => Number(b.id === sel.assigned_to) - Number(a.id === sel.assigned_to)).map((e) => (
                    <button key={e.id} type="button" className={`adm-btn sm ${e.id === sel.assigned_to ? 'primary' : 'ghost'}`} onClick={() => sendToEmployee([sel], e.id)} title={`Open WhatsApp to ${e.mobile} with this lead`}>
                      <i className="fab fa-whatsapp" /> {e.name}{e.id === sel.assigned_to ? ' (assigned)' : ''}
                    </button>
                  ))}
                </div>
                {!waStaff.length && <p className="crm-meta" style={{ margin: '6px 0 0' }}>Add a WhatsApp number to your employees (Employees → Edit) to send leads to them here.</p>}
                {staff.length > waStaff.length && waStaff.length > 0 && (
                  <p className="crm-meta" style={{ margin: '6px 0 0' }}>{staff.length - waStaff.length} employee{staff.length - waStaff.length === 1 ? ' has' : 's have'} no WhatsApp number yet (Employees → Edit).</p>
                )}
              </div>
            )}
            <p className="crm-meta">{isSignup ? 'Signed up' : 'Received'} {leadWhen(sel.created_at)} · via {isMap ? (sel.integration ? `partner website ${sel.integration.website} (Developer API: ${sel.integration.app_name}; consent stated by the partner)` : 'Enquire on the live map') : (sel.source || 'contact form')}</p>
          </>
        )}

        {ptab === 'activity' && (
          sel.activity?.length ? (
            <ul className="crm3-timeline">
              {sel.activity.map((e) => (
                <li key={e.id}>
                  <span className="ic"><i className={`fas ${LEAD_EVENT_ICON[e.type]}`} /></span>
                  <span className="t">
                    <span>{leadEventText(e)}</span>
                    <small>{e.by_name || 'Someone'}{e.by_role === 'admin' ? ' (super admin)' : ''} · <span title={fullDate(e.at)}>{leadWhen(e.at)}</span></small>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="crm-meta">No notes or activity yet. Notes, status changes, follow-ups and transfers show here.</p>
        )}

        {ptab === 'notes' && (
          <>
            <div className="crm-block">
              <h4>Add a note</h4>
              <textarea ref={noteRef} className="crm-notes" rows={3} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="e.g. Called — wants a site visit on Saturday" />
              <div className="adm-actions" style={{ marginTop: 8 }}>
                <button className="adm-btn primary sm" disabled={busy || !noteDraft.trim()} onClick={addNote}><i className="fas fa-plus" /> Add note</button>
              </div>
              {sel.activity?.some((e) => e.type === 'note') ? (
                <ul className="crm3-timeline" style={{ marginTop: 12 }}>
                  {sel.activity.filter((e) => e.type === 'note').map((e) => (
                    <li key={e.id}>
                      <span className="ic"><i className={`fas ${LEAD_EVENT_ICON.note}`} /></span>
                      <span className="t"><span>{e.text}</span><small>{e.by_name || 'Someone'}{e.by_role === 'admin' ? ' (super admin)' : ''} · <span title={fullDate(e.at)}>{leadWhen(e.at)}</span></small></span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {(isOwner || sel.notes) && (
              <div className="crm-block">
                <h4>Internal notes</h4>
                {isOwner ? (
                  <>
                    <textarea className="crm-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Private notes for the super admin…" />
                    <div className="adm-actions" style={{ marginTop: 8 }}>
                      <button className="adm-btn primary sm" disabled={busy || notes === (sel.notes || '')} onClick={saveNotes}><i className="fas fa-floppy-disk" /> Save notes</button>
                      <button className="adm-btn danger sm" onClick={() => remove(sel)}><i className="fas fa-trash" /> Delete lead</button>
                    </div>
                  </>
                ) : <p className="crm-msg">{sel.notes}</p>}
              </div>
            )}
          </>
        )}
      </div>

      <div className="crm3-pfoot four">
        {sel.phone
          ? <a className="call" href={`tel:${sel.phone.replace(/\s/g, '')}`}><i className="fas fa-phone" /> Call</a>
          : <span className="call off"><i className="fas fa-phone" /> Call</span>}
        {digits(sel.phone)
          ? <a className="wa" href={`https://wa.me/${digits(sel.phone)}`} target="_blank" rel="noopener"><i className="fab fa-whatsapp" /> WhatsApp</a>
          : <span className="off wa"><i className="fab fa-whatsapp" /> WhatsApp</span>}
        {sel.email
          ? <a className="mail" href={`mailto:${sel.email}`}><i className="fas fa-envelope" /> Email</a>
          : <span className="off mail"><i className="fas fa-envelope" /> Email</span>}
        <details className="crm3-pmore">
          <summary><i className="fas fa-ellipsis" /> More</summary>
          <div className="crm3-pmore-menu" onClick={(e) => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
            <button type="button" onClick={() => { setPtab('notes'); setTimeout(() => noteRef.current?.focus(), 0); }}><i className="fas fa-file-pen" /> Add note</button>
            <button type="button" onClick={() => setPtab('activity')}><i className="fas fa-clock-rotate-left" /> Activity</button>
            {isOwner && <button type="button" onClick={() => shareWithAnyone(leadShareText(sel))}><i className="fas fa-share-nodes" /> Share lead</button>}
            {isOwner && <button type="button" className="danger" onClick={() => remove(sel)}><i className="fas fa-trash" /> Delete lead</button>}
          </div>
        </details>
      </div>
    </aside>
  );

  return (
    <>
    <div className="crm3">
      <header className="crm3-head">
        <span className="crm3-head-ic" aria-hidden="true"><i className="fas fa-people-group" /></span>
        <div className="crm3-head-t">
          <h2>CRM &amp; Leads</h2>
          <p>Manage enquiries, follow-ups and convert leads into site visits.</p>
        </div>
        <div className="crm3-head-art">
          <button type="button" className="crm3-promo" onClick={() => setFilter('new')} title="Show new leads to work on">
            <span className="ic" aria-hidden="true"><i className="fas fa-bullseye" /></span>
            <span>Turn enquiries into site visits</span>
            <span className="go" aria-hidden="true"><i className="fas fa-arrow-right" /></span>
          </button>
        </div>
        <div className="crm3-head-acts">
          {isOwner && <button type="button" className="crm3-btn" onClick={() => { setTeamOpen(true); loadTeamFeed(); }}><i className="fas fa-clock-rotate-left" /> Team Activity</button>}
          {isOwner
            ? <button type="button" className="crm3-btn primary" onClick={() => setAddOpen(true)}><i className="fas fa-plus" /> Add Lead</button>
            : <button type="button" className="crm3-btn primary" onClick={() => load()} disabled={loading}><i className={`fas fa-rotate${loading ? ' fa-spin' : ''}`} /> Refresh Leads</button>}
        </div>
      </header>

      {!isOwner && (
        <p className="muted crm2-note">
          <i className="fas fa-user-tie" /> Map enquiries and buyers assigned to you. Call or WhatsApp them, move them through the pipeline (Contacted → Site visit → Negotiation → Booked), add notes and set the next follow-up — the super admin sees everything you do.
        </p>
      )}

      <div className="crm3-kpis">
        <CrmKpi icon="fa-users" tone="green" value={totalAll} label={isOwner ? 'Total Leads' : 'My Leads'} title="All sources together" series={daySeries(allLeads.map((l) => l.created_at))} growth={growthPct(allLeads.map((l) => l.created_at))} />
        <CrmKpi icon="fa-file-lines" tone="blue" value={new30} label="New Leads (30 days)" title={`${sourceLabel} received in the last 30 days`} series={daySeries(scoped.map((l) => l.created_at))} growth={growthPct(scoped.map((l) => l.created_at))} />
        <CrmKpi icon="fa-clock" tone="amber" value={counts.due} label="Follow-up due" title="Follow-ups due today or overdue" series={daySeries(dueLeads.map((l) => l.follow_up_at))} on={filter === 'due'} onClick={() => setFilter(filter === 'due' ? 'all' : 'due')} />
        <CrmKpi icon="fa-calendar-days" tone="violet" value={visits} label="Site Visits Booked" title="Leads at the Site visit stage or who booked a visit on the map" series={daySeries(visitLeads.map(visitDate))} growth={growthPct(visitLeads.map(visitDate))} on={filter === 'site_visit'} onClick={() => setFilter(filter === 'site_visit' ? 'all' : 'site_visit')} />
        <CrmKpi icon="fa-check" tone="teal" value={counts.won} label="Converted" title="Leads marked Booked" series={daySeries(wonLeads.map((l) => l.updated_at))} growth={growthPct(wonLeads.map((l) => l.updated_at))} on={filter === 'won'} onClick={() => setFilter(filter === 'won' ? 'all' : 'won')} />
      </div>

      <div className={`crm3-body${docked && sel ? ' has-panel' : ''}`}>
        <section className="crm3-main">
          <div className="crm3-bar">
            <div className="crm3-tabs" role="tablist" aria-label="Lead stages">
              {STAGE_TABS.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} className={`crm3-tab${filter === k ? ' on' : ''}${k === 'due' && counts.due > 0 ? ' alert' : ''}`} onClick={() => setFilter(k)} title={k === 'due' ? 'Follow-ups due today or overdue' : undefined}>
                  {stageTabLabel(k)} ({counts[k].toLocaleString('en-IN')})
                </button>
              ))}
              <select className={`crm3-more${MORE_STAGES.includes(filter as Lead['status']) ? ' on' : ''}`} value={MORE_STAGES.includes(filter as Lead['status']) ? filter : ''} onChange={(e) => setFilter((e.target.value || 'all') as typeof filter)} aria-label="More stages">
                <option value="">More stages…</option>
                {MORE_STAGES.map((k) => <option key={k} value={k}>{stageLabel(k)} ({counts[k].toLocaleString('en-IN')})</option>)}
              </select>
            </div>
            <div className="crm3-tools">
              <label className="crm3-search">
                <i className="fas fa-magnifying-glass" />
                <input placeholder={isMap ? 'Search name, email, phone, project…' : 'Search name, email, phone…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
                {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><i className="fas fa-xmark" /></button>}
              </label>
              {isMap && <LocationSelect items={bySource.map} value={loc} onChange={setLoc} />}
              <select className="crm-select" aria-label="Lead source" value={source} onChange={(e) => switchSource(e.target.value as LeadSource)}>
                <option value="map">{isOwner ? 'Map enquiries' : 'My map enquiries'} ({bySource.map.length})</option>
                <option value="signup">Buyer accounts ({bySource.signup.length})</option>
                {isOwner && <option value="contact">Contact &amp; added ({bySource.contact.length})</option>}
              </select>
              <details className="crm3-dl crm3-filters">
                <summary className={`crm3-fbtn${activeFilters ? ' on' : ''}`}><i className="fas fa-filter" /> Filters{activeFilters > 0 && <em>{activeFilters}</em>}</summary>
                <div className="crm3-dl-menu crm3-fmenu">
                  {isMap && (
                    <label><span>Enquirer type</span>
                      <select className="crm-select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                        <option value="all">All types ({bySource.map.filter((l) => matchesLocation(l, loc)).length})</option>
                        {PEOPLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_META[r].label} ({roleCount(r)})</option>)}
                      </select>
                    </label>
                  )}
                  {showAssign && (
                    <label><span>Assigned to</span>
                      <select className="crm-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                        <option value="">Anyone</option>
                        <option value={UNASSIGNED}>Not assigned ({all.filter((l) => !l.assigned_to).length})</option>
                        {staff.map((e) => <option key={e.id} value={e.id}>{e.name} ({all.filter((l) => l.assigned_to === e.id).length})</option>)}
                      </select>
                    </label>
                  )}
                  <label><span>Sort</span>
                    <select className="crm-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} disabled={filter === 'due'} title={filter === 'due' ? 'Follow-ups are listed by due time' : undefined}>
                      <option value="new">Newest first</option>
                      <option value="old">Oldest first</option>
                      <option value="activity">Recent activity</option>
                    </select>
                  </label>
                  {activeFilters > 0 && <button type="button" className="link-btn" onClick={() => { setRole('all'); setAssignee(''); setSort('new'); }}>Clear filters</button>}
                </div>
              </details>
              {isOwner && (
                <details className="crm3-dl">
                  <summary className="crm3-icon" title="Download CSV (follows your filters)" aria-label="Download CSV"><i className="fas fa-download" /></summary>
                  <div className="crm3-dl-menu" onClick={(e) => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
                    <small>Download CSV — follows your filters</small>
                    {isMap ? PEOPLE_ROLES.map((r) => (
                      <button key={r} type="button" disabled={!forDownload(r).length} onClick={() => downloadMap(r)}>
                        <i className="fas fa-file-csv" /> {ROLE_META[r].label}<b>{forDownload(r).length}</b>
                      </button>
                    )) : (
                      <button type="button" disabled={!list.length} onClick={downloadContact}><i className="fas fa-file-csv" /> {isSignup ? 'Buyer accounts' : 'Contact & added leads'}<b>{list.length}</b></button>
                    )}
                  </div>
                </details>
              )}
              <button type="button" className="crm3-icon" onClick={() => load()} disabled={loading} title="Refresh leads" aria-label="Refresh leads"><i className={`fas fa-rotate${loading ? ' fa-spin' : ''}`} /></button>
            </div>
          </div>

          <div className="crm3-sub">
            <span>
              <b>{!isOwner ? (isMap ? 'My map enquiries' : 'My buyer leads') : `All ${sourceLabel}`}</b> ({list.length.toLocaleString('en-IN')})
              {filter !== 'all' && <> · {filter === 'due' ? 'Follow-up due' : stageLabel(filter)} <button type="button" className="link-btn" onClick={() => setFilter('all')}>clear</button></>}
              {' · '}
              {isMap
                ? <>Only people who tapped <b>Enquire</b> on a project card. Every buyer who created an account is under{' '}
                  <button type="button" className="link-btn" onClick={() => switchSource('signup')}>Buyer accounts</button>.</>
                : isSignup ? 'Every buyer who created an account, with what they are looking for.'
                  : 'Messages from the website’s Contact page and leads added by hand.'}
            </span>
            <span className={`crm2-live${live ? '' : ' off'}`} title={live ? 'Live — updates automatically' : 'Reconnecting…'}><i className="fas fa-circle" /> {live ? 'Live' : 'Offline'}</span>
          </div>

          {isOwner && pick.of(shownIds).length > 0 && (
            <BulkBar sel={pick} ids={shownIds} hint="">
              <select className="crm-select" value="" disabled={busy} aria-label="Set status of selected leads"
                onChange={(e) => { if (e.target.value) setStatusMany(pick.of(list.map((l) => l.id)), e.target.value as Lead['status']); }}>
                <option value="">Set status…</option>
                {LEAD_STAGES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
              </select>
              {staff.length > 0 && !isContact && (
                <select className="crm-select" value="" disabled={busy} aria-label="Transfer selected leads to an employee"
                  onChange={(e) => { if (e.target.value) assignMany(pick.of(list.map((l) => l.id)), e.target.value); }}>
                  <option value="">Transfer to…</option>
                  {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  <option value={UNASSIGNED}>Nobody (unassign)</option>
                </select>
              )}
              <button className="adm-btn ghost sm" disabled={busy} title="Share the selected leads' details — you choose the app and contact"
                onClick={() => { const ids = pick.of(list.map((l) => l.id)); shareWithAnyone(joinLeads(list.filter((l) => ids.includes(l.id)))); }}>
                <i className="fas fa-share-nodes" /> Share
              </button>
              {waStaff.length > 0 && (
                <select className="crm-select" value="" disabled={busy} aria-label="Send selected leads to an employee on WhatsApp"
                  onChange={(e) => { if (e.target.value) { const ids = pick.of(list.map((l) => l.id)); sendToEmployee(list.filter((l) => ids.includes(l.id)), e.target.value); } }}>
                  <option value="">WhatsApp to employee…</option>
                  {waStaff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              <button className="adm-btn danger sm" disabled={busy} onClick={() => { const ids = pick.of(list.map((l) => l.id)); if (confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}? You can restore them from Backups → Recycle bin.`)) removeMany(ids); }}><i className="fas fa-trash" /> Delete</button>
            </BulkBar>
          )}

          {loading ? (
            <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
          ) : list.length === 0 ? (
            <div className="adm-empty">
              <i className={`fas ${isMap ? 'fa-map-location-dot' : isSignup ? 'fa-user-plus' : 'fa-address-book'}`} />
              <p>{all.length === 0
                ? (!isOwner ? 'No leads have been transferred to you yet. The super admin will assign them to you.'
                  : isMap ? 'No map enquiries yet. When someone taps Enquire on a project card on the live map, it appears here.'
                  : isSignup ? 'No buyer accounts yet. When a buyer creates an account, they appear here as a lead.'
                    : 'No leads yet. Submissions from the Contact form and leads you add appear here.')
                : 'Nothing matches these filters.'}</p>
            </div>
          ) : (
            <div className="crm3-scroll">
              <table className="crm3-table">
                <thead>
                  <tr>
                    <th className="pick">{isOwner && <PickAll sel={pick} ids={shownIds} label={`Select all ${shownIds.length} on this page`} />}</th>
                    <th className="num">#</th>
                    <th>Lead</th>
                    <th>Contact</th>
                    <th>{isContact ? 'Topic' : 'Looking For'}</th>
                    <th>{isMap ? 'Project / Location' : 'Location'}</th>
                    <th>Source</th>
                    <th>Status</th>
                    {showAssign && <th>Assigned To</th>}
                    <th>Last Activity</th>
                    <th className="acts">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l, i) => {
                    const src = srcInfo(l);
                    const want = wantOf(l);
                    return (
                      <tr key={l.id} className={`${pick.has(l.id) ? 'picked' : ''}${sel?.id === l.id ? ' on' : ''}`} onClick={() => open(l)}>
                        <td className="pick" onClick={(e) => e.stopPropagation()}>{isOwner && <PickOne sel={pick} id={l.id} label={l.name || l.email || 'lead'} />}</td>
                        <td className="num">{firstRow + i + 1}</td>
                        <td className="c-lead">
                          <div className="crm3-lead">
                            <span className={`crm3-av ${avTone(l.name || l.email || '')}`}>{initials(l)}</span>
                            <span className="t">
                              <b>{l.name || '—'}</b>
                              {isSignup && l.buyer && !l.buyer.account_exists && <small><i className="fas fa-user-xmark" /> Account deleted</small>}
                            </span>
                          </div>
                        </td>
                        <td className="c-contact">
                          {l.phone ? <span className="pri">{l.phone}</span> : null}
                          {l.email && <small className="em" title={l.email}>{l.email}</small>}
                          {!l.phone && !l.email && <span className="muted">—</span>}
                        </td>
                        <td className="c-look">
                          <span className={want ? 'pri' : 'muted'}>{want || '—'}</span>
                          {isContact && l.message && <small className="crm2-msg" title={l.message}>{l.message}</small>}
                        </td>
                        <td className="c-proj">
                          {isMap ? (
                            <>
                              <span className="pri">{projectName(l) || <span className="muted">Project removed</span>}</span>
                              {(l.locations?.length || l.project?.location) ? <small>{l.locations?.length ? l.locations.join(', ') : l.project?.location}</small> : null}
                            </>
                          ) : (
                            <span className={locationOf(l) ? 'pri' : 'muted'}>{locationOf(l) || '—'}</span>
                          )}
                        </td>
                        <td className="c-src">
                          <div className="crm3-src">
                            <span className={`crm3-src-ic ${src.tone}`}><i className={src.icon} /></span>
                            <span>
                              <span className="pri">{src.label}</span>
                              {isMap && (
                                <small title={l.account ? `${l.account.last_login_at ? `Last login ${leadWhen(l.account.last_login_at)}` : 'No login yet'}${l.account.login_count ? ` · ${l.account.login_count} sign-in${l.account.login_count === 1 ? '' : 's'}` : ''}` : 'No account'}>
                                  {src.sub} · {l.account ? <span className="acc"><i className="fas fa-user-check" /> {l.account.signed_in ? 'Signed in' : 'Has account'}</span> : 'Guest'}
                                </small>
                              )}
                              {isContact && src.sub && <small>{src.sub}</small>}
                            </span>
                          </div>
                        </td>
                        <td className="c-status">
                          <span className={`crm3-pill ${l.status}`}><i className="dot" />{stageLabel(l.status)}</span>
                          {l.follow_up_at && <small style={{ color: isOverdue(l.follow_up_at) ? '#b42318' : undefined }} title={fullDate(l.follow_up_at)}><i className="fas fa-calendar-check" /> {isOverdue(l.follow_up_at) ? 'Overdue' : 'Follow-up'} {leadWhen(l.follow_up_at)}</small>}
                          {isMap && l.site_visit_requested_at && <small className="crm2-visit" title={`${l.site_visit_slot || 'Site visit requested'} · booked ${fullDate(l.site_visit_requested_at)}`}><i className="fas fa-calendar-check" /> Visit {l.site_visit_slot ? l.site_visit_slot.split(' · ')[0] : 'requested'}</small>}
                        </td>
                        {showAssign && (
                          <td className="c-who">
                            {l.assigned_name
                              ? <span className="crm3-who" title="Transferred to"><span className={`crm3-av sm solid ${avTone(l.assigned_name)}`}>{nameInitials(l.assigned_name)}</span>{l.assigned_name}</span>
                              : <span className="crm3-who none"><span className="crm3-av sm"><i className="fas fa-user" /></span>Unassigned</span>}
                          </td>
                        )}
                        <td className="c-last" title={[
                          `Last activity: ${fullDate(l.last_activity_at || l.created_at)}${l.last_activity_at ? ` by ${l.last_activity_by}` : ''}`,
                          `${isSignup ? 'Signed up' : 'Received'}: ${fullDate(l.created_at)}`,
                          isMap && l.account ? `${l.account.last_login_at ? `Last login ${leadWhen(l.account.last_login_at)}` : 'No login yet'}${l.account.login_count ? ` · ${l.account.login_count} sign-ins` : ''}` : '',
                          isMap && (l.enquiry_clicks || 1) > 1 ? `Tapped Enquire ${l.enquiry_clicks}× · last ${leadWhen(l.last_enquired_at || undefined)}` : '',
                          isSignup ? [l.buyer?.last_login_at ? `Last login ${leadWhen(l.buyer.last_login_at)}` : 'Not signed in yet', l.buyer?.login_count ? `${l.buyer.login_count} sign-ins` : '', l.buyer?.enquiries.length ? `${l.buyer.enquiries.length} enquiries` : '', l.buyer?.compare.length ? `${l.buyer.compare.length} in compare` : ''].filter(Boolean).join(' · ') : '',
                        ].filter(Boolean).join(' · ')}>
                          <span className="pri">{leadWhen(l.last_activity_at || l.created_at)}</span>
                          <small>
                            {l.last_activity_at ? `by ${l.last_activity_by}`
                              : isSignup ? (l.buyer?.last_login_at ? `Last login ${leadWhen(l.buyer.last_login_at)}` : 'Not signed in yet')
                                : isMap && (l.enquiry_clicks || 1) > 1 ? `${l.enquiry_clicks}× enquired`
                                  : isMap && l.account?.login_count ? `${l.account.login_count} sign-in${l.account.login_count === 1 ? '' : 's'}`
                                    : `${isSignup ? 'Signed up' : 'Received'}`}
                          </small>
                        </td>
                        <td className="c-acts" onClick={(e) => e.stopPropagation()}>
                          <div className="crm3-acts">
                            {l.phone
                              ? <a href={`tel:${l.phone.replace(/\s/g, '')}`} title={`Call ${l.phone}`} aria-label={`Call ${l.name}`}><i className="fas fa-phone" /></a>
                              : <span className="off" title="No phone number"><i className="fas fa-phone" /></span>}
                            {digits(l.phone)
                              ? <a className="wa" href={`https://wa.me/${digits(l.phone)}`} target="_blank" rel="noopener" title="WhatsApp" aria-label={`WhatsApp ${l.name}`}><i className="fab fa-whatsapp" /></a>
                              : l.email ? <a href={`mailto:${l.email}`} title={`Email ${l.email}`} aria-label={`Email ${l.name}`}><i className="fas fa-envelope" /></a>
                                : <span className="off"><i className="fab fa-whatsapp" /></span>}
                            <button type="button" className="view" onClick={() => open(l)} title="View lead details — notes, follow-up, status, transfer" aria-label={`View details of ${l.name || l.email || 'this lead'}`}><i className="fas fa-eye" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && list.length > 0 && (
            <div className="crm3-foot">
              <span className="crm3-count">Showing {(firstRow + 1).toLocaleString('en-IN')}–{(firstRow + shown.length).toLocaleString('en-IN')} of {list.length.toLocaleString('en-IN')} leads</span>
              {pageCount > 1 && (
                <nav className="crm3-pages" aria-label="Pages">
                  <button type="button" disabled={pg <= 1} onClick={() => setPage(pg - 1)} aria-label="Previous page"><i className="fas fa-chevron-left" /></button>
                  {pageList.map((n, i) => (n === '…'
                    ? <span key={`gap${i}`} className="gap">…</span>
                    : <button key={n} type="button" className={n === pg ? 'on' : ''} aria-current={n === pg ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>))}
                  <button type="button" disabled={pg >= pageCount} onClick={() => setPage(pg + 1)} aria-label="Next page"><i className="fas fa-chevron-right" /></button>
                </nav>
              )}
              <label className="crm3-per">Rows per page
                <select className="crm-select" value={perPageS} onChange={(e) => setPerPage(e.target.value as typeof perPageS)}>
                  {LEAD_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          )}
          {!loading && truncated[source] != null && (
            <div className="adm-empty" style={{ padding: '12px 0' }}>
              <p>Only the newest {bySource[source].length} of {truncated[source]} leads are loaded here. Older leads are kept in the database.</p>
            </div>
          )}
        </section>

        {docked && detail}
      </div>
    </div>

      {teamOpen && (
        <div className="crm-drawer-overlay" onClick={() => setTeamOpen(false)}>
          <aside className="crm-drawer" onClick={(e) => e.stopPropagation()} aria-label="Team activity on leads">
            <div className="crm-drawer-head">
              <div className="crm-id big"><span className="crm-ini"><i className="fas fa-clock-rotate-left" /></span><span><b>Team activity</b><small>Notes, status changes, follow-ups and transfers on leads</small></span></div>
              <button className="adm-btn ghost sm" onClick={() => setTeamOpen(false)} aria-label="Close"><i className="fas fa-xmark" /></button>
            </div>
            <select className="crm-select" value={teamWho} onChange={(e) => setTeamWho(e.target.value)} aria-label="Filter by person" style={{ marginBottom: 10 }}>
              <option value="">Everyone</option>
              {Array.from(new Map((teamFeed || []).map((e) => [e.by_id || '', e.by_name || 'Someone'])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            {teamFeed === null ? <p className="crm-meta"><i className="fas fa-spinner fa-spin" /> Loading…</p>
              : !teamFeed.filter((e) => !teamWho || e.by_id === teamWho).length ? <p className="crm-meta">Nothing yet. When anyone adds a note, changes a status or sets a follow-up, it shows here.</p>
                : (
                  <ul className="bl-list">
                    {teamFeed.filter((e) => !teamWho || e.by_id === teamWho).map((e) => (
                      <li key={`${e.lead_id}-${e.id}`}>
                        <button type="button" className="link-btn" style={{ textAlign: 'left' }} onClick={() => openFromFeed(e)}>
                          <b>{e.by_name || 'Someone'}</b> on <b>{e.lead_name || 'a lead'}</b>
                        </button>
                        <span><i className={`fas ${LEAD_EVENT_ICON[e.type]}`} style={{ color: 'var(--muted)', marginRight: 6 }} />{leadEventText(e)}</span>
                        <small title={fullDate(e.at)}>{leadWhen(e.at)}</small>
                      </li>
                    ))}
                  </ul>
                )}
          </aside>
        </div>
      )}

      {addOpen && (
        <div className="crm3-modal-bg" onClick={() => !adding && setAddOpen(false)}>
          <form className="crm3-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); addLead(); }} aria-label="Add a lead">
            <div className="crm3-modal-head">
              <span className="crm3-modal-ic" aria-hidden="true"><i className="fas fa-user-plus" /></span>
              <div><h3>Add Lead</h3><p>A lead from a call, walk-in, referral or ad. It is saved under Contact &amp; Added.</p></div>
              <button type="button" className="crm3-x" onClick={() => setAddOpen(false)} disabled={adding} aria-label="Close"><i className="fas fa-xmark" /></button>
            </div>
            <div className="crm3-form">
              <label className="full"><span>Name *</span><input className="crm-search" required autoFocus value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Neha Joshi" maxLength={120} /></label>
              <label><span>Phone / WhatsApp</span><input className="crm-search" type="tel" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="+91 98765 43210" maxLength={30} /></label>
              <label><span>Email</span><input className="crm-search" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="name@example.com" maxLength={160} /></label>
              <label><span>Looking for</span><input className="crm-search" value={addForm.subject} onChange={(e) => setAddForm({ ...addForm, subject: e.target.value })} placeholder="e.g. 3 BHK · ₹1.5 – 2.5 Cr" maxLength={200} /></label>
              <label><span>Location</span><input className="crm-search" value={addForm.location} onChange={(e) => setAddForm({ ...addForm, location: e.target.value })} placeholder="e.g. Kharadi, Pune" maxLength={120} /></label>
              <label><span>Source</span>
                <select className="crm-select" value={addForm.source} onChange={(e) => setAddForm({ ...addForm, source: e.target.value as typeof addForm.source })}>
                  {MANUAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label><span>Status</span>
                <select className="crm-select" value={addForm.status} onChange={(e) => setAddForm({ ...addForm, status: e.target.value as Lead['status'] })}>
                  {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="full"><span>Next follow-up (optional)</span><input className="crm-search" type="datetime-local" value={addForm.follow_up} onChange={(e) => setAddForm({ ...addForm, follow_up: e.target.value })} /></label>
              <label className="full"><span>Requirement / message</span><textarea className="crm-notes" rows={3} value={addForm.message} onChange={(e) => setAddForm({ ...addForm, message: e.target.value })} placeholder="What they asked for, budget, timeline…" maxLength={2000} /></label>
            </div>
            <p className="crm3-form-hint">Add at least a phone number or an email.</p>
            <div className="crm3-modal-foot">
              <button type="button" className="crm3-btn" onClick={() => setAddOpen(false)} disabled={adding}>Cancel</button>
              <button type="submit" className="crm3-btn primary" disabled={adding}><i className={`fas ${adding ? 'fa-spinner fa-spin' : 'fa-plus'}`} /> {adding ? 'Adding…' : 'Add Lead'}</button>
            </div>
          </form>
        </div>
      )}

      {sel && !docked && (
        <div className="crm-drawer-overlay crm3-overlay" onClick={() => setSel(null)}>
          {detail}
        </div>
      )}
    </>
  );
}

/* ------------------------------- Accounts -------------------------------- */
// Everyone who signed up on the site as a buyer, developer or channel partner.
interface Account {
  id: string; email: string; name?: string; mobile?: string;
  role: 'buyer' | 'developer' | 'agent'; verified?: boolean; notes?: string;
  verification?: 'pending' | 'approved' | 'rejected'; verification_note?: string; verified_at?: string | null; verified_by?: string | null;
  /** Developers: 'viewer' = live map only, 'editor' (default) = can add projects. */
  access?: 'viewer' | 'editor';
  profile?: Record<string, string>; created_at?: string; updated_at?: string;
  // Buyer: preferred areas · agent: areas they work in · developer: where their projects are.
  locations?: string[];
  last_login_at?: string; login_count?: number;
  stats?: { enquiries: number; contacts: number; projects: number; logins: number; compare: number; lastActive: string | null } | null;
}
// One entry in an account's activity (live log + events rebuilt from stored data).
interface AccountEvent {
  id: string; user_id: string; email: string; name?: string; role?: string;
  type: string; detail?: string; actor?: string; at: string; ip?: string; device?: string; derived?: boolean;
}
const EVENT_META: Record<string, { icon: string; tone: string; label: string; group: string }> = {
  signup: { icon: 'fa-user-plus', tone: 'blue', label: 'Signed up', group: 'signup' },
  login: { icon: 'fa-right-to-bracket', tone: 'green', label: 'Signed in', group: 'signin' },
  logout: { icon: 'fa-right-from-bracket', tone: 'grey', label: 'Signed out', group: 'signin' },
  compare: { icon: 'fa-code-compare', tone: 'violet', label: 'Compare list', group: 'enquiry' },
  favorite: { icon: 'fa-heart', tone: 'rose', label: 'Favourites', group: 'enquiry' },
  enquiry: { icon: 'fa-envelope-open-text', tone: 'amber', label: 'Map enquiry', group: 'enquiry' },
  contact: { icon: 'fa-message', tone: 'amber', label: 'Contact form', group: 'enquiry' },
  project_added: { icon: 'fa-map-pin', tone: 'blue', label: 'Project added', group: 'projects' },
  project_edited: { icon: 'fa-pen', tone: 'blue', label: 'Project edited', group: 'projects' },
  project_deleted: { icon: 'fa-trash', tone: 'red', label: 'Project deleted', group: 'projects' },
  project_approved: { icon: 'fa-circle-check', tone: 'green', label: 'Project approved', group: 'projects' },
  project_rejected: { icon: 'fa-circle-xmark', tone: 'red', label: 'Project not approved', group: 'projects' },
  project_delete_requested: { icon: 'fa-trash-can', tone: 'red', label: 'Delete requested', group: 'projects' },
  project_delete_approved: { icon: 'fa-trash', tone: 'red', label: 'Delete approved', group: 'projects' },
  project_delete_rejected: { icon: 'fa-rotate-left', tone: 'green', label: 'Delete declined', group: 'projects' },
  approved: { icon: 'fa-circle-check', tone: 'green', label: 'Verified', group: 'admin' },
  rejected: { icon: 'fa-circle-xmark', tone: 'red', label: 'Rejected', group: 'admin' },
  reset: { icon: 'fa-rotate-left', tone: 'grey', label: 'Back to pending', group: 'admin' },
  password_reset: { icon: 'fa-key', tone: 'grey', label: 'Password reset', group: 'admin' },
  notes: { icon: 'fa-note-sticky', tone: 'grey', label: 'Notes updated', group: 'admin' },
  profile_edited: { icon: 'fa-id-card', tone: 'blue', label: 'Details updated', group: 'admin' },
  project_admin_edit: { icon: 'fa-user-pen', tone: 'blue', label: 'Project corrected', group: 'projects' },
  deleted: { icon: 'fa-user-xmark', tone: 'red', label: 'Account deleted', group: 'admin' },
  access: { icon: 'fa-user-lock', tone: 'blue', label: 'Access changed', group: 'admin' },
  role_changed: { icon: 'fa-arrow-right-arrow-left', tone: 'blue', label: 'Type changed', group: 'admin' },
};
const FEED_FILTERS = [['all', 'All'], ['signin', 'Sign-ins'], ['signup', 'Sign-ups'], ['enquiry', 'Enquiries'], ['projects', 'Projects'], ['admin', 'Staff actions']] as const;
const eventMeta = (t: string) => EVENT_META[t] || { icon: 'fa-circle', tone: 'grey', label: t, group: 'all' };
const fullWhen = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const FEED_FILTER_LABEL: Record<(typeof FEED_FILTERS)[number][0], string> = {
  all: 'All activity', signin: 'Sign-ins & sign-outs', signup: 'New sign-ups', enquiry: 'Enquiries & compare', projects: 'Projects', admin: 'Staff actions',
};
const timeOnly = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function dayLabel(d: string) {
  const day = new Date(d); const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(day.toDateString()).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString('en-IN', { weekday: diff < 7 ? 'long' : undefined, day: 'numeric', month: 'short', year: diff > 300 ? 'numeric' : undefined });
}

/** Activity as plain sentences, grouped by day. */
function ActivityList({ items, onPick, showWho }: { items: AccountEvent[]; onPick?: (e: AccountEvent) => void; showWho?: boolean }) {
  const groups: { day: string; items: AccountEvent[] }[] = [];
  for (const e of items) {
    const day = dayLabel(e.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e); else groups.push({ day, items: [e] });
  }
  return (
    <div className="acs-act">
      {groups.map((g) => (
        <div className="acs-act-day" key={g.day}>
          <h5>{g.day}</h5>
          <ul>
            {g.items.map((e) => {
              const m = eventMeta(e.type);
              const inner = (
                <>
                  <span className={`acs-act-ic t-${m.tone}`}><i className={`fas ${m.icon}`} /></span>
                  <span className="acs-act-tx">
                    {showWho ? <b>{e.name || e.email}</b> : <b>{m.label}</b>}
                    <span>{e.detail || m.label}{e.actor && m.group === 'admin' ? ` · by ${e.actor}` : ''}</span>
                  </span>
                  <time title={fullWhen(e.at)}>{timeOnly(e.at)}</time>
                </>
              );
              return (
                <li key={e.id}>
                  {onPick ? <button type="button" className="acs-act-row" onClick={() => onPick(e)}>{inner}</button> : <div className="acs-act-row">{inner}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

const ACCOUNT_ROLES = ROLE_META;
// Sign-up form fields per role, in form order, with readable labels.
const PROFILE_FIELDS: Record<Account['role'], [string, string][]> = {
  buyer: [['area', 'Preferred area'], ['configuration', 'Configuration'], ['budget', 'Budget'], ['timeline', 'Planning to buy'], ['purpose', 'Buying for']],
  developer: [['company', 'Company'], ['designation', 'Their role'], ['activeProjects', 'Active projects'], ['reraProject', 'MahaRERA project no.'], ['website', 'Website']],
  agent: [['agency', 'Agency / firm'], ['reraAgent', 'MahaRERA agent no.'], ['areas', 'Areas they work in']],
};
const orgOf = (a: Account) => a.profile?.company || a.profile?.agency || a.profile?.area || '';
// Developer/agent verification state (buyers never need it).
const statusOf = (a: Account): 'pending' | 'approved' | 'rejected' =>
  a.role === 'buyer' ? 'approved' : a.verification || (a.verified === false ? 'pending' : 'approved');
const reraOf = (a: Account) => a.profile?.reraProject || a.profile?.reraAgent || '';
// MahaRERA's public search pages (projects / agents) — the number is copied so it can be pasted there.
const MAHARERA_SEARCH = { developer: 'https://maharera.maharashtra.gov.in/projects-search-result', agent: 'https://maharera.maharashtra.gov.in/agents-search-result' };

function AccountsPanel({ flash, isOwner, onPendingChange, focusId, onFocusDone, onOpenProjects }: {
  flash: (m: string, e?: boolean) => void; isOwner: boolean; onPendingChange?: (n: number) => void;
  /** Open this account's panel once the list has loaded (e.g. from a notification). */
  focusId?: string | null; onFocusDone?: () => void;
  onOpenProjects?: (focus: { ownerId?: string; projectId?: string }) => void;
}) {
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = usePersistedState<'all' | Account['role'] | 'pending' | 'rejected'>('accounts.filter', 'all');
  const [loc, setLoc] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [sel, setSel] = useState<Account | null>(null);
  const [notes, setNotes] = useState('');
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<AccountEvent[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedFilter, setFeedFilter] = useState<(typeof FEED_FILTERS)[number][0]>('all');
  const [feedShown, setFeedShown] = useState(12);
  const [timeline, setTimeline] = useState<AccountEvent[] | null>(null);
  const [view, setView] = usePersistedState<'accounts' | 'activity'>('accounts.view', 'accounts', ['accounts', 'activity']);
  const [devProjects, setDevProjects] = useState<DevProject[] | null>(null);
  // Super admin editing an account's details (name, login email, WhatsApp, sign-up fields).
  const [editAcc, setEditAcc] = useState<{ name: string; email: string; mobile: string; profile: Record<string, string> } | null>(null);
  async function saveAccount(a: Account) {
    if (!editAcc) return;
    if (!editAcc.name.trim()) { flash('Please enter a name.', true); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editAcc.email.trim())) { flash('Please enter a valid email.', true); return; }
    const emailChanged = editAcc.email.trim().toLowerCase() !== a.email.toLowerCase();
    if (emailChanged && !confirm(`Change their login email to ${editAcc.email.trim()}? They will sign in with the new email from now on.`)) return;
    const ok = await patch(a.id, {
      name: editAcc.name.trim(), mobile: editAcc.mobile.trim(), profile: editAcc.profile,
      ...(emailChanged ? { email: editAcc.email.trim() } : {}),
    });
    if (ok) { setEditAcc(null); flash('Account details saved'); }
  }
  const [drawerTab, setDrawerTab] = useState<'overview' | 'activity' | 'manage'>('overview');

  async function loadFeed() {
    setFeedLoading(true);
    try {
      const r = await fetch('/api/admin/accounts/activity?limit=200', { credentials: 'same-origin' });
      const b = await r.json();
      if (r.ok) setFeed(Array.isArray(b.data) ? b.data : []);
    } catch { /* feed is optional */ } finally { setFeedLoading(false); }
  }
  async function loadTimeline(id: string) {
    setTimeline(null);
    try {
      const r = await fetch(`/api/admin/accounts/activity?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      const b = await r.json();
      setTimeline(r.ok && Array.isArray(b.data) ? b.data : []);
    } catch { setTimeline([]); }
  }
  useEffect(() => { loadFeed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/accounts', { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setRows(Array.isArray(b.data) ? b.data : []);
    } catch { flash('Could not load accounts', true); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusId || loading) return;
    const a = rows.find((x) => x.id === focusId);
    if (a) open(a); else flash('That account no longer exists', true);
    onFocusDone?.();
  }, [focusId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPending = (a: Account) => statusOf(a) === 'pending';
  // The location filter narrows every count, section and download below.
  const scoped = rows.filter((a) => matchesLocation(a, loc));
  const counts = {
    all: scoped.length,
    buyer: scoped.filter((a) => a.role === 'buyer').length,
    developer: scoped.filter((a) => a.role === 'developer').length,
    agent: scoped.filter((a) => a.role === 'agent').length,
    pending: scoped.filter(isPending).length,
    rejected: scoped.filter((a) => statusOf(a) === 'rejected').length,
  };
  const pendingTotal = rows.filter(isPending).length;
  useEffect(() => { if (!loading) onPendingChange?.(pendingTotal); }, [pendingTotal, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase();
  const matchesSearch = (a: Account) =>
    !term || [a.name, a.email, a.mobile, ...(a.locations || []), ...Object.values(a.profile || {})].some((x) => String(x || '').toLowerCase().includes(term));
  const list = scoped.filter((a) =>
    (filter === 'all' || (filter === 'pending' || filter === 'rejected' ? statusOf(a) === filter : a.role === filter)) && matchesSearch(a),
  );
  // Newest sign-ups first in the directory.
  const sorted = [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const lastActiveOf = (a: Account) => a.stats?.lastActive || a.last_login_at || a.created_at || '';
  const feedItems = feed.filter((e) => feedFilter === 'all' || eventMeta(e.type).group === feedFilter);

  function open(a: Account) {
    setSel(a); setNotes(a.notes || ''); setNewPass(''); setRejectReason(''); setRejecting(false);
    setDrawerTab('overview');
    setEditAcc(null);
    setNewRole(''); setNewAccess('editor');
    loadTimeline(a.id);
    setDevProjects(null);
    if (a.role === 'developer') {
      fetch('/api/admin/submissions', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => setDevProjects(Array.isArray(b?.data) ? (b.data as DevProject[]).filter((x) => x.owner.id === a.id) : []))
        .catch(() => setDevProjects([]));
    }
  }
  function openById(id: string) {
    const a = rows.find((x) => x.id === id);
    if (a) open(a); else flash('That account no longer exists', true);
  }

  async function decide(a: Account, decision: 'approve' | 'reject' | 'reset', access?: 'viewer' | 'editor') {
    if (decision === 'reject' && !rejectReason.trim()) { flash('Please write a reason — the applicant will see it.', true); return; }
    const ok = await patch(a.id, { decision, reason: decision === 'reject' ? rejectReason.trim() : undefined, access });
    if (!ok) return;
    setRejecting(false); setRejectReason('');
    flash(decision === 'approve'
      ? `${a.name || a.email} approved${access ? ` as ${access === 'viewer' ? 'Viewer — live map only' : 'Editor — can add projects'}` : ''}`
      : decision === 'reject' ? 'Application rejected' : 'Moved back to pending');
  }
  async function setAccess(a: Account, access: 'viewer' | 'editor') {
    if (accessLevel(a) === access) return;
    if (await patch(a.id, { access })) flash(access === 'viewer' ? `${a.name || a.email} can now only view the live map` : `${a.name || a.email} can now add and edit projects`);
  }
  // Super admin moving an account to another type (e.g. channel partner → developer).
  const [newRole, setNewRole] = useState<Account['role'] | ''>('');
  const [newAccess, setNewAccess] = useState<'viewer' | 'editor'>('editor');
  async function changeRole(a: Account) {
    if (!newRole || newRole === a.role) return;
    if (!confirm(`Move ${a.name || a.email} from ${typeLabel(a.role)} to ${typeLabel(newRole)}? They get the ${typeLabel(newRole)} dashboard from their next page load, already verified.`)) return;
    if (await patch(a.id, { role: newRole, ...(newRole === 'developer' ? { access: newAccess } : {}) })) {
      setNewRole('');
      flash(`${a.name || a.email} is now a ${typeLabel(newRole)} — fill in their ${typeLabel(newRole)} details under Overview`);
    }
  }
  async function copyRera(a: Account) {
    const n = reraOf(a);
    if (!n) return;
    try { await navigator.clipboard.writeText(n); flash(`Copied ${n} — paste it into MahaRERA's search`); } catch { /* clipboard blocked */ }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/accounts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ id, ...body }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Failed');
      setRows((ls) => ls.map((x) => (x.id === id ? { ...b.data, locations: x.locations, stats: x.stats } : x)));
      setSel((s) => (s && s.id === id ? { ...b.data, locations: s.locations, stats: s.stats } : s));
      loadFeed(); loadTimeline(id);
      return true;
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); return false; } finally { setBusy(false); }
  }

  // Ticked rows for bulk actions (ids; acted on only while still in `rows`).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pickedRows = rows.filter((a) => picked.has(a.id));
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function bulkDelete() {
    const list = pickedRows;
    if (!list.length) return;
    if (!confirm(`Delete ${list.length} account${list.length === 1 ? '' : 's'}? They will no longer be able to sign in. You can restore them from Backups → Recycle bin.`)) return;
    setBusy(true);
    const r = await fetch(`/api/admin/accounts?ids=${list.map((a) => encodeURIComponent(a.id)).join(',')}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
    const gone = r?.ok ? list.map((a) => a.id) : [];
    setBusy(false);
    setRows((ls) => ls.filter((x) => !gone.includes(x.id)));
    setPicked(new Set());
    if (sel && gone.includes(sel.id)) setSel(null);
    loadFeed();
    flash(gone.length === list.length ? `${gone.length} account${gone.length === 1 ? '' : 's'} moved to the recycle bin` : `${gone.length} deleted, ${list.length - gone.length} failed`, gone.length !== list.length);
  }

  async function bulkDecide(decision: 'approve' | 'reject') {
    const list = pickedRows.filter(isPending);
    if (!list.length) { flash('None of the selected accounts are waiting for approval.', true); return; }
    let reason = '';
    if (decision === 'reject') {
      reason = (prompt(`Reason for rejecting ${list.length} application${list.length === 1 ? '' : 's'} (the applicants will see it):`) || '').trim();
      if (!reason) return;
    } else if (!confirm(`Approve ${list.length} account${list.length === 1 ? '' : 's'} waiting for approval?`)) return;
    let ok = 0;
    for (const a of list) if (await patch(a.id, { decision, reason: reason || undefined })) ok++;
    setPicked(new Set());
    flash(`${ok} account${ok === 1 ? '' : 's'} ${decision === 'approve' ? 'approved' : 'rejected'}${ok < list.length ? `, ${list.length - ok} failed` : ''}`, ok < list.length);
  }

  async function remove(a: Account) {
    if (!confirm(`Delete the account of ${a.name || a.email}? They will no longer be able to sign in. You can restore it from Backups → Recycle bin.`)) return;
    try {
      const r = await fetch(`/api/admin/accounts?id=${encodeURIComponent(a.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setRows((ls) => ls.filter((x) => x.id !== a.id));
      setPicked((s) => { const n = new Set(s); n.delete(a.id); return n; });
      if (sel?.id === a.id) setSel(null);
      loadFeed();
      flash('Account moved to the recycle bin');
    } catch { flash('Delete failed', true); }
  }

  const statusText = (a: Account) => (a.role === 'buyer' ? 'Active' : ({ pending: 'Pending', approved: 'Verified', rejected: 'Rejected' } as const)[statusOf(a)]);
  // One file per account type, with that type's own sign-up fields as columns.
  // Follows the location / search filters on screen.
  function downloadRole(role: Account['role']) {
    const fields = PROFILE_FIELDS[role];
    const rows = list.filter((a) => a.role === role);
    downloadCsv(fileSlug('accounts', ACCOUNT_ROLES[role].file, loc ? locationLabel(loc) : ''),
      ['Name', 'Email', 'WhatsApp', 'Type', 'Status', role === 'developer' ? 'Project locations' : 'Locations', ...fields.map(([, lbl]) => lbl), 'Signed up', 'Notes'],
      rows.map((a) => [a.name, a.email, a.mobile, ACCOUNT_ROLES[role].label, statusText(a), a.locations, ...fields.map(([k]) => a.profile?.[k]), csvDate(a.created_at), a.notes]));
  }
  function downloadAll() {
    const keys = ['area', 'configuration', 'budget', 'timeline', 'purpose', 'company', 'designation', 'activeProjects', 'reraProject', 'website', 'agency', 'reraAgent', 'areas'];
    downloadCsv(fileSlug('accounts', 'all', loc ? locationLabel(loc) : ''),
      ['Name', 'Email', 'WhatsApp', 'Type', 'Status', 'Locations', 'Signed up', ...keys],
      list.map((a) => [a.name, a.email, a.mobile, ACCOUNT_ROLES[a.role]?.label, statusText(a), a.locations, csvDate(a.created_at), ...keys.map((k) => a.profile?.[k])]));
  }

  const initials = (a: Account) => (a.name || a.email || '?').slice(0, 2).toUpperCase();
  const accessLevel = (a: Account): 'viewer' | 'editor' => (a.access === 'viewer' ? 'viewer' : 'editor');
  const statusPill = (a: Account) => {
    const st = statusOf(a);
    if (st === 'pending') return <span className="crm-pill contacted"><i className="fas fa-hourglass-half" /> Pending</span>;
    if (st === 'rejected') return <span className="crm-pill lost"><i className="fas fa-circle-xmark" /> Rejected</span>;
    if (a.role === 'developer') {
      return accessLevel(a) === 'viewer'
        ? <span className="crm-pill new" title="Approved — can only view the live map"><i className="fas fa-eye" /> Viewer</span>
        : <span className="crm-pill won" title="Approved — can add and edit projects"><i className="fas fa-pen" /> Editor</span>;
    }
    return <span className="crm-pill won"><i className="fas fa-circle-check" /> {a.role === 'buyer' ? 'Active' : 'Verified'}</span>;
  };

  const TYPE_TABS = [
    ['all', 'All'], ['buyer', 'Buyers'], ['developer', 'Developers'], ['agent', 'Partners'],
    ...(counts.pending || filter === 'pending' ? [['pending', 'Waiting approval'] as const] : []),
    ...(counts.rejected || filter === 'rejected' ? [['rejected', 'Rejected'] as const] : []),
  ] as const;
  const download = () => (filter === 'buyer' || filter === 'developer' || filter === 'agent' ? downloadRole(filter) : downloadAll());
  const typeLabel = (r: Account['role']) => ({ buyer: 'Buyer', developer: 'Developer', agent: 'Partner' } as const)[r];
  const joined = (a: Account) => (a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  return (
    <div className="acs">
      <div className="acs-top">
        <div className="acs-views" role="tablist" aria-label="Accounts view">
          <button type="button" role="tab" aria-selected={view === 'accounts'} className={view === 'accounts' ? 'on' : ''} onClick={() => setView('accounts')}>
            <i className="fas fa-users" /> Accounts <span>{rows.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={view === 'activity'} className={view === 'activity' ? 'on' : ''} onClick={() => setView('activity')}>
            <i className="fas fa-clock-rotate-left" /> Activity
          </button>
        </div>
        <button type="button" className="adm-btn ghost sm" onClick={() => { load(); loadFeed(); }} title="Refresh">
          <i className={`fas fa-rotate${loading || feedLoading ? ' fa-spin' : ''}`} /> <span className="acs-hide-sm">Refresh</span>
        </button>
      </div>

      {pendingTotal > 0 && filter !== 'pending' && (
        <div className="acs-alert">
          <span className="acs-alert-ic"><i className="fas fa-user-clock" /></span>
          <div>
            <b>{pendingTotal} {pendingTotal === 1 ? 'account is' : 'accounts are'} waiting for your approval</b>
            <span>Developers and partners can&apos;t use their dashboard until you approve them.</span>
          </div>
          <button type="button" className="adm-btn primary sm" onClick={() => { setView('accounts'); setFilter('pending'); setLoc(''); setQ(''); }}>Review now</button>
        </div>
      )}

      {view === 'accounts' ? (
        <section className="adm-panel acs-panel">
          <div className="acs-tabs" role="tablist" aria-label="Account type">
            {TYPE_TABS.map(([k, lbl]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={`${filter === k ? 'on' : ''}${k === 'pending' ? ' warn' : ''}`} onClick={() => setFilter(k)}>
                {lbl} <span>{counts[k]}</span>
              </button>
            ))}
          </div>

          <div className="acs-toolbar">
            <label className="acs-search">
              <i className="fas fa-magnifying-glass" />
              <input placeholder="Search by name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
              {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><i className="fas fa-xmark" /></button>}
            </label>
            <LocationSelect items={rows} value={loc} onChange={setLoc} />
            <button type="button" className="adm-btn ghost sm" onClick={download} disabled={!list.length} title="Download this list as a CSV file">
              <i className="fas fa-download" /> <span className="acs-hide-sm">Download</span>
            </button>
          </div>

          {loading && !rows.length ? (
            <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading accounts…</p></div>
          ) : rows.length === 0 ? (
            <div className="adm-empty"><i className="fas fa-users" /><p>No accounts yet. People who sign up on the website will appear here.</p></div>
          ) : sorted.length === 0 ? (
            <div className="adm-empty"><i className="fas fa-filter" /><p>No accounts match your search.</p>
              <button className="adm-btn ghost sm" onClick={() => { setLoc(''); setQ(''); setFilter('all'); }}>Show all accounts</button></div>
          ) : (
            <>
              <div className={`acs-bulk${pickedRows.length ? ' on' : ''}`}>
                <label className="acs-pick">
                  <input
                    type="checkbox" aria-label="Select all accounts shown"
                    checked={sorted.every((a) => picked.has(a.id))}
                    ref={(el) => { if (el) el.indeterminate = !sorted.every((a) => picked.has(a.id)) && sorted.some((a) => picked.has(a.id)); }}
                    onChange={(e) => setPicked((s) => { const n = new Set(s); sorted.forEach((a) => (e.target.checked ? n.add(a.id) : n.delete(a.id))); return n; })}
                  />
                </label>
                {pickedRows.length ? (
                  <>
                    <b>{pickedRows.length} selected</b>
                    {isOwner && pickedRows.some(isPending) && (
                      <>
                        <button type="button" className="adm-btn primary sm" disabled={busy} onClick={() => bulkDecide('approve')}><i className="fas fa-circle-check" /> Approve</button>
                        <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => bulkDecide('reject')}><i className="fas fa-circle-xmark" /> Reject</button>
                      </>
                    )}
                    <button type="button" className="adm-btn danger sm" disabled={busy} onClick={bulkDelete}><i className="fas fa-trash" /> Delete</button>
                    <button type="button" className="adm-btn ghost sm" onClick={() => setPicked(new Set())}>Clear</button>
                  </>
                ) : (
                  <span className="muted">Select all {sorted.length} shown — or tick accounts to delete or approve them together</span>
                )}
              </div>
              <div className="acs-head" aria-hidden="true"><span>Name</span><span>Type</span><span>Status</span><span>Last active</span><span /></div>
              <ul className="acs-list">
                {sorted.map((a) => (
                  <li key={a.id} className={picked.has(a.id) ? 'picked' : undefined}>
                    <label className="acs-pick">
                      <input type="checkbox" checked={picked.has(a.id)} onChange={() => togglePick(a.id)} aria-label={`Select ${a.name || a.email}`} />
                    </label>
                    <button type="button" className={`acs-row${sel?.id === a.id ? ' on' : ''}`} onClick={() => open(a)}>
                      <span className={`acs-av r-${a.role}`}>{initials(a)}</span>
                      <span className="acs-who"><b>{a.name || a.email}</b><small>{a.email}</small></span>
                      <span className={`acs-type r-${a.role}`}>{typeLabel(a.role)}</span>
                      <span className="acs-status">{statusPill(a)}</span>
                      <span className="acs-when" title={fullWhen(lastActiveOf(a))}>{leadWhen(lastActiveOf(a)) || '—'}</span>
                      <i className="fas fa-chevron-right acs-go" />
                    </button>
                    <button type="button" className="acs-del" onClick={() => remove(a)} title="Delete this account" aria-label={`Delete ${a.name || a.email}`}>
                      <i className="fas fa-trash" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="acs-foot">Showing {sorted.length} of {rows.length} account{rows.length === 1 ? '' : 's'} · tap an account to see details and activity</p>
            </>
          )}
        </section>
      ) : (
        <section className="adm-panel acs-panel">
          <div className="acs-act-head">
            <div>
              <h3>Recent activity</h3>
              <p className="muted">What people did on their accounts, newest first. Tap an entry to open that account.</p>
            </div>
            <select className="crm-select" value={feedFilter} onChange={(e) => { setFeedFilter(e.target.value as typeof feedFilter); setFeedShown(15); }} aria-label="Filter activity">
              {FEED_FILTERS.map(([k]) => <option key={k} value={k}>{FEED_FILTER_LABEL[k]}</option>)}
            </select>
          </div>
          {feedLoading && !feed.length ? (
            <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading activity…</p></div>
          ) : feedItems.length === 0 ? (
            <div className="adm-empty"><i className="fas fa-clock-rotate-left" /><p>Nothing here yet. Sign-ins, sign-ups and enquiries will appear as they happen.</p></div>
          ) : (
            <>
              <ActivityList items={feedItems.slice(0, feedShown)} showWho onPick={(e) => openById(e.user_id)} />
              {feedItems.length > feedShown && (
                <div className="acs-more"><button className="adm-btn ghost sm" onClick={() => setFeedShown((n) => n + 15)}>Show older activity</button></div>
              )}
            </>
          )}
        </section>
      )}

      {sel && (
        <div className="crm-drawer-overlay" onClick={() => setSel(null)}>
          <aside className="crm-drawer acs-drawer" onClick={(e) => e.stopPropagation()} aria-label={`Account: ${sel.name || sel.email}`}>
            <div className="acs-d-head">
              <span className={`acs-av lg r-${sel.role}`}>{initials(sel)}</span>
              <div className="acs-d-id">
                <b>{sel.name || sel.email}</b>
                <span><span className={`acs-type r-${sel.role}`}>{typeLabel(sel.role)}</span> {statusPill(sel)}</span>
                {joined(sel) && <small>Joined {joined(sel)} · active {leadWhen(lastActiveOf(sel)) || '—'}</small>}
              </div>
              <button className="adm-btn ghost sm" onClick={() => setSel(null)} aria-label="Close"><i className="fas fa-xmark" /></button>
            </div>

            <div className="acs-d-contact">
              <a className="adm-btn ghost sm" href={`mailto:${sel.email}`}><i className="fas fa-envelope" /> Email</a>
              {sel.mobile && <a className="adm-btn ghost sm" href={`tel:${sel.mobile}`}><i className="fas fa-phone" /> Call</a>}
              {sel.mobile && <a className="adm-btn ghost sm" target="_blank" rel="noopener" href={`https://wa.me/${sel.mobile.replace(/\D/g, '')}`}><i className="fab fa-whatsapp" /> WhatsApp</a>}
            </div>

            {sel.role !== 'buyer' && statusOf(sel) === 'pending' && (
              <div className="acs-verify">
                <h4><i className="fas fa-user-clock" /> Waiting for your approval</h4>
                <ol>
                  <li>Check the {sel.role === 'developer' ? 'company and MahaRERA project number' : 'agency and MahaRERA agent number'} in the details below.</li>
                  <li>
                    {reraOf(sel)
                      ? <>Search <b>{reraOf(sel)}</b> on MahaRERA.{' '}
                          <a className="link-btn" href={MAHARERA_SEARCH[sel.role as 'developer' | 'agent']} target="_blank" rel="noopener" onClick={() => copyRera(sel)}>Open MahaRERA (number copied)</a></>
                      : <>No RERA number was given — ask them on WhatsApp first.</>}
                  </li>
                </ol>
                {!isOwner ? (
                  <p className="crm-meta"><i className="fas fa-lock" /> Only the super admin can approve or reject accounts.</p>
                ) : rejecting ? (
                  <div>
                    <textarea className="crm-notes" rows={3} autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason they will see, e.g. The MahaRERA number doesn't match the company name." />
                    <div className="adm-actions" style={{ marginTop: 8 }}>
                      <button className="adm-btn danger sm" disabled={busy || !rejectReason.trim()} onClick={() => decide(sel, 'reject')}>Reject application</button>
                      <button className="adm-btn ghost sm" onClick={() => { setRejecting(false); setRejectReason(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  sel.role === 'developer' ? (
                    <>
                      <p className="acs-access-q">How should they use their dashboard?</p>
                      <div className="acs-access">
                        <button type="button" disabled={busy} onClick={() => decide(sel, 'approve', 'editor')}>
                          <i className="fas fa-pen-to-square" />
                          <span><b>Approve as Editor</b><small>Can add and edit their projects. Every change waits for your approval.</small></span>
                        </button>
                        <button type="button" disabled={busy} onClick={() => decide(sel, 'approve', 'viewer')}>
                          <i className="fas fa-eye" />
                          <span><b>Approve as Viewer</b><small>Can only view the live map — the same one everyone sees.</small></span>
                        </button>
                      </div>
                      <button className="adm-btn danger sm" disabled={busy} onClick={() => setRejecting(true)} style={{ marginTop: 10 }}><i className="fas fa-circle-xmark" /> Reject</button>
                    </>
                  ) : (
                    <div className="adm-actions">
                      <button className="adm-btn primary" disabled={busy} onClick={() => decide(sel, 'approve')}><i className="fas fa-circle-check" /> Approve</button>
                      <button className="adm-btn danger" disabled={busy} onClick={() => setRejecting(true)}><i className="fas fa-circle-xmark" /> Reject</button>
                    </div>
                  )
                )}
              </div>
            )}

            <div className="acs-d-tabs" role="tablist">
              {([['overview', 'Overview'], ['activity', `Activity${timeline ? ` (${timeline.length})` : ''}`], ['manage', 'Manage']] as const).map(([k, lbl]) => (
                <button key={k} type="button" role="tab" aria-selected={drawerTab === k} className={drawerTab === k ? 'on' : ''} onClick={() => setDrawerTab(k)}>{lbl}</button>
              ))}
            </div>

            {drawerTab === 'overview' && (
              <>
                <div className="acs-stats">
                  <div><b>{sel.stats?.logins ?? sel.login_count ?? 0}</b><span>Sign-ins</span></div>
                  <div><b>{(sel.stats?.enquiries || 0) + (sel.stats?.contacts || 0)}</b><span>Enquiries</span></div>
                  {sel.role === 'developer'
                    ? <div><b>{sel.stats?.projects || 0}</b><span>Projects</span></div>
                    : <div><b>{sel.stats?.compare || 0}</b><span>In compare</span></div>}
                </div>
                <div className="acs-d-projects-head">
                  <h4>Details</h4>
                  {isOwner && !editAcc && (
                    <button type="button" className="link-btn" onClick={() => setEditAcc({
                      name: sel.name || '', email: sel.email || '', mobile: sel.mobile || '',
                      profile: Object.fromEntries((PROFILE_FIELDS[sel.role] || []).map(([k]) => [k, sel.profile?.[k] || ''])),
                    })}><i className="fas fa-pen" /> Edit details</button>
                  )}
                </div>
                {editAcc ? (
                  <div className="dp-edit">
                    <label className="dp-field"><span>Name *</span><input value={editAcc.name} onChange={(e) => setEditAcc((m) => m && { ...m, name: e.target.value })} /></label>
                    <label className="dp-field"><span>Email (used to sign in) *</span><input type="email" value={editAcc.email} onChange={(e) => setEditAcc((m) => m && { ...m, email: e.target.value })} /></label>
                    <div className="dp-field"><span>WhatsApp number</span><PhoneInput value={editAcc.mobile} onChange={(v) => setEditAcc((m) => m && { ...m, mobile: v })} /></div>
                    {(PROFILE_FIELDS[sel.role] || []).map(([k, lbl]) => (
                      <label className="dp-field" key={k}><span>{lbl}</span>
                        <input value={editAcc.profile[k] || ''} onChange={(e) => setEditAcc((m) => m && { ...m, profile: { ...m.profile, [k]: e.target.value } })} />
                      </label>
                    ))}
                    <div className="adm-actions">
                      <button className="adm-btn primary sm" disabled={busy} onClick={() => saveAccount(sel)}><i className="fas fa-floppy-disk" /> Save details</button>
                      <button className="adm-btn ghost sm" disabled={busy} onClick={() => setEditAcc(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <dl className="acs-dl">
                    <div><dt>Email</dt><dd>{sel.email}</dd></div>
                    {sel.mobile && <div><dt>WhatsApp</dt><dd>{sel.mobile}</dd></div>}
                    {PROFILE_FIELDS[sel.role]?.map(([k, lbl]) => <div key={k}><dt>{lbl}</dt><dd>{sel.profile?.[k] || '—'}</dd></div>)}
                    {sel.role === 'developer' && <div><dt>Project locations</dt><dd>{sel.locations?.length ? sel.locations.join(', ') : '—'}</dd></div>}
                  </dl>
                )}
                {sel.role === 'developer' && (
                  <div className="acs-d-projects">
                    <div className="acs-d-projects-head">
                      <h4>Projects they added {devProjects ? `(${devProjects.length})` : ''}</h4>
                      {!!devProjects?.length && onOpenProjects && (
                        <button type="button" className="link-btn" onClick={() => { onOpenProjects({ ownerId: sel.id }); setSel(null); }}>Review all</button>
                      )}
                    </div>
                    {devProjects === null ? <p className="crm-meta"><i className="fas fa-spinner fa-spin" /> Loading…</p>
                      : devProjects.length === 0 ? <p className="crm-meta">No projects added yet.</p>
                        : (
                          <ul>
                            {devProjects.slice(0, 8).map((x) => (
                              <li key={x.id}>
                                <button type="button" onClick={() => { onOpenProjects?.({ projectId: x.id }); setSel(null); }}>
                                  <span>{x.title || 'Untitled project'}<small>{x.location || '—'}</small></span>
                                  <span className={`dp-state s-${x.state}`}>{x.state === 'pending' ? 'Waiting' : x.state === 'approved' ? 'Live' : 'Not approved'}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                  </div>
                )}
                {sel.role !== 'buyer' && statusOf(sel) !== 'pending' && (
                  <p className="acs-d-note">
                    {statusOf(sel) === 'approved'
                      ? <><i className="fas fa-circle-check" /> Verified{sel.role === 'developer' ? ` as ${accessLevel(sel) === 'viewer' ? 'Viewer (live map only)' : 'Editor (can add projects)'}` : ''}</>
                      : <><i className="fas fa-circle-xmark" /> Rejected</>}
                    {sel.verified_at ? ` ${leadWhen(sel.verified_at)}` : ''}{sel.verified_by ? ` by ${sel.verified_by}` : ''}
                    {statusOf(sel) === 'rejected' && sel.verification_note ? <> — “{sel.verification_note}”</> : null}
                  </p>
                )}
              </>
            )}

            {drawerTab === 'activity' && (
              timeline === null ? <p className="crm-meta"><i className="fas fa-spinner fa-spin" /> Loading activity…</p>
                : timeline.length === 0 ? <p className="crm-meta">No activity recorded yet.</p>
                  : <ActivityList items={timeline} />
            )}

            {drawerTab === 'manage' && (
              <div className="acs-manage">
                <div className="acs-box">
                  <h4>Team notes</h4>
                  <p className="crm-meta">Only your team sees these.</p>
                  <textarea className="crm-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Called on 4 Oct, interested in Kharadi 3 BHK" />
                  <button className="adm-btn primary sm" disabled={busy || notes === (sel.notes || '')} onClick={async () => { if (await patch(sel.id, { notes })) flash('Notes saved'); }}>Save notes</button>
                </div>

                {sel.role === 'developer' && statusOf(sel) === 'approved' && (
                  <div className="acs-box">
                    <h4>Dashboard access</h4>
                    <p className="crm-meta">What this developer can do in their dashboard.</p>
                    <div className="acs-access">
                      {([['editor', 'fa-pen-to-square', 'Editor', 'Can add and edit their projects (each change needs your approval).'],
                        ['viewer', 'fa-eye', 'Viewer', 'Can only view the live map — the same one everyone sees.']] as const).map(([k, ic, lbl, desc]) => (
                        <button key={k} type="button" className={accessLevel(sel) === k ? 'on' : ''} aria-pressed={accessLevel(sel) === k}
                          disabled={busy || !isOwner} onClick={() => setAccess(sel, k)}>
                          <i className={`fas ${ic}`} />
                          <span><b>{lbl}{accessLevel(sel) === k ? ' (current)' : ''}</b><small>{desc}</small></span>
                        </button>
                      ))}
                    </div>
                    {!isOwner && <p className="crm-meta"><i className="fas fa-lock" /> Only the super admin can change access.</p>}
                  </div>
                )}

                <div className="acs-box">
                  <h4>Account type</h4>
                  <p className="crm-meta">Currently <b>{typeLabel(sel.role)}</b>. Move them to another type if they signed up as the wrong one — their existing details are kept.</p>
                  {isOwner ? (
                    <>
                      <div className="acs-inline">
                        <select className="crm-select" value={newRole} disabled={busy} onChange={(e) => setNewRole(e.target.value as Account['role'] | '')} aria-label="New account type">
                          <option value="">Choose new type…</option>
                          {(['buyer', 'developer', 'agent'] as const).filter((r) => r !== sel.role).map((r) => <option key={r} value={r}>{typeLabel(r)}</option>)}
                        </select>
                        <button className="adm-btn primary sm" disabled={busy || !newRole} onClick={() => changeRole(sel)}><i className="fas fa-arrow-right-arrow-left" /> Change type</button>
                      </div>
                      {newRole === 'developer' && (
                        <div className="acs-access" style={{ marginTop: 10 }}>
                          {([['editor', 'fa-pen-to-square', 'Editor', 'Can add and edit their projects (each change needs your approval).'],
                            ['viewer', 'fa-eye', 'Viewer', 'Can only view the live map.']] as const).map(([k, ic, lbl, desc]) => (
                            <button key={k} type="button" className={newAccess === k ? 'on' : ''} aria-pressed={newAccess === k} disabled={busy} onClick={() => setNewAccess(k)}>
                              <i className={`fas ${ic}`} />
                              <span><b>{lbl}</b><small>{desc}</small></span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : <p className="crm-meta"><i className="fas fa-lock" /> Only the super admin can change the account type.</p>}
                </div>

                {sel.role !== 'buyer' && statusOf(sel) !== 'pending' && isOwner && (
                  <div className="acs-box">
                    <h4>Verification</h4>
                    {rejecting ? (
                      <>
                        <textarea className="crm-notes" rows={3} autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason they will see" />
                        <div className="adm-actions" style={{ marginTop: 8 }}>
                          <button className="adm-btn danger sm" disabled={busy || !rejectReason.trim()} onClick={() => decide(sel, 'reject')}>Reject application</button>
                          <button className="adm-btn ghost sm" onClick={() => { setRejecting(false); setRejectReason(''); }}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <div className="adm-actions">
                        {statusOf(sel) !== 'approved' && <button className="adm-btn primary sm" disabled={busy} onClick={() => decide(sel, 'approve', sel.role === 'developer' ? accessLevel(sel) : undefined)}>Approve</button>}
                        {statusOf(sel) !== 'rejected' && <button className="adm-btn ghost sm" disabled={busy} onClick={() => setRejecting(true)}>Reject…</button>}
                        <button className="adm-btn ghost sm" disabled={busy} onClick={() => decide(sel, 'reset')}>Move back to pending</button>
                      </div>
                    )}
                  </div>
                )}

                <div className="acs-box">
                  <h4>Reset password</h4>
                  <p className="crm-meta">Passwords can&apos;t be viewed. Set a new one and share it with them securely.</p>
                  <div className="acs-inline">
                    <input className="crm-search" type="text" autoComplete="off" placeholder="New password (8+ characters)" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
                    <button className="adm-btn ghost sm" disabled={busy || newPass.length < 8} onClick={async () => { if (await patch(sel.id, { password: newPass })) { setNewPass(''); flash('Password reset — share it with the user securely'); } }}>Set password</button>
                  </div>
                </div>

                <div className="acs-box danger">
                  <h4>Delete account</h4>
                  <p className="crm-meta">They won&apos;t be able to sign in any more. This can&apos;t be undone.</p>
                  <button className="adm-btn danger sm" onClick={() => remove(sel)}><i className="fas fa-trash" /> Delete this account</button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Backups --------------------------------- */
interface PinSummary { id: string; number: number | null; title: string; developer: string; location: string; status: string; updated_at: string; }
interface Snapshot { id: string; created_at: string; reason: 'auto' | 'manual'; size: number; counts: Record<string, number>; }
interface DeletedPin extends PinSummary { history_id: string; deleted_at: string; blank: boolean; }
interface Compare { snapshot: Snapshot; missing: PinSummary[]; added: PinSummary[]; changed: number; }
interface HistorySummary { total: number; edits: number; deletes: number; first: string | null; last: string | null; }
interface TrashEntry { id: string; kind: string; label: string; sub?: string; deleted_at: string; deleted_by?: string; count: number; pin_ids: string[]; }
const TRASH_KINDS: Record<string, { label: string; icon: string }> = {
  account: { label: 'Account', icon: 'fa-user' }, employee: { label: 'Employee', icon: 'fa-user-tie' },
  lead: { label: 'Lead', icon: 'fa-address-book' }, blog: { label: 'Blog post', icon: 'fa-newspaper' },
  intake_project: { label: 'Intake project', icon: 'fa-file-arrow-up' }, dev_project: { label: 'Developer project', icon: 'fa-map-pin' },
  builder: { label: 'Builder', icon: 'fa-building' },
};

const DATA_LABELS: Record<string, { label: string; icon: string }> = {
  pins: { label: 'Project pins', icon: 'fa-map-pin' },
  infra_markers: { label: 'Infrastructure', icon: 'fa-train-subway' },
  roads: { label: 'Roads & lines', icon: 'fa-road' },
  area_boundaries: { label: 'Area boundaries', icon: 'fa-draw-polygon' },
  leads: { label: 'Map enquiries', icon: 'fa-envelope-open-text' },
  contact_leads: { label: 'Contact leads', icon: 'fa-address-book' },
  users: { label: 'Accounts', icon: 'fa-users' },
  posts: { label: 'Blog posts', icon: 'fa-newspaper' },
  pins_history: { label: 'Change history', icon: 'fa-clock-rotate-left' },
};
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (d: string) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const pinName = (p: PinSummary) => p.title || 'Untitled pin';

function BackupsPanel({ flash }: { flash: (m: string, e?: boolean) => void }) {
  const [live, setLive] = useState<Record<string, number>>({});
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [deleted, setDeleted] = useState<DeletedPin[]>([]);
  const [keep, setKeep] = useState(14);
  const [history, setHistory] = useState<HistorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [showBlank, setShowBlank] = useState(false);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [trashKind, setTrashKind] = useState('');
  const [trashQ, setTrashQ] = useState('');
  const binSel = useSelection();
  const pinSel = useSelection();

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/backups', { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setLive(b.data.live || {}); setSnaps(b.data.snapshots || []); setDeleted(b.data.deleted || []); setKeep(b.data.keep || 14); setHistory(b.data.history || null); setTrash(b.data.trash || []);
      if (b.data.autoError) flash(`Automatic backup failed: ${b.data.autoError}`, true);
    } catch { flash('Could not load backups', true); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/admin/backups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b?.error?.message || 'Failed');
    return b.data;
  }
  async function backupNow() {
    setBusy('snapshot');
    try { await post({ action: 'snapshot' }); flash('Backup created'); await load(); }
    catch (e) { flash(e instanceof Error ? e.message : 'Backup failed', true); } finally { setBusy(null); }
  }
  async function compare(s: Snapshot) {
    setBusy(`cmp-${s.id}`);
    try { setCmp(await post({ action: 'compare', id: s.id })); }
    catch (e) { flash(e instanceof Error ? e.message : 'Compare failed', true); } finally { setBusy(null); }
  }
  async function restoreFromSnapshot(p: PinSummary) {
    if (!cmp || !confirm(`Put "${pinName(p)}" back on the map?`)) return;
    setBusy(`pin-${p.id}`);
    try {
      const d = await post({ action: 'restore-pin', id: cmp.snapshot.id, pinId: p.id });
      flash(d.renumbered ? `Restored as pin #${d.restored.number} (its old number is now used by another pin)` : `Restored pin #${d.restored.number}`);
      setCmp({ ...cmp, missing: cmp.missing.filter((x) => x.id !== p.id) });
      load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Restore failed', true); } finally { setBusy(null); }
  }
  async function restoreDeleted(p: DeletedPin) {
    if (!confirm(`Put "${pinName(p)}" back on the map?`)) return;
    setBusy(`del-${p.history_id}`);
    try { await post({ action: 'restore-deleted', historyId: p.history_id }); flash(`Restored "${pinName(p)}"`); load(); }
    catch (e) { flash(e instanceof Error ? e.message : 'Restore failed', true); } finally { setBusy(null); }
  }

  // ---- Recycle bin
  async function binRestore(ids: string[]) {
    if (!ids.length) return;
    setBusy('bin');
    try {
      const d = await post({ action: 'trash-restore', ids });
      binSel.clear();
      if (d.failed?.length) { flash(`${d.restored.length} restored, ${d.failed.length} not`, true); alert(`Could not restore:\n\n${d.failed.join('\n')}`); }
      else flash(`Restored ${d.restored.length === 1 ? `“${d.restored[0]}”` : `${d.restored.length} items`}`);
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Restore failed', true); } finally { setBusy(null); }
  }
  async function binPurge(ids: string[]) {
    if (!ids.length || !confirm(`Delete ${ids.length} item${ids.length === 1 ? '' : 's'} forever? This cannot be undone.`)) return;
    setBusy('bin');
    try { await post({ action: 'trash-purge', ids }); binSel.clear(); flash(`${ids.length} item${ids.length === 1 ? '' : 's'} deleted forever`); await load(); }
    catch (e) { flash(e instanceof Error ? e.message : 'Delete failed', true); } finally { setBusy(null); }
  }
  // ---- Deleted pins (from the change history)
  async function restorePins(list: DeletedPin[]) {
    if (!list.length || !confirm(`Put ${list.length} project${list.length === 1 ? '' : 's'} back on the map?`)) return;
    setBusy('pins');
    let ok = 0;
    for (const p of list) { try { await post({ action: 'restore-deleted', historyId: p.history_id }); ok++; } catch { /* counted below */ } }
    pinSel.clear(); setBusy(null);
    flash(`${ok} project${ok === 1 ? '' : 's'} restored${ok < list.length ? `, ${list.length - ok} failed` : ''}`, ok < list.length);
    load();
  }
  async function purgePins(list: DeletedPin[]) {
    if (!list.length || !confirm(`Delete ${list.length} project${list.length === 1 ? '' : 's'} forever? ${list.length === 1 ? 'Its' : 'Their'} saved history is removed and ${list.length === 1 ? 'it' : 'they'} can no longer be restored.`)) return;
    setBusy('pins');
    try { await post({ action: 'purge-deleted', pinIds: list.map((p) => p.id) }); pinSel.clear(); flash(`${list.length} deleted forever`); await load(); }
    catch (e) { flash(e instanceof Error ? e.message : 'Delete failed', true); } finally { setBusy(null); }
  }

  if (loading && !snaps.length) return <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Checking backups…</p></div>;

  const latest = snaps[0];
  // Pins kept in the recycle bin are restored from there (with their project), not listed twice.
  const inBin = new Set(trash.flatMap((t) => t.pin_ids || []));
  const realDeleted = deleted.filter((d) => !d.blank && !inBin.has(d.id));
  const blankDeleted = deleted.filter((d) => d.blank && !inBin.has(d.id));
  const tq = trashQ.trim().toLowerCase();
  const binList = trash.filter((t) => (!trashKind || t.kind === trashKind) && (!tq || [t.label, t.sub, t.deleted_by].some((x) => (x || '').toLowerCase().includes(tq))));
  const binIds = binList.map((t) => t.id);
  const kindCounts = trash.reduce<Record<string, number>>((m, t) => ({ ...m, [t.kind]: (m[t.kind] || 0) + 1 }), {});
  const deletedList = showBlank ? [...realDeleted, ...blankDeleted] : realDeleted;
  const pinIds = deletedList.map((p) => p.history_id);
  const pickedPins = deletedList.filter((p) => pinSel.has(p.history_id));
  const dataKeys = Object.keys(live).sort((a, b) => (DATA_LABELS[a] ? 0 : 1) - (DATA_LABELS[b] ? 0 : 1) || a.localeCompare(b));

  return (
    <>
      <div className="adm-panel bk-hero">
        <div className="bk-hero-icon"><i className="fas fa-shield-halved" /></div>
        <div className="bk-hero-text">
          <h3>{latest ? `Last backup ${leadWhen(latest.created_at)}` : 'No backups yet'}</h3>
          <p className="muted">Everything is backed up automatically once a day, and the last {keep} backups are kept. Passwords are never included.</p>
        </div>
        <div className="adm-actions">
          <button className="adm-btn primary" disabled={!!busy} onClick={backupNow}>
            <i className={`fas ${busy === 'snapshot' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`} /> Back up now
          </button>
          <a className="adm-btn ghost" href="/api/admin/backups?download=current"><i className="fas fa-download" /> Download everything</a>
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>What&apos;s stored right now</h3></div>
        <div className="bk-data">
          {dataKeys.map((k) => (
            <div className="bk-data-item" key={k}>
              <i className={`fas ${DATA_LABELS[k]?.icon || 'fa-table'}`} />
              <b>{live[k]}</b><span>{DATA_LABELS[k]?.label || k.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="adm-panel" id="recycle-bin">
        <div className="adm-panel-head">
          <h3><i className="fas fa-trash-can-arrow-up" style={{ color: 'var(--forest)', marginRight: 8 }} />Recycle bin {trash.length ? `(${trash.length})` : ''}</h3>
          <button className="adm-btn ghost sm" onClick={load}><i className="fas fa-rotate" /> Refresh</button>
        </div>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 }}>
          Accounts, employees, leads, blog posts and projects deleted from any panel land here first. Restore puts them back exactly as they were; Delete forever removes them for good.
        </p>
        {trash.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-circle-check" /><p>The recycle bin is empty.</p></div>
        ) : (
          <>
            <div className="acs-toolbar" style={{ padding: 0, marginBottom: 12 }}>
              <label className="acs-search">
                <i className="fas fa-magnifying-glass" />
                <input placeholder="Search deleted items" value={trashQ} onChange={(e) => setTrashQ(e.target.value)} aria-label="Search recycle bin" />
              </label>
              <select className="crm-select" value={trashKind} onChange={(e) => setTrashKind(e.target.value)} aria-label="Filter by type">
                <option value="">All types ({trash.length})</option>
                {Object.entries(kindCounts).map(([k, n]) => <option key={k} value={k}>{TRASH_KINDS[k]?.label || k} ({n})</option>)}
              </select>
            </div>
            <BulkBar sel={binSel} ids={binIds} hint={`Select all ${binList.length} shown — or tick items to restore or delete them forever`}>
              <button className="adm-btn primary sm" disabled={!!busy} onClick={() => binRestore(binSel.of(binIds))}><i className="fas fa-rotate-left" /> Restore</button>
              <button className="adm-btn danger sm" disabled={!!busy} onClick={() => binPurge(binSel.of(binIds))}><i className="fas fa-trash" /> Delete forever</button>
            </BulkBar>
            {binList.length === 0 ? (
              <div className="adm-empty"><i className="fas fa-filter" /><p>Nothing matches.</p></div>
            ) : (
              <table className="adm-table">
                <thead><tr><th className="pick" /><th>Item</th><th>Type</th><th>Deleted</th><th /></tr></thead>
                <tbody>
                  {binList.map((t) => (
                    <tr key={t.id} className={binSel.has(t.id) ? 'picked' : undefined}>
                      <td className="pick"><PickOne sel={binSel} id={t.id} label={t.label} /></td>
                      <td className="t-title">{t.label}<small>{t.sub || ''}</small></td>
                      <td><span className="adm-badge muted"><i className={`fas ${TRASH_KINDS[t.kind]?.icon || 'fa-box'}`} /> {TRASH_KINDS[t.kind]?.label || t.kind}</span></td>
                      <td className="muted" title={fmtDate(t.deleted_at)}>{leadWhen(t.deleted_at)}{t.deleted_by ? <small style={{ display: 'block' }}>by {t.deleted_by}</small> : null}</td>
                      <td><div className="adm-actions">
                        <button className="adm-btn ghost sm" disabled={!!busy} onClick={() => binRestore([t.id])}><i className="fas fa-rotate-left" /> Restore</button>
                        <button className="adm-btn danger sm" disabled={!!busy} onClick={() => binPurge([t.id])} title="Delete forever"><i className="fas fa-trash" /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3><i className="fas fa-clock-rotate-left" style={{ color: 'var(--forest)', marginRight: 8 }} />Change history</h3>
          <a className="adm-btn ghost sm" href="/api/admin/backups?download=history"><i className="fas fa-download" /> Download history</a>
        </div>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 }}>
          Every time a project pin is edited or deleted, a full copy of it is kept here — the same history as the Map Editor&apos;s
          “History” panel. It&apos;s included in every backup above, so it can always be recovered.
        </p>
        <div className="bk-data">
          <div className="bk-data-item"><i className="fas fa-list-check" /><b>{history?.total ?? 0}</b><span>Changes recorded</span></div>
          <div className="bk-data-item"><i className="fas fa-pen" /><b>{history?.edits ?? 0}</b><span>Edits</span></div>
          <div className="bk-data-item"><i className="fas fa-trash-can" /><b>{history?.deletes ?? 0}</b><span>Deletions</span></div>
          <div className="bk-data-item"><i className="fas fa-calendar" /><b style={{ fontSize: 14 }}>{history?.first ? `${fmtDate(history.first).split(',')[0]} – ${fmtDate(history.last || '').split(',')[0]}` : '—'}</b><span>Period covered</span></div>
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>Deleted projects {realDeleted.length ? `(${realDeleted.length})` : ''}</h3>
          {blankDeleted.length > 0 && (
            <button className="adm-btn ghost sm" onClick={() => setShowBlank((v) => !v)}>
              {showBlank ? 'Hide' : 'Show'} {blankDeleted.length} empty pin{blankDeleted.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
        {deletedList.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-circle-check" /><p>No deleted projects are missing from the map.</p></div>
        ) : (
          <>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>Map pins deleted in the Map Editor. Restore puts them back on the map; Delete forever removes their saved history.</p>
          <BulkBar sel={pinSel} ids={pinIds} hint={`Select all ${deletedList.length} shown — or tick projects to restore or delete them forever`}>
            <button className="adm-btn primary sm" disabled={!!busy} onClick={() => restorePins(pickedPins)}><i className="fas fa-rotate-left" /> Restore</button>
            <button className="adm-btn danger sm" disabled={!!busy} onClick={() => purgePins(pickedPins)}><i className="fas fa-trash" /> Delete forever</button>
          </BulkBar>
          <table className="adm-table">
            <thead><tr><th className="pick" /><th>Project</th><th>Deleted</th><th /></tr></thead>
            <tbody>
              {deletedList.map((p) => (
                <tr key={p.history_id} className={pinSel.has(p.history_id) ? 'picked' : undefined}>
                  <td className="pick"><PickOne sel={pinSel} id={p.history_id} label={pinName(p)} /></td>
                  <td className="t-title"><b>{p.number != null ? `#${p.number} ` : ''}{pinName(p)}</b><small className="muted"> {[p.developer, p.location].filter(Boolean).join(' · ')}</small></td>
                  <td className="muted">{fmtDate(p.deleted_at)}</td>
                  <td><div className="adm-actions">
                    <button className="adm-btn ghost sm" disabled={!!busy} onClick={() => restoreDeleted(p)}><i className="fas fa-rotate-left" /> Restore</button>
                    <button className="adm-btn danger sm" disabled={!!busy} onClick={() => purgePins([p])} title="Delete forever"><i className="fas fa-trash" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>Backups ({snaps.length})</h3><button className="adm-btn ghost sm" onClick={load}><i className="fas fa-rotate" /> Refresh</button></div>
        {snaps.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-box-archive" /><p>No backups yet — press “Back up now”.</p></div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Taken</th><th>Type</th><th>Pins</th><th>Size</th><th /></tr></thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.id} className={cmp?.snapshot.id === s.id ? 'bk-active' : ''}>
                  <td><b>{fmtDate(s.created_at)}</b><small className="muted"> · {leadWhen(s.created_at)}</small></td>
                  <td><span className={`crm-pill ${s.reason === 'auto' ? 'contacted' : 'won'}`}>{s.reason === 'auto' ? 'Automatic' : 'Manual'}</span></td>
                  <td>{s.counts.pins ?? '—'}</td>
                  <td className="muted">{fmtSize(s.size)}</td>
                  <td className="bk-row-actions">
                    <button className="adm-btn ghost sm" disabled={!!busy} onClick={() => compare(s)}>
                      <i className={`fas ${busy === `cmp-${s.id}` ? 'fa-spinner fa-spin' : 'fa-code-compare'}`} /> Compare with now
                    </button>
                    <a className="adm-btn ghost sm" href={`/api/admin/backups?download=${s.id}`}><i className="fas fa-download" /></a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {cmp && (
        <div className="adm-panel">
          <div className="adm-panel-head">
            <h3>Since the backup of {fmtDate(cmp.snapshot.created_at)}</h3>
            <button className="adm-btn ghost sm" onClick={() => setCmp(null)}><i className="fas fa-xmark" /></button>
          </div>
          <div className="bk-cmp-sum">
            <span className="crm-pill lost">{cmp.missing.length} missing now</span>
            <span className="crm-pill won">{cmp.added.length} added</span>
            <span className="crm-pill contacted">{cmp.changed} edited</span>
          </div>
          {cmp.missing.length > 0 ? (
            <table className="adm-table">
              <thead><tr><th>Missing project</th><th>Status then</th><th /></tr></thead>
              <tbody>
                {cmp.missing.map((p) => (
                  <tr key={p.id}>
                    <td className="t-title"><b>{p.number != null ? `#${p.number} ` : ''}{pinName(p)}</b><small className="muted"> {[p.developer, p.location].filter(Boolean).join(' · ')}</small></td>
                    <td className="muted">{p.status || '—'}</td>
                    <td><button className="adm-btn primary sm" disabled={!!busy} onClick={() => restoreFromSnapshot(p)}><i className="fas fa-rotate-left" /> Restore</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="adm-empty"><i className="fas fa-circle-check" /><p>Every project in this backup is still on the map.</p></div>}
          {cmp.added.length > 0 && (
            <p className="muted bk-added">Added since: {cmp.added.map((p) => `${p.number != null ? `#${p.number} ` : ''}${pinName(p)}`).join(', ')}</p>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------- Shell ----------------------------------- */
/* ------------------------- Settings: extra sections ------------------------ */
/** What the admin is told about, and this device's app preference. */
function NotificationsSettings({ bell, locked, onToggleLock, onGo }: { bell: boolean; locked: boolean; onToggleLock: () => void; onGo: (t: string) => void }) {
  const rows: [string, string, string, string][] = [
    ['fa-user-plus', 'New developer & channel-partner sign-ups', 'They wait for your approval in Accounts.', 'accounts'],
    ['fa-map-pin', 'Projects added or edited by developers', 'They go live only after you approve them in Project Management.', 'projects'],
    ['fa-trash-can', 'Delete requests and deleted projects', 'Developers asking to remove a project, and projects they removed.', 'projects'],
    ['fa-calendar-check', 'Lead follow-ups due', 'Not in the bell — shown in CRM & Leads → Follow-up due, overdue ones in red.', 'leads'],
  ];
  return (
    <>
      <section className="pg-card st-sec">
        <div className="st-sec-head"><div><h3>Notifications</h3><p>What you are alerted to, and where to act on it.</p></div></div>
        {!bell && <p className="adm-note"><i className="fas fa-circle-info" /><span>The bell appears for team members who can open Accounts or Project Management.</span></p>}
        <ul className="st-list">
          {rows.map(([icon, title, desc, tab]) => (
            <li key={title}>
              <span className="ic"><i className={`fas ${icon}`} /></span>
              <span className="t"><b>{title}</b><small>{desc}</small></span>
              <button type="button" className="adm-btn ghost sm" onClick={() => onGo(tab)}>Open</button>
            </li>
          ))}
        </ul>
        <p className="st-hint"><i className="fas fa-circle-info" /> Opening the bell marks everything in it as read for you; other team members keep their own unread count.</p>
      </section>
      <section className="pg-card st-sec">
        <div className="st-sec-head"><div><h3>This Device</h3><p>Preferences saved in this browser only.</p></div></div>
        <ul className="st-list">
          <li>
            <span className="ic"><i className={`fas ${locked ? 'fa-lock' : 'fa-lock-open'}`} /></span>
            <span className="t"><b>Open the installed app straight to the super admin</b><small>{locked ? 'On — the app opens on this panel.' : 'Off — the app opens on the home page.'}</small></span>
            <button type="button" role="switch" aria-checked={locked} className={`st-switch${locked ? ' on' : ''}`} onClick={onToggleLock} aria-label="Lock the app to this panel"><span /></button>
          </li>
        </ul>
      </section>
    </>
  );
}

/** Everything the team did on leads (notes, status changes, follow-ups, transfers). */
function ActivityLogSettings({ onOpenLeads }: { onOpenLeads: () => void }) {
  const [feed, setFeed] = useState<LeadEvent[] | null>(null);
  const [who, setWho] = useState('');
  async function load() {
    setFeed(null);
    try {
      const r = await fetch('/api/admin/leads?activity=1', { credentials: 'same-origin' });
      const b = await r.json();
      setFeed(r.ok && Array.isArray(b.data) ? b.data : []);
    } catch { setFeed([]); }
  }
  useEffect(() => { load(); }, []);
  const shown = (feed || []).filter((e) => !who || e.by_id === who);
  const ini = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <section className="pg-card st-sec">
      <div className="st-sec-head">
        <div><h3>Activity Log</h3><p>Notes, status changes, follow-ups and transfers on leads, newest first.</p></div>
        <div className="pg-tools">
          <select className="ov-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person">
            <option value="">Everyone</option>
            {Array.from(new Map((feed || []).map((e) => [e.by_id || '', e.by_name || 'Someone'])).entries()).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <button type="button" className="adm-btn ghost sm" onClick={load}><i className="fas fa-rotate" /> Refresh</button>
        </div>
      </div>
      {feed === null ? <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
        : !shown.length ? <div className="adm-empty"><i className="fas fa-clock-rotate-left" /><p>Nothing yet. When anyone adds a note, changes a status or sets a follow-up on a lead, it shows here.</p></div>
          : (
            <ul className="tm-feed">
              {shown.map((e) => (
                <li key={`${e.lead_id}-${e.id}`}>
                  <span className="tm-av sm" style={{ background: '#0f5c47' }}>{ini(e.by_name || '?')}</span>
                  <div>
                    <b>{e.by_name || 'Someone'}</b> <span className="muted">on</span> <b>{e.lead_name || 'a lead'}</b>
                    <span className="tm-ev"><i className={`fas ${LEAD_EVENT_ICON[e.type]}`} /> {leadEventText(e)}</span>
                  </div>
                  <time title={fullDate(e.at)}>{leadWhen(e.at)}</time>
                </li>
              ))}
            </ul>
          )}
      <p className="st-hint"><i className="fas fa-circle-info" /> Open a lead from <button type="button" className="link-btn" onClick={onOpenLeads}>CRM &amp; Leads</button> to see its full timeline.</p>
    </section>
  );
}

export default function AdminApp({ user }: { user: AdminUser }) {
  const router = useRouter();
  const isOwner = user.role === 'admin';
  const { flash, node: toastNode } = useToast();

  const visible = isOwner
    ? ['dashboard', 'map', 'developers', 'projects', 'intake', 'leads', 'buyerleads', 'whatsapp', 'accounts', 'blogs', 'employees', 'backups', 'devapi', 'seo', 'settings', 'profile']
    // Employees get no site-wide Dashboard overview — they open straight on their
    // leads (only the ones transferred to them), plus any other tab the super admin granted.
    : [...GRANTABLE.map((g) => g.key).filter((k) => user.permissions.includes(k)).sort((a, b) => Number(b === 'leads') - Number(a === 'leads')).flatMap((k) => (k === 'intake' ? ['projects', 'intake'] : k === 'map' ? ['map', 'developers'] : [k])), 'profile'];

  const navGroups = NAV.map((g) => ({ ...g, tabs: g.tabs.filter((k) => visible.includes(k)) })).filter((g) => g.tabs.length);
  const [tab, setTab] = useState(visible[0] || 'dashboard');
  // The open tab lives in the URL (/dashboard/s-admin?tab=projects), so a refresh
  // reopens it and the link can be shared. Read once on load, written on every change.
  const tabFromUrl = useRef(false);
  // The ?tab= the page was opened with, read once: in development React runs
  // effects twice, and by the second run the URL already says the default tab.
  const openedTab = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    try {
      if (openedTab.current === undefined) openedTab.current = new URLSearchParams(window.location.search).get('tab');
      const t = openedTab.current;
      if (t && visible.includes(t)) setTab(t);
    } catch { /* ignore */ }
    tabFromUrl.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tabFromUrl.current) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') === tab) return;
      url.searchParams.set('tab', tab);
      window.history.replaceState(window.history.state, '', url);
    } catch { /* ignore */ }
  }, [tab]);
  // Developer projects waiting for approval (badge on the tab) and what to focus when opened.
  const [projPending, setProjPending] = useState(0);
  const [projFocus, setProjFocus] = useState<{ ownerId?: string; projectId?: string } | null>(null);
  const [accountFocus, setAccountFocus] = useState<string | null>(null);
  const [leadFocus, setLeadFocus] = useState<string | null>(null);
  const openProjects = (f?: { ownerId?: string; projectId?: string }) => { setProjFocus(f || null); setTab('projects'); };
  const openAccount = (id: string) => { setAccountFocus(id); setTab('accounts'); };
  // The Map Editor and Projects Intake are whole apps in iframes. Once opened
  // (or hovered, to start loading early) they stay mounted in the background,
  // so switching back to them is instant instead of a full reload each time.
  const KEEP_ALIVE = ['map', 'intake'];
  const [warm, setWarm] = useState<string[]>(() => (KEEP_ALIVE.includes(visible[0]) ? [visible[0]] : []));
  const warmUp = (k: string) => {
    if (KEEP_ALIVE.includes(k) && visible.includes(k)) setWarm((w) => (w.includes(k) ? w : [...w, k]));
  };
  useEffect(() => { warmUp(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Edit all details" on any project (Developers, Developer projects, or the Map
  // Editor iframe via postMessage): open its full Projects Intake form — the one
  // form with every field. Staff without the intake tab get it in a new browser tab.
  const [intakeHash, setIntakeHash] = useState('');
  const openFullEdit = async (pinId: string) => {
    try {
      const { submission_id, created } = await submissionForPin(pinId);
      const hash = `#/review/${encodeURIComponent(submission_id)}?from=pin&t=${Date.now()}`;
      if (visible.includes('intake')) {
        setIntakeHash(hash);
        setWarm((w) => (w.includes('intake') ? w : [...w, 'intake']));
        setTab('intake');
      } else {
        window.open(`/intake${hash}`, '_blank', 'noopener');
      }
      flash(created ? 'Full form created from this pin — Publish it to update the map' : 'Opened the full project form');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not open the full form', true);
    }
  };
  const openFullEditRef = useRef(openFullEdit);
  openFullEditRef.current = openFullEdit;
  useEffect(() => {
    const onEvent = (e: Event) => {
      const id = (e as CustomEvent<{ pinId?: string }>).detail?.pinId;
      if (id) openFullEditRef.current(String(id));
    };
    // The Map Editor runs in a same-origin iframe and posts { type, pinId }.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; pinId?: string } | null;
      if (d && d.type === FULL_EDIT_EVENT && d.pinId) openFullEditRef.current(String(d.pinId));
    };
    window.addEventListener(FULL_EDIT_EVENT, onEvent);
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener(FULL_EDIT_EVENT, onEvent); window.removeEventListener('message', onMessage); };
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  // Developer/partner accounts waiting for verification — shown as a badge on the Accounts tab.
  const [pendingCount, setPendingCount] = useState(0);
  // Site numbers for the Overview (and the pending badge) — one request per page load.
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    if (!visible.includes('accounts') && !visible.includes('dashboard')) return;
    fetch('/api/admin/stats', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => { setStats(b?.data || { dbOk: false }); setPendingCount(Number(b?.data?.accounts?.pending) || 0); })
      .catch(() => setStats({ dbOk: false }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // City picker in the top bar: moves the Overview map and filters its charts.
  const cities: CityStat[] = stats?.overview?.cities || [];
  // '__default' = not picked in this tab yet → the Default Location from Settings → General.
  const [cityPick, setCity] = usePersistedState<string>('city', '__default');
  const wanted = cityPick === '__default' ? (stats?.defaultCity ?? 'pune') : cityPick;
  const city = cities.some((c) => c.key === wanted) ? wanted : '';
  // Settings page: which section is open (General, SEO, Notifications, Activity log share the 'settings' tab).
  const [stSec, setStSec] = usePersistedState<string>('settings.sec', 'general');
  const [today, setToday] = useState('');
  useEffect(() => { setToday(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })); }, []);

  // Top-bar search: sections, projects, developers and localities.
  const [q, setQ] = useState('');
  const [searchFocus, setSearchFocus] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); // phones: the field opens over the bar
  const [projIndex, setProjIndex] = useState<ProjectHit[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) { setSearchFocus(false); setSearchOpen(false); } };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  const closeSearch = () => { setQ(''); setSearchFocus(false); setSearchOpen(false); searchInput.current?.blur(); };
  const searchHits = (() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const go = (k: string) => () => { closeSearch(); setTab(k); };
    const has = (v?: string) => !!v && v.toLowerCase().includes(t);
    const sections = visible.filter((k) => has(`${TAB_META[k].label} ${TAB_META[k].desc}`)).slice(0, 4)
      .map((k) => ({ icon: TAB_META[k].icon, title: TAB_META[k].label, sub: TAB_META[k].desc, go: go(k) }));
    const projects = matchProjects(projIndex, q, 5).map((p) => ({
      icon: 'fa-location-dot', title: p.title, sub: `${[p.locality, p.developer].filter(Boolean).join(' · ') || 'Project'} — edit all details`,
      go: () => { closeSearch(); openFullEdit(p.id); },
    }));
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => has(x)))];
    const devs = visible.includes('developers')
      ? uniq(projIndex.map((p) => p.developer)).slice(0, 3).map((d) => ({ icon: 'fa-building', title: d, sub: `${projIndex.filter((p) => p.developer === d).length} projects — open Developers`, go: go('developers') }))
      : [];
    const places = visible.includes('map')
      ? uniq(projIndex.map((p) => p.locality)).slice(0, 3).map((l) => ({ icon: 'fa-map-pin', title: l, sub: `${projIndex.filter((p) => p.locality === l).length} projects — open Map Editor`, go: go('map') }))
      : [];
    return [...sections, ...projects, ...devs, ...places];
  })();

  // Navigation dropdowns. Fixed-position so the scrollable tab row never clips them.
  const [navOpen, setNavOpen] = useState<string | null>(null);
  const [navPos, setNavPos] = useState({ left: 0, top: 0 });
  const navRef = useRef<HTMLElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!navOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ddRef.current?.contains(t) || navRef.current?.contains(t)) return;
      setNavOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(null); };
    const close = () => setNavOpen(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    navRef.current?.addEventListener('scroll', close);
    const nav = navRef.current;
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      nav?.removeEventListener('scroll', close);
    };
  }, [navOpen]);
  // When the section row is wider than the screen it scrolls sideways: fade the edge
  // only while more tabs are hidden, and let a mouse wheel scroll it too.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const edge = () => nav.classList.toggle('at-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
    const wheel = (e: WheelEvent) => {
      if (nav.scrollWidth <= nav.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      nav.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    edge();
    nav.addEventListener('scroll', edge, { passive: true });
    nav.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('resize', edge);
    return () => { nav.removeEventListener('scroll', edge); nav.removeEventListener('wheel', wheel); window.removeEventListener('resize', edge); };
  }, []);
  // Keep the current section's tab in view on narrow screens.
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('.adm2-tab.active');
    if (!nav || !el || nav.scrollWidth <= nav.clientWidth) return;
    const left = el.offsetLeft, right = left + el.offsetWidth; // the sticky nav is the offsetParent
    if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth - 28) nav.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' });
  }, [tab]);
  /** Items waiting on the admin in one section (accounts to verify, projects to approve). */
  const badgeOf = (k: string) => (k === 'accounts' ? pendingCount : k === 'projects' ? projPending : 0);
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [displayName, setDisplayName] = useState(user.name || '');
  const initials = (displayName || user.email || '?').slice(0, 2).toUpperCase();
  const menuRef = useRef<HTMLDivElement>(null);
  // Close the account menu on an outside click/tap or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  // "Lock to this panel": remember on THIS device that the installed app should
  // open straight to /dashboard/s-admin (handled by <LockRedirect/> in the root
  // layout). Older devices may still have the pre-move '/s-admin' value stored —
  // that path now redirects to /dashboard/s-admin, so it keeps working.
  const LOCK_PANEL = '/dashboard/s-admin';
  // Screen size of the admin on laptops/desktops (CSS zoom, see admin.css "Density").
  // Remembered per device. Capped so the zoomed page never gets narrower than the
  // ~1100 px desktop layout, which would squash the columns.
  const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.2, 1.3] as const;
  const [uiZoom, setUiZoom] = useState(1);
  const [zoomMax, setZoomMax] = useState(1.3);
  useEffect(() => {
    const fit = () => setZoomMax(Math.max(1, window.innerWidth / 1180));
    fit();
    try {
      const v = Number(localStorage.getItem('mg_admin_zoom'));
      if ((ZOOM_STEPS as readonly number[]).includes(v)) setUiZoom(v);
    } catch { /* storage unavailable */ }
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomNow = Math.min(uiZoom, ZOOM_STEPS.filter((z) => z <= zoomMax).pop() ?? 1);
  const zoomBy = (dir: -1 | 0 | 1) => {
    const allowed = ZOOM_STEPS.filter((z) => z <= zoomMax);
    const i = allowed.indexOf(zoomNow as (typeof ZOOM_STEPS)[number]);
    const next = dir === 0 ? 1 : allowed[Math.max(0, Math.min(allowed.length - 1, i + dir))];
    setUiZoom(next);
    try { localStorage.setItem('mg_admin_zoom', String(next)); } catch { /* storage unavailable */ }
  };

  const [locked, setLocked] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem('mg_lock_panel');
      setLocked(v === LOCK_PANEL || v === '/s-admin');
    } catch {}
  }, []);
  function toggleLock() {
    try {
      if (localStorage.getItem('mg_lock_panel')) {
        localStorage.removeItem('mg_lock_panel');
        setLocked(false);
        flash('Unlocked — the app opens normally now.');
      } else {
        localStorage.setItem('mg_lock_panel', LOCK_PANEL);
        setLocked(true);
        flash('Locked — the installed app will open straight to the super-admin.');
      }
    } catch {
      flash('Could not change the lock on this device.', true);
    }
  }

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    router.push('/'); router.refresh();
  }

  return (
    <div className="adm2" style={{ ['--z' as string]: zoomNow }}>
      <header className="adm2-top">
        {/* Same logo as the main site header — the only logo on this screen. */}
        <a className="adm2-brand" href="/" target="_blank" rel="noopener" aria-label="Mappingg.com home">
          <span className="mark" aria-hidden="true" />
          <span><b>Mappingg<em>.com</em></b><small>{isOwner ? 'Super admin' : 'Team panel'}</small></span>
        </a>

        <div className={`adm2-search${searchOpen ? ' open' : ''}`} ref={searchRef}>
          <i className="fas fa-magnifying-glass" />
          <input
            ref={searchInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => { setSearchFocus(true); loadProjectIndex().then(setProjIndex); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQ(''); setSearchOpen(false); (e.target as HTMLInputElement).blur(); }
              if (e.key === 'Enter') searchHits[0]?.go();
            }}
            placeholder="Search projects, developers, locations, sections…"
            aria-label="Search"
          />
          {searchOpen && <button type="button" className="adm2-search-x" onClick={() => { setQ(''); setSearchOpen(false); }} aria-label="Close search"><i className="fas fa-xmark" /></button>}
          {searchFocus && q.trim() && (
            <div className="adm2-search-pop">
              {searchHits.length ? searchHits.map((h, i) => (
                <button type="button" key={i} onMouseDown={(e) => e.preventDefault()} onClick={h.go}>
                  <span className="ic"><i className={`fas ${h.icon}`} /></span>
                  <span><b>{h.title}</b><small>{h.sub}</small></span>
                </button>
              )) : <p className="muted">No matches for “{q.trim()}”.</p>}
            </div>
          )}
        </div>

        <div className="adm2-top-right" ref={menuRef}>
          <button type="button" className="adm2-pill adm2-search-btn" onClick={() => { setSearchOpen(true); setTimeout(() => searchInput.current?.focus(), 30); }} aria-label="Search">
            <i className="fas fa-magnifying-glass" />
          </button>
          {cities.length > 0 && (
            <label className="adm2-pill adm2-city">
              <i className="fas fa-location-dot" />
              <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
                <option value="">All cities</option>
                {cities.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <i className="fas fa-chevron-down caret" />
            </label>
          )}
          <span className="adm2-pill adm2-date"><i className="far fa-calendar" /> {today}</span>
          <div className="adm2-pill adm2-zoom" role="group" aria-label="Screen size">
            <button type="button" onClick={() => zoomBy(-1)} disabled={zoomNow <= ZOOM_STEPS[0]} aria-label="Zoom out" title="Smaller"><i className="fas fa-minus" /></button>
            <button type="button" className="pct" onClick={() => zoomBy(0)} title="Reset to 100%">{Math.round(zoomNow * 100)}%</button>
            <button type="button" onClick={() => zoomBy(1)} disabled={zoomNow >= Math.min(zoomMax, ZOOM_STEPS[ZOOM_STEPS.length - 1])} aria-label="Zoom in" title="Bigger"><i className="fas fa-plus" /></button>
          </div>
          {(visible.includes('projects') || visible.includes('accounts')) && (
            <NotificationBell
              flash={(m) => flash(m)}
              onPending={setProjPending}
              onOpenProjects={(f) => (visible.includes('projects') ? openProjects(f) : undefined)}
              onOpenAccount={(id) => (visible.includes('accounts') ? openAccount(id) : undefined)}
            />
          )}
          <a className="adm2-pill adm2-viewsite" href="/map" target="_blank" rel="noopener" title="Open the live map"><i className="fas fa-arrow-up-right-from-square" /> <span className="adm-hide-sm">View site</span></a>
          <button className="adm2-user" onClick={() => setMenuOpen((v) => !v)}>
            <span className="who">
              {avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatar} alt="" />
                : initials}
            </span>
            <span className="who-meta"><b>{displayName || user.email.split('@')[0]}</b><small>{isOwner ? 'Super Admin' : 'Employee'}</small></span>
            <i className="fas fa-chevron-down" />
          </button>
          {menuOpen && (
            <div className="adm2-menu">
              <button className={tab === 'profile' ? 'on' : ''} onClick={() => { setTab('profile'); setMenuOpen(false); }}><i className="fas fa-user" /> Profile</button>
              {visible.includes('backups') && (
                <button className={tab === 'backups' ? 'on' : ''} onClick={() => { setTab('backups'); setMenuOpen(false); }}><i className="fas fa-database" /> Backups</button>
              )}
              {visible.includes('settings') && (
                <button className={tab === 'settings' ? 'on' : ''} onClick={() => { setTab('settings'); setMenuOpen(false); }}><i className="fas fa-gear" /> Settings</button>
              )}
              <div className="adm2-menu-sep" />
              <button onClick={() => { toggleLock(); setMenuOpen(false); }}>
                <i className={`fas ${locked ? 'fa-lock-open' : 'fa-lock'}`} /> {locked ? 'Unlock app' : 'Lock to this panel'}
              </button>
              <button onClick={logout}><i className="fas fa-right-from-bracket" /> Sign out</button>
            </div>
          )}
        </div>
      </header>

      <nav className="adm2-tabs" ref={navRef}>
        {navGroups.map((g) => {
          const active = g.tabs.includes(tab);
          // A group shows the total of its sections' badges (e.g. Accounts
          // waiting for verification appear on Leads).
          const waiting = g.tabs.reduce((n, m) => n + badgeOf(m), 0);
          const single = g.tabs.length === 1;
          return (
            <button
              key={g.key}
              className={`adm2-tab${active ? ' active' : ''}${navOpen === g.key ? ' open' : ''}`}
              aria-haspopup={single ? undefined : 'menu'}
              aria-expanded={single ? undefined : navOpen === g.key}
              onClick={(e) => {
                if (single) { setTab(g.tabs[0]); setNavOpen(null); return; }
                const el = e.currentTarget as HTMLElement;
                const r = el.getBoundingClientRect();
                const z = cssZoom(el);
                setNavPos({ left: Math.max(8, Math.min(r.left / z, window.innerWidth / z - 268)), top: r.bottom / z + 6 });
                setNavOpen((o) => (o === g.key ? null : g.key));
              }}
              onPointerEnter={() => g.tabs.forEach(warmUp)}
              onFocus={() => g.tabs.forEach(warmUp)}
            >
              <i className={`fas ${g.icon}`} /> {g.label}
              {waiting > 0 && <span className="tab-badge" title={`${waiting} waiting for review`}>{waiting}</span>}
              {!single && <i className="fas fa-chevron-down caret" />}
            </button>
          );
        })}
      </nav>

      {navOpen && (() => {
        const g = navGroups.find((x) => x.key === navOpen);
        if (!g) return null;
        return (
          <div className="adm2-dd" role="menu" ref={ddRef} style={{ left: navPos.left, top: navPos.top }}>
            {g.tabs.map((k) => (
              <button
                key={k}
                role="menuitem"
                className={tab === k ? 'on' : ''}
                onClick={() => { setTab(k); setNavOpen(null); }}
                onPointerEnter={() => warmUp(k)}
              >
                <i className={`fas ${TAB_META[k].icon}`} />
                <span><b>{TAB_META[k].label}</b><small>{TAB_META[k].desc}</small></span>
                {badgeOf(k) > 0 && (
                  <span className="tab-badge" title={k === 'accounts' ? `${badgeOf(k)} waiting for verification` : `${badgeOf(k)} waiting for approval`}>{badgeOf(k)}</span>
                )}
              </button>
            ))}
          </div>
        );
      })()}

      <main className="adm2-main">
        <div className="adm-content" style={tab === 'map' || tab === 'intake' ? { maxWidth: 'none', padding: 0 } : { maxWidth: tab === 'leads' ? 1800 : 1480 }}>
          {tab === 'dashboard' && (
            <DashboardPanel s={stats} city={city} userName={displayName || user.email.split('@')[0]} onGo={(t) => visible.includes(t) && setTab(t)} can={(t) => visible.includes(t)} />
          )}
          {warm.includes('map') && <div hidden={tab !== 'map'}><MapPanel /></div>}
          {warm.includes('intake') && <div hidden={tab !== 'intake'}><IntakePanel hash={intakeHash} /></div>}
          {tab === 'developers' && <DevelopersPanel flash={flash} />}
          {tab === 'leads' && <LeadsPanel flash={flash} isOwner={isOwner} focusId={leadFocus} onFocusDone={() => setLeadFocus(null)} />}
          {tab === 'whatsapp' && (
            <div className="pg-wrap pg-wa">
              <PageHead icon="fa-comments" title="WhatsApp" sub="Chats with buyers, AI auto-replies, OTP sign-ins and automations." />
              <WhatsAppPanel flash={flash} onOpenLead={visible.includes('leads') ? (id) => { setLeadFocus(id); setTab('leads'); } : undefined} />
            </div>
          )}
          {tab === 'buyerleads' && isOwner && <BuyerLeadsPanel flash={flash} onOpenLeads={() => setTab('leads')} />}
          {tab === 'projects' && (
            <div className="pg-wrap pg-projects">
              <PageHead icon="fa-map-pin" title="Project Management" sub="Projects developers add from their dashboard — they go live on the map only after you approve them.">
                {visible.includes('intake') && <button type="button" className="pg-btn" onClick={() => setTab('intake')}><i className="fas fa-plus" /> Add Project</button>}
              </PageHead>
              <DevProjectsPanel flash={flash} isOwner={isOwner} onPendingChange={setProjPending} focus={projFocus} onFocusDone={() => setProjFocus(null)} />
            </div>
          )}
          {tab === 'accounts' && (
            <div className="pg-wrap">
              <PageHead icon="fa-users" title="Accounts" sub="Buyer, developer and channel-partner sign-ups — verify partners and see their activity." />
              <AccountsPanel
                flash={flash} isOwner={isOwner} onPendingChange={setPendingCount}
                focusId={accountFocus} onFocusDone={() => setAccountFocus(null)}
                onOpenProjects={visible.includes('projects') ? openProjects : undefined}
              />
            </div>
          )}
          {tab === 'blogs' && <BlogsPanel flash={flash} onGo={(t) => visible.includes(t) && setTab(t)} />}
          {tab === 'employees' && isOwner && <EmployeesPanel flash={flash} owner={{ name: displayName, email: user.email, avatar }} onProfile={() => setTab('profile')} />}
          {tab === 'devapi' && isOwner && <DeveloperApiPanel flash={flash} />}
          {tab === 'seo' && (
            <div className="pg-wrap">
              <PageHead icon="fa-chart-line" title="SEO & Analytics" sub="Website traffic, Google Search Console, site health and ranking checklist.">
                {visible.includes('settings') && <button type="button" className="pg-btn ghost" onClick={() => setTab('settings')}><i className="fas fa-gear" /> Analytics settings</button>}
              </PageHead>
              <SeoPanel />
            </div>
          )}
          {(tab === 'settings' || tab === 'profile' || tab === 'backups') && (() => {
            const SETTINGS_SECS = ['general', 'seo', 'notifications', 'activity'];
            const current = tab === 'backups' ? 'backups'
              : tab === 'profile' ? (stSec === 'security' ? 'security' : 'profile')
                : SETTINGS_SECS.includes(stSec) ? stSec : 'general';
            const canSettings = visible.includes('settings');
            const items: { key: string; icon: string; label: string; tab: string; show: boolean; out?: boolean }[] = [
              { key: 'general', icon: 'fa-gear', label: 'General', tab: 'settings', show: canSettings },
              { key: 'profile', icon: 'fa-user', label: 'Profile', tab: 'profile', show: true },
              { key: 'notifications', icon: 'fa-bell', label: 'Notifications', tab: 'settings', show: canSettings },
              { key: 'integrations', icon: 'fa-plug', label: 'Integrations', tab: 'devapi', show: visible.includes('devapi'), out: true },
              { key: 'seo', icon: 'fa-chart-line', label: 'SEO & Analytics', tab: 'settings', show: canSettings },
              { key: 'security', icon: 'fa-shield-halved', label: 'Security', tab: 'profile', show: true },
              { key: 'backups', icon: 'fa-database', label: 'Backups', tab: 'backups', show: visible.includes('backups') },
              { key: 'activity', icon: 'fa-clock-rotate-left', label: 'Activity Log', tab: 'settings', show: canSettings && isOwner },
            ];
            return (
              <div className="st">
                <PageHead icon="fa-gear" title="Settings" sub="Manage your account, integrations and platform configuration." />
                <div className="st-body">
                  <nav className="pg-card st-nav" aria-label="Settings sections">
                    {items.filter((it) => it.show).map((it) => (
                      <button key={it.key} type="button" className={current === it.key ? 'on' : ''} onClick={() => { setStSec(it.key); setTab(it.tab); }}>
                        <i className={`fas ${it.icon}`} /> {it.label}
                        {it.out && <i className="fas fa-arrow-right st-go" aria-hidden="true" />}
                      </button>
                    ))}
                  </nav>
                  <div className="st-main">
                    {tab === 'settings' && current === 'general' && <SettingsForm view="general" cities={cities} />}
                    {tab === 'settings' && current === 'seo' && <SettingsForm view="seo" cities={cities} />}
                    {tab === 'settings' && current === 'notifications' && (
                      <NotificationsSettings
                        bell={visible.includes('projects') || visible.includes('accounts')}
                        locked={locked} onToggleLock={toggleLock}
                        onGo={(t) => visible.includes(t) && setTab(t)}
                      />
                    )}
                    {tab === 'settings' && current === 'activity' && isOwner && <ActivityLogSettings onOpenLeads={() => setTab('leads')} />}
                    {tab === 'backups' && isOwner && <BackupsPanel flash={flash} />}
                    {tab === 'profile' && (
                      <ProfileForm
                        email={user.email}
                        role={user.role}
                        name={user.name}
                        permissions={user.permissions}
                        avatar={avatar}
                        section={current === 'security' ? 'security' : 'profile'}
                        onProfileSaved={({ name, avatar: a }) => { setDisplayName(name); setAvatar(a); }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </main>

      {toastNode}
    </div>
  );
}
