'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SettingsForm from './SettingsForm';
import ProfileForm from './ProfileForm';
import DevProjectsPanel, { type DevProject } from './DevProjectsPanel';
import NotificationBell from './NotificationBell';
import PhoneInput from '@/components/PhoneInput';
import SearchConsolePanel from './SearchConsolePanel';
import { BulkBar, PickOne, useSelection } from './bulk';
import TrafficPanel from './TrafficPanel';
import DevelopersPanel from './DevelopersPanel';
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
  { key: 'accounts', label: 'Accounts', icon: 'fa-users', desc: 'Buyer, developer & partner sign-ups' },
  { key: 'blogs', label: 'Blogs', icon: 'fa-newspaper', desc: 'Write & publish SEO articles' },
  { key: 'seo', label: 'SEO & Health', icon: 'fa-chart-line', desc: 'View search & site health' },
  { key: 'settings', label: 'Settings', icon: 'fa-gear', desc: 'Edit analytics & verification' },
];

const TAB_META: Record<string, { label: string; icon: string }> = {
  dashboard: { label: 'Dashboard', icon: 'fa-gauge-high' },
  map: { label: 'Map Editor', icon: 'fa-map-location-dot' },
  developers: { label: 'Developers', icon: 'fa-building' },
  intake: { label: 'Projects Intake', icon: 'fa-file-arrow-up' },
  projects: { label: 'Developer projects', icon: 'fa-map-pin' },
  leads: { label: 'Leads', icon: 'fa-address-book' },
  accounts: { label: 'Accounts', icon: 'fa-users' },
  backups: { label: 'Backups', icon: 'fa-database' },
  blogs: { label: 'Blogs', icon: 'fa-newspaper' },
  employees: { label: 'Employees', icon: 'fa-users-gear' },
  seo: { label: 'SEO & Health', icon: 'fa-chart-line' },
  settings: { label: 'Settings', icon: 'fa-gear' },
  profile: { label: 'Profile', icon: 'fa-user' },
};

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
function DashboardPanel({ onGo }: { onGo: (t: string) => void }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    fetch('/api/admin/stats', { credentials: 'same-origin' })
      .then((r) => r.json()).then((b) => setS(b.data)).catch(() => setS({ dbOk: false }));
  }, []);
  if (!s) return <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>;

  const ch = s.charts || { byStatus: [], byType: [], newProjects: [], enquiries: [], addedThisMonth: 0, hiddenPins: 0 };
  const publicPins = ch.byStatus.reduce((a: number, x: { count: number }) => a + x.count, 0);
  const statusSlices = ch.byStatus.map((x: { key: string; count: number }) => ({ key: x.key, label: STATUS_META[x.key]?.label || x.key, count: x.count, color: STATUS_META[x.key]?.color || '#9b9a94' }));
  // At most 6 slices: the 5 biggest types, the rest folded into "Other".
  const topTypes = ch.byType.slice(0, 5);
  const restTypes = ch.byType.slice(5).reduce((a: number, x: { count: number }) => a + x.count, 0);
  const typeSlices = [...topTypes, ...(restTypes ? [{ key: 'Other', count: restTypes }] : [])]
    .map((x: { key: string; count: number }) => ({ key: x.key, label: x.key, count: x.count, color: TYPE_COLORS[x.key] || TYPE_COLORS.Other }));
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

  return (
    <div className="viz">
      <div className="viz-tiles dash-tiles">
        <StatTile label="Projects on the map" value={(s.pins ?? 0).toLocaleString('en-IN')}
          note={`${ch.addedThisMonth} added this month${ch.hiddenPins ? ` · ${ch.hiddenPins} hidden` : ''}`} />
        <StatTile label="Enquiries" value={String(s.enquiriesTotal ?? 0)} note={`${enqTotal} in the last 12 weeks`} />
        <StatTile label="Blog posts live" value={String(s.posts?.published ?? 0)} note={`${s.posts?.draft ?? 0} draft${(s.posts?.draft ?? 0) === 1 ? '' : 's'}`} />
        <StatTile label="Infrastructure & roads" value={String((s.infra ?? 0) + (s.roads ?? 0))} note={`${s.infra ?? 0} markers · ${s.roads ?? 0} roads`} />
      </div>

      {pending > 0 && (
        <button className="dash-alert" onClick={() => onGo('accounts')}>
          <i className="fas fa-user-shield" />
          <span><b>{pending} account{pending === 1 ? '' : 's'} waiting for verification</b> — developers / channel partners can&apos;t use their dashboard until you approve them.</span>
          <span className="dash-alert-go">Review <i className="fas fa-arrow-right" /></span>
        </button>
      )}

      <ChartCard
        title="Projects created day by day"
        subtitle="Each square is one day (India time) for the last 6 months — grey means no new projects that day"
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
            <DayHeatmap days={daily.days} today={daily.today} show={show} hide={hide} />
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
        <ChartCard
          title="Projects by type" subtitle="Residential, commercial and more"
          table={{ head: ['Type', 'Projects', 'Share'], rows: typeSlices.map((x: { label: string; count: number }) => [x.label, x.count, `${pct(x.count, publicPins)}%`]) }}
        >
          {(show, hide) => <Donut slices={typeSlices} centerValue={String(typeSlices.length)} centerLabel={typeSlices.length === 1 ? 'type' : 'types'} show={show} hide={hide} />}
        </ChartCard>
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

      <div className="viz-grid2">
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Quick actions</h3></div>
          <div className="dash-actions">
            <button onClick={() => onGo('map')}><i className="fas fa-map-location-dot" /><span><b>Map editor</b><small>Add & edit project pins</small></span></button>
            <button onClick={() => onGo('leads')}><i className="fas fa-address-book" /><span><b>Leads</b><small>Reply to enquiries</small></span></button>
            <button onClick={() => onGo('blogs')}><i className="fas fa-newspaper" /><span><b>Blogs</b><small>Write SEO articles</small></span></button>
            <button onClick={() => onGo('projects')}><i className="fas fa-map-pin" /><span><b>Developer projects</b><small>Approve & publish to the map</small></span></button>
            <a href="/map" target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /><span><b>Live site</b><small>See what visitors see</small></span></a>
          </div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Website health</h3><button className="adm-btn ghost sm" onClick={() => onGo('seo')}>Full report</button></div>
          <div className="adm-health">
            {health.map((h) => (
              <div className="adm-health-row" key={h.b}><span className={`dot ${h.ok}`} /><div><b>{h.b}</b></div><span className="val">{h.v}</span></div>
            ))}
          </div>
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
function IntakePanel() {
  return (
    <div className="adm-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <iframe title="Projects intake" src="/intake" className="adm-frame" />
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
interface Post { id: string; slug: string; title: string; status: 'draft' | 'published'; updated_at?: string; }
const EMPTY_BLOG = { title: '', slug: '', excerpt: '', content: '', cover_image: '', tags: '', author: 'Mappingg Team', seo_title: '', seo_description: '' };

function BlogsPanel({ flash }: { flash: (m: string, e?: boolean) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
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
      if (!r.ok) throw new Error();
      flash(status === 'published' ? 'Published!' : 'Saved as draft');
      setView('list'); load();
    } catch { flash('Save failed', true); } finally { setSaving(false); }
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

  return (
    <div className="adm-panel">
      <div className="adm-panel-head">
        <h3>All posts {posts.length ? `(${posts.length})` : ''}</h3>
        <button className="adm-btn primary sm" onClick={openNew}><i className="fas fa-plus" /> New post</button>
      </div>
      {loading ? (
        <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
      ) : posts.length === 0 ? (
        <div className="adm-empty"><i className="fas fa-newspaper" /><p>No posts yet. Create your first SEO article.</p></div>
      ) : (
        <>
        <BulkBar sel={sel} ids={posts.map((p) => p.id)} hint={`Select all ${posts.length} posts — or tick posts to publish, unpublish or delete them together`}>
          <button className="adm-btn primary sm" onClick={() => setStatusMany(sel.of(posts.map((p) => p.id)), 'published')}><i className="fas fa-globe" /> Publish</button>
          <button className="adm-btn ghost sm" onClick={() => setStatusMany(sel.of(posts.map((p) => p.id)), 'draft')}><i className="fas fa-eye-slash" /> Make draft</button>
          <button className="adm-btn danger sm" onClick={() => { const ids = sel.of(posts.map((p) => p.id)); if (confirm(`Delete ${ids.length} post${ids.length === 1 ? '' : 's'}? They move to Backups → Recycle bin, where you can restore them.`)) removeMany(ids); }}><i className="fas fa-trash" /> Delete</button>
        </BulkBar>
        <table className="adm-table">
          <thead><tr><th className="pick" /><th>Title</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} className={sel.has(p.id) ? 'picked' : undefined}>
                <td className="pick"><PickOne sel={sel} id={p.id} label={p.title} /></td>
                <td className="t-title">{p.title}<small>/blog/{p.slug}</small></td>
                <td><span className={`adm-badge ${p.status === 'published' ? 'ok' : 'muted'}`}>{p.status === 'published' ? 'Published' : 'Draft'}</span></td>
                <td className="muted">{fmt(p.updated_at)}</td>
                <td><div className="adm-actions">
                  <button className="adm-btn ghost sm" onClick={() => openEdit(p.id)}><i className="fas fa-pen" /> Edit</button>
                  {p.status === 'published' && <a className="adm-btn ghost sm" href={`/blog/${p.slug}`} target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /></a>}
                  <button className="adm-btn danger sm" onClick={() => remove(p)}><i className="fas fa-trash" /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}

/* ------------------------------ Employees -------------------------------- */
interface Emp { id: string; email: string; name?: string; permissions: string[]; created_at?: string; }

function EmployeesPanel({ flash }: { flash: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
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

  function openNew() { setEditId(null); setName(''); setEmail(''); setPassword(''); setPerms([]); setView('form'); }
  function openEdit(e: Emp) { setEditId(e.id); setName(e.name || ''); setEmail(e.email); setPassword(''); setPerms(e.permissions || []); setView('form'); }
  function togglePerm(k: string) { setPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])); }

  async function save() {
    if (!editId && (!email.trim() || password.length < 8)) return flash('Email and a password (8+ chars) are required', true);
    setSaving(true);
    try {
      const payload: any = { name, permissions: perms };
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

  return (
    <div className="adm-panel">
      <div className="adm-panel-head">
        <h3>Employees {list.length ? `(${list.length})` : ''}</h3>
        <button className="adm-btn primary sm" onClick={openNew}><i className="fas fa-user-plus" /> Add employee</button>
      </div>
      {loading ? (
        <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
      ) : list.length === 0 ? (
        <div className="adm-empty"><i className="fas fa-users-gear" /><p>No employees yet. Add teammates and choose which tabs they can access.</p></div>
      ) : (
        <>
        <BulkBar sel={sel} ids={list.map((e) => e.id)} hint={`Select all ${list.length} employees — or tick some to remove them together`}>
          <button className="adm-btn danger sm" onClick={() => { const ids = sel.of(list.map((e) => e.id)); if (confirm(`Remove ${ids.length} employee${ids.length === 1 ? '' : 's'}? They will lose access. You can restore them from Backups → Recycle bin.`)) removeMany(ids); }}><i className="fas fa-trash" /> Remove</button>
        </BulkBar>
        <table className="adm-table">
          <thead><tr><th className="pick" /><th>Employee</th><th>Access</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className={sel.has(e.id) ? 'picked' : undefined}>
                <td className="pick"><PickOne sel={sel} id={e.id} label={e.name || e.email} /></td>
                <td className="t-title">{e.name || e.email}<small>{e.email}</small></td>
                <td>{e.permissions.length ? e.permissions.map((p) => <span key={p} className="adm-badge muted" style={{ marginRight: 4 }}>{TAB_META[p]?.label || p}</span>) : <span className="muted">Dashboard only</span>}</td>
                <td><div className="adm-actions">
                  <button className="adm-btn ghost sm" onClick={() => openEdit(e)}><i className="fas fa-pen" /> Edit</button>
                  <button className="adm-btn danger sm" onClick={() => remove(e)}><i className="fas fa-trash" /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
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
  message?: string; source?: string; status: 'new' | 'contacted' | 'won' | 'lost';
  notes?: string; created_at?: string; updated_at?: string;
  // The employee this lead was transferred to (any source).
  assigned_to?: string | null; assigned_name?: string | null; assigned_at?: string | null; assigned_by?: string | null;
  // Map enquiries only:
  role?: PersonRole; pin_id?: string; locations?: string[];
  project?: {
    id: string; title: string; number: number | null; location: string;
    developer?: string; status?: string; type?: string; price?: string; configuration?: string; sqft?: string; possession?: string;
  } | null;
  // Map enquiries only: how many times they tapped "Enquire now" on this project, and when last.
  enquiry_clicks?: number; last_enquired_at?: string | null;
  // Map enquiries only: the enquirer's account (buyer, agent or developer), if they have one.
  account?: {
    id: string; signed_in: boolean; role?: string; name?: string; email?: string; mobile?: string;
    last_login_at: string | null; login_count: number; profile: Record<string, string>;
    compare_count: number; enquiry_count: number; member_since: string | null;
  } | null;
  // Buyer sign-ups only: that buyer's account activity.
  buyer?: {
    last_login_at: string | null; login_count: number; profile: Record<string, string>; account_exists: boolean;
    enquiries: { at: string; project: { id: string; title: string; number: number | null; location: string } }[];
    compare: { id: string; title: string; number: number | null; location: string }[];
  };
}
/** "2 BHK · ₹1 – 2 Cr · Mundhwa" from a buyer's sign-up preferences. */
const buyerWants = (l: Lead) => {
  const pf = l.buyer?.profile || {};
  return [pf.configuration, pf.budget, pf.area].filter(Boolean).join(' · ');
};
// Cap how many lead rows hit the DOM at once so the table stays fast even with
// thousands of leads. Counts/filters still run over the full set; the admin
// narrows with search/status to reach older rows.
const LEADS_RENDER_CAP = 300;
const UNASSIGNED = '__none';

const LEAD_STAGES: { key: Lead['status']; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];
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

function LeadsPanel({ flash }: { flash: (m: string, e?: boolean) => void }) {
  const [bySource, setBySource] = useState<Record<LeadSource, Lead[]>>({ map: [], signup: [], contact: [] });
  const [source, setSource] = useState<LeadSource>('map');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | Lead['status']>('all');
  const [role, setRole] = useState<'all' | PersonRole>('all');
  const [loc, setLoc] = useState('');
  const [sel, setSel] = useState<Lead | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Employees a lead can be transferred to, and the "Assigned to" filter
  // ('' = everyone, UNASSIGNED = nobody yet, else an employee id).
  const [staff, setStaff] = useState<{ id: string; name: string; email: string }[]>([]);
  const [assignee, setAssignee] = useState('');
  useEffect(() => {
    fetch('/api/admin/leads?staff=1', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((b) => setStaff(Array.isArray(b?.data) ? b.data : [])).catch(() => {});
  }, []);

  const [live, setLive] = useState(false);
  // Total leads per source when the API had to leave older ones out.
  const [truncated, setTruncated] = useState<Partial<Record<LeadSource, number>>>({});

  // `silent` refreshes (triggered by the real-time stream) skip the spinner so
  // the table doesn't flash while the admin is reading it.
  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const get = (s: LeadSource) => fetch(`/api/admin/leads?source=${s}`, { credentials: 'same-origin' }).then((r) => r.json());
      const [m, su, c] = await Promise.all([get('map'), get('signup'), get('contact')]);
      setBySource({ map: Array.isArray(m.data) ? m.data : [], signup: Array.isArray(su.data) ? su.data : [], contact: Array.isArray(c.data) ? c.data : [] });
      setTruncated({
        ...(m.truncated ? { map: Number(m.total) } : {}), ...(su.truncated ? { signup: Number(su.total) } : {}), ...(c.truncated ? { contact: Number(c.total) } : {}),
      });
    } catch { if (!silent) flash('Could not load leads', true); } finally { if (!silent) setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Near-real-time updates via SSE: refetch when the server signals a lead
  // table changed. EventSource auto-reconnects on drop; we refetch
  // authoritative data so no duplicate rows/notifications can appear.
  useEffect(() => {
    const es = new EventSource('/api/admin/leads/stream', { withCredentials: true });
    es.addEventListener('ready', () => setLive(true));
    es.addEventListener('changed', () => { void load(true); });
    es.onerror = () => setLive(false); // EventSource will retry automatically
    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const counts = {
    all: scoped.length,
    new: scoped.filter((l) => l.status === 'new').length,
    contacted: scoped.filter((l) => l.status === 'contacted').length,
    won: scoped.filter((l) => l.status === 'won').length,
    lost: scoped.filter((l) => l.status === 'lost').length,
  };
  const term = q.trim().toLowerCase();
  const matchesSearch = (l: Lead) => !term || [l.name, l.email, l.phone, l.subject, l.message, l.project?.title, l.project?.location]
    .some((x) => (x || '').toLowerCase().includes(term));
  const list = scoped.filter((l) => (filter === 'all' || l.status === filter) && matchesSearch(l));
  // Downloads follow the location / status / search filters, split by type.
  const forDownload = (r: PersonRole) => all.filter((l) => l.role === r && matchesLocation(l, loc) && (filter === 'all' || l.status === filter) && matchesSearch(l));

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
      ['Name', 'Email', 'Phone', 'Topic', 'Message', 'Status', 'Notes', 'Received'],
      list.map((l) => [l.name, l.email, l.phone, l.subject, l.message, stageLabel(l.status), l.notes, csvDate(l.created_at)]));
  }

  function open(l: Lead) { setSel(l); setNotes(l.notes || ''); }
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

  const initials = (l: Lead) => (l.name || l.email || '?').slice(0, 2).toUpperCase();
  const roleCount = (r: PersonRole) => bySource.map.filter((l) => l.role === r && matchesLocation(l, loc)).length;

  return (
    <>
      <div className="lead-src" role="tablist" aria-label="Lead source">
        <button role="tab" aria-selected={isMap} className={isMap ? 'on' : ''} onClick={() => switchSource('map')}>
          <i className="fas fa-map-location-dot" /> Map enquiries <span className="n">{bySource.map.length}</span>
        </button>
        <button role="tab" aria-selected={isSignup} className={isSignup ? 'on' : ''} onClick={() => switchSource('signup')}>
          <i className="fas fa-user-plus" /> Buyer sign-ups <span className="n">{bySource.signup.length}</span>
        </button>
        <button role="tab" aria-selected={source === 'contact'} className={source === 'contact' ? 'on' : ''} onClick={() => switchSource('contact')}>
          <i className="fas fa-envelope" /> Contact form <span className="n">{bySource.contact.length}</span>
        </button>
      </div>

      <div className="crm-stats">
        {([['all', 'Total'], ['new', 'New'], ['contacted', 'Contacted'], ['won', 'Won'], ['lost', 'Lost']] as const).map(([k, lbl]) => (
          <button key={k} className={`crm-stat${filter === k ? ' on' : ''} s-${k}`} onClick={() => setFilter(k as typeof filter)}>
            <div className="v">{counts[k as keyof typeof counts]}</div><div className="l">{lbl}</div>
          </button>
        ))}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>{isMap ? 'Map enquiries' : isSignup ? 'Buyer sign-ups' : 'Contact leads'} {list.length ? `(${list.length})` : ''}</h3>
          <div className="crm-tools">
            <span className="crm-live" title={live ? 'Live — updates automatically' : 'Reconnecting…'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: live ? '#2f7a3c' : '#9a6a00' }}>
              <i className="fas fa-circle" style={{ fontSize: 8, color: live ? '#2f7a3c' : '#c9861f' }} /> {live ? 'Live' : 'Offline'}
            </span>
            <input className="crm-search" placeholder={isMap ? 'Search name, email, phone, project…' : 'Search name, email, phone…'} value={q} onChange={(e) => setQ(e.target.value)} />
            {isMap && <LocationSelect items={bySource.map} value={loc} onChange={setLoc} />}
            <select className="crm-select" aria-label="Filter by employee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Assigned to: anyone</option>
              <option value={UNASSIGNED}>Not assigned ({all.filter((l) => !l.assigned_to).length})</option>
              {staff.map((e) => <option key={e.id} value={e.id}>{e.name} ({all.filter((l) => l.assigned_to === e.id).length})</option>)}
            </select>
            <button className="adm-btn ghost sm" onClick={() => load()}><i className="fas fa-rotate" /> Refresh</button>
          </div>
        </div>

        {isMap && (
          <div className="adm-filterbar">
            <div className="adm-seg" role="group" aria-label="Enquirer type">
              <button className={role === 'all' ? 'on' : ''} onClick={() => setRole('all')}>All types <span className="n">{bySource.map.filter((l) => matchesLocation(l, loc)).length}</span></button>
              {PEOPLE_ROLES.map((r) => (
                <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
                  <i className={`fas ${ROLE_META[r].icon}`} /> {ROLE_META[r].label} <span className="n">{roleCount(r)}</span>
                </button>
              ))}
            </div>
            <div className="dl-group">
              <span className="lbl"><i className="fas fa-download" /> Download</span>
              {PEOPLE_ROLES.map((r) => (
                <button key={r} className="adm-btn ghost sm" disabled={!forDownload(r).length} onClick={() => downloadMap(r)} title={`Download ${ROLE_META[r].label} enquiries as CSV`}>
                  {ROLE_META[r].short} ({forDownload(r).length})
                </button>
              ))}
            </div>
          </div>
        )}
        {!isMap && (
          <div className="adm-filterbar">
            <span className="muted" style={{ fontSize: 13 }}>{isSignup ? 'Buyers who created an account, with what they are looking for.' : <>Messages sent from the website&apos;s Contact page.</>}</span>
            <button className="adm-btn ghost sm" disabled={!list.length} onClick={downloadContact}><i className="fas fa-file-csv" /> Download CSV ({list.length})</button>
          </div>
        )}

        {loading ? (
          <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
        ) : list.length === 0 ? (
          <div className="adm-empty">
            <i className={`fas ${isMap ? 'fa-map-location-dot' : isSignup ? 'fa-user-plus' : 'fa-address-book'}`} />
            <p>{all.length === 0
              ? (isMap ? 'No map enquiries yet. When someone taps Enquire on a project card on the live map, it appears here.'
                : isSignup ? 'No buyer sign-ups yet. When a buyer creates an account, they appear here as a lead.'
                  : 'No leads yet. Submissions from the Contact form appear here.')
              : 'Nothing matches these filters.'}</p>
          </div>
        ) : (
          <>
          <BulkBar sel={pick} ids={list.slice(0, LEADS_RENDER_CAP).map((l) => l.id)} hint={`Select all ${Math.min(list.length, LEADS_RENDER_CAP)} shown — or tick leads to update or delete them together`}>
            <select className="crm-select" value="" disabled={busy} aria-label="Set status of selected leads"
              onChange={(e) => { if (e.target.value) setStatusMany(pick.of(list.map((l) => l.id)), e.target.value as Lead['status']); }}>
              <option value="">Set status…</option>
              {LEAD_STAGES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
            </select>
            {staff.length > 0 && (
              <select className="crm-select" value="" disabled={busy} aria-label="Transfer selected leads to an employee"
                onChange={(e) => { if (e.target.value) assignMany(pick.of(list.map((l) => l.id)), e.target.value); }}>
                <option value="">Transfer to…</option>
                {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                <option value={UNASSIGNED}>Nobody (unassign)</option>
              </select>
            )}
            <button className="adm-btn danger sm" disabled={busy} onClick={() => { const ids = pick.of(list.map((l) => l.id)); if (confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}? You can restore them from Backups → Recycle bin.`)) removeMany(ids); }}><i className="fas fa-trash" /> Delete</button>
          </BulkBar>
          <div className="table-scroll">
            <table className="adm-table crm-table">
              <thead>
                {isMap
                  ? <tr><th className="pick" /><th>Lead</th><th>Type</th><th>Project</th><th>Location</th><th>Account</th><th>Status</th><th>Received</th><th></th></tr>
                  : isSignup
                    ? <tr><th className="pick" /><th>Buyer</th><th>Looking for</th><th>Last login</th><th>Activity</th><th>Status</th><th>Signed up</th><th></th></tr>
                    : <tr><th className="pick" /><th>Lead</th><th>Topic</th><th>Status</th><th>Received</th><th></th></tr>}
              </thead>
              <tbody>
                {list.slice(0, LEADS_RENDER_CAP).map((l) => (
                  <tr key={l.id} className={`crm-row${pick.has(l.id) ? ' picked' : ''}`} onClick={() => open(l)}>
                    <td className="pick" onClick={(e) => e.stopPropagation()}><PickOne sel={pick} id={l.id} label={l.name || l.email || 'lead'} /></td>
                    <td className="t-title">
                      <span className="crm-ini">{initials(l)}</span>
                      <span className="crm-id"><b>{l.name}</b><small>{l.email || l.phone || '—'}</small></span>
                    </td>
                    {isMap ? (
                      <>
                        <td><i className={`fas ${ROLE_META[l.role || 'buyer'].icon}`} style={{ color: 'var(--muted)', marginRight: 6 }} />{ROLE_META[l.role || 'buyer'].label}</td>
                        <td>{projectName(l) || <span className="muted">Project removed</span>}</td>
                        <td>{l.locations?.length ? <span className="loc-tags">{l.locations.map((x) => <span className="loc-tag" key={x}>{x}</span>)}</span> : <span className="muted">—</span>}</td>
                        <td>
                          {l.account ? (
                            <span className="ml-acc">
                              <span className="ml-badge"><i className="fas fa-user-check" /> {l.account.signed_in ? 'Signed in' : 'Has account'} · {accountRole(l.account.role).short.replace(/s$/, '')}</span>
                              <small>{l.account.last_login_at ? `Last login ${leadWhen(l.account.last_login_at)}` : 'No login yet'}{l.account.login_count ? ` · ${l.account.login_count} sign-in${l.account.login_count === 1 ? '' : 's'}` : ''}</small>
                            </span>
                          ) : <span className="muted">Guest</span>}
                        </td>
                      </>
                    ) : isSignup ? (
                      <>
                        <td>{buyerWants(l) || <span className="muted">—</span>}</td>
                        <td>{l.buyer?.last_login_at ? <span title={new Date(l.buyer.last_login_at).toLocaleString('en-IN')}>{leadWhen(l.buyer.last_login_at)}</span> : <span className="muted">Not yet</span>}</td>
                        <td className="muted">
                          {[
                            l.buyer?.login_count ? `${l.buyer.login_count} sign-in${l.buyer.login_count === 1 ? '' : 's'}` : '',
                            l.buyer?.enquiries.length ? `${l.buyer.enquiries.length} enquir${l.buyer.enquiries.length === 1 ? 'y' : 'ies'}` : '',
                            l.buyer?.compare.length ? `${l.buyer.compare.length} in compare` : '',
                          ].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </>
                    ) : (
                      <td>{l.subject || '—'}</td>
                    )}
                    <td>
                      <span className={`crm-pill ${l.status}`}>{stageLabel(l.status)}</span>
                      {l.assigned_name && <small className="muted" style={{ display: 'block', marginTop: 3 }} title="Transferred to"><i className="fas fa-user-tie" /> {l.assigned_name}</small>}
                    </td>
                    <td className="muted" title={fullDate(l.created_at)}>
                      {leadWhen(l.created_at)}
                      {isMap && (l.enquiry_clicks || 1) > 1 && <small style={{ display: 'block' }}>{l.enquiry_clicks}× · last {leadWhen(l.last_enquired_at || undefined)}</small>}
                    </td>
                    <td><button className="adm-btn ghost sm" onClick={(e) => { e.stopPropagation(); open(l); }}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {!loading && truncated[source] != null && (
          <div className="adm-empty" style={{ padding: '12px 0' }}>
            <p>Only the newest {bySource[source].length} of {truncated[source]} leads are loaded here. Older leads are kept in the database.</p>
          </div>
        )}
        {!loading && list.length > LEADS_RENDER_CAP && (
          <div className="adm-empty" style={{ padding: '12px 0' }}>
            <p>Showing the first {LEADS_RENDER_CAP} of {list.length}. Use search or a filter to narrow down.</p>
          </div>
        )}
      </div>

      {sel && (
        <div className="crm-drawer-overlay" onClick={() => setSel(null)}>
          <aside className="crm-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="crm-drawer-head">
              <div className="crm-id big"><span className="crm-ini">{initials(sel)}</span><span><b>{sel.name}</b><small>{isMap ? ROLE_META[sel.role || 'buyer'].label : sel.subject}</small></span></div>
              <button className="adm-btn ghost sm" onClick={() => setSel(null)}><i className="fas fa-xmark" /></button>
            </div>

            <div className="crm-pipeline">
              {LEAD_STAGES.map((s) => (
                <button key={s.key} className={`crm-stage${sel.status === s.key ? ' on' : ''} ${s.key}`} disabled={busy} onClick={() => setStatus(sel, s.key)}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="crm-block">
              <h4>Transferred to</h4>
              {staff.length ? (
                <select className="crm-select" value={sel.assigned_to || ''} disabled={busy} onChange={(e) => assign(sel, e.target.value)} aria-label="Transfer this lead to an employee">
                  <option value="">Nobody yet</option>
                  {sel.assigned_to && !staff.some((e) => e.id === sel.assigned_to) && <option value={sel.assigned_to}>{sel.assigned_name || 'Former employee'}</option>}
                  {staff.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.email}</option>)}
                </select>
              ) : <p className="crm-meta" style={{ marginTop: 0 }}>No employees with access to Leads yet — add one under Employees and tick Leads.</p>}
              {sel.assigned_to && sel.assigned_at && <p className="crm-meta">Since {leadWhen(sel.assigned_at)}{sel.assigned_by ? ` · by ${sel.assigned_by}` : ''}</p>}
            </div>

            <div className="crm-contact">
              {sel.email && <a className="adm-btn ghost sm" href={`mailto:${sel.email}`}><i className="fas fa-envelope" /> {sel.email}</a>}
              {sel.phone && <a className="adm-btn ghost sm" href={`tel:${sel.phone.replace(/\s/g, '')}`}><i className="fas fa-phone" /> {sel.phone}</a>}
              {sel.phone && <a className="adm-btn ghost sm" target="_blank" rel="noopener" href={`https://wa.me/${sel.phone.replace(/\D/g, '')}`}><i className="fab fa-whatsapp" /> WhatsApp</a>}
            </div>

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
            <div className="crm-block">
              <h4>Internal notes</h4>
              <textarea className="crm-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for your team…" />
              <div className="adm-actions" style={{ marginTop: 8 }}>
                <button className="adm-btn primary sm" disabled={busy} onClick={saveNotes}><i className="fas fa-floppy-disk" /> Save notes</button>
                <button className="adm-btn danger sm" onClick={() => remove(sel)}><i className="fas fa-trash" /> Delete</button>
              </div>
            </div>
            <p className="crm-meta">{isSignup ? 'Signed up' : 'Received'} {leadWhen(sel.created_at)} · via {isMap ? 'Enquire on the live map' : (sel.source || 'contact form')}</p>
          </aside>
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
  const [filter, setFilter] = useState<'all' | Account['role'] | 'pending' | 'rejected'>('all');
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
  const [view, setView] = useState<'accounts' | 'activity'>('accounts');
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
export default function AdminApp({ user }: { user: AdminUser }) {
  const router = useRouter();
  const isOwner = user.role === 'admin';
  const { flash, node: toastNode } = useToast();

  const visible = isOwner
    ? ['dashboard', 'map', 'developers', 'projects', 'intake', 'leads', 'accounts', 'blogs', 'employees', 'backups', 'seo', 'settings', 'profile']
    : ['dashboard', ...GRANTABLE.map((g) => g.key).filter((k) => user.permissions.includes(k)).flatMap((k) => (k === 'intake' ? ['projects', 'intake'] : k === 'map' ? ['map', 'developers'] : [k])), 'profile'];

  // Profile and Settings live in the top-right account menu, not the tab row.
  const MENU_TABS = ['profile', 'settings'];
  const tabRow = visible.filter((k) => !MENU_TABS.includes(k));
  const [tab, setTab] = useState(visible[0] || 'dashboard');
  // Deep link: /dashboard/s-admin?tab=projects (used by the old submissions page).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t && visible.includes(t)) setTab(t);
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Developer projects waiting for approval (badge on the tab) and what to focus when opened.
  const [projPending, setProjPending] = useState(0);
  const [projFocus, setProjFocus] = useState<{ ownerId?: string; projectId?: string } | null>(null);
  const [accountFocus, setAccountFocus] = useState<string | null>(null);
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
  const [menuOpen, setMenuOpen] = useState(false);
  // Developer/partner accounts waiting for verification — shown as a badge on the Accounts tab.
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (!visible.includes('accounts')) return;
    fetch('/api/admin/stats', { credentials: 'same-origin' })
      .then((r) => r.json()).then((b) => setPendingCount(Number(b?.data?.accounts?.pending) || 0)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
    <div className="adm2">
      <header className="adm2-top">
        {/* Same logo as the main site header — the only logo on this screen. */}
        <a className="adm2-brand" href="/" target="_blank" rel="noopener" aria-label="Mappingg.com home">
          <span className="mark" aria-hidden="true" />
          <span><b>Mappingg<em>.com</em></b><small>{isOwner ? 'Super admin' : 'Team panel'}</small></span>
        </a>
        <div className="adm2-top-right" ref={menuRef}>
          {(visible.includes('projects') || visible.includes('accounts')) && (
            <NotificationBell
              flash={(m) => flash(m)}
              onPending={setProjPending}
              onOpenProjects={(f) => (visible.includes('projects') ? openProjects(f) : undefined)}
              onOpenAccount={(id) => (visible.includes('accounts') ? openAccount(id) : undefined)}
            />
          )}
          <a className="adm-chip" href="/map" target="_blank" rel="noopener" title="Open the live map"><i className="fas fa-arrow-up-right-from-square" /> <span className="adm-hide-sm">View site</span></a>
          <button className="adm-chip" onClick={() => setMenuOpen((v) => !v)}>
            <span className="who">
              {avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatar} alt="" />
                : initials}
            </span>
            <span className="who-meta"><b>{displayName || user.email.split('@')[0]}</b><small>{isOwner ? 'Owner' : 'Employee'}</small></span>
            <i className="fas fa-chevron-down" />
          </button>
          {menuOpen && (
            <div className="adm2-menu">
              <button className={tab === 'profile' ? 'on' : ''} onClick={() => { setTab('profile'); setMenuOpen(false); }}><i className="fas fa-user" /> Profile</button>
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

      <nav className="adm2-tabs">
        {tabRow.map((k) => (
          <button
            key={k}
            className={`adm2-tab${tab === k ? ' active' : ''}`}
            onClick={() => setTab(k)}
            onPointerEnter={() => warmUp(k)}
            onFocus={() => warmUp(k)}
          >
            <i className={`fas ${TAB_META[k].icon}`} /> {TAB_META[k].label}
            {k === 'accounts' && pendingCount > 0 && <span className="tab-badge" title={`${pendingCount} waiting for verification`}>{pendingCount}</span>}
            {k === 'projects' && projPending > 0 && <span className="tab-badge" title={`${projPending} waiting for approval`}>{projPending}</span>}
          </button>
        ))}
      </nav>

      <main className="adm2-main">
        <div className="adm-content" style={tab === 'map' || tab === 'intake' ? { maxWidth: 'none', padding: 0 } : undefined}>
          {tab === 'dashboard' && <DashboardPanel onGo={(t) => visible.includes(t) && setTab(t)} />}
          {warm.includes('map') && <div hidden={tab !== 'map'}><MapPanel /></div>}
          {warm.includes('intake') && <div hidden={tab !== 'intake'}><IntakePanel /></div>}
          {tab === 'developers' && <DevelopersPanel flash={flash} />}
          {tab === 'leads' && <LeadsPanel flash={flash} />}
          {tab === 'projects' && (
            <DevProjectsPanel flash={flash} isOwner={isOwner} onPendingChange={setProjPending} focus={projFocus} onFocusDone={() => setProjFocus(null)} />
          )}
          {tab === 'accounts' && (
            <AccountsPanel
              flash={flash} isOwner={isOwner} onPendingChange={setPendingCount}
              focusId={accountFocus} onFocusDone={() => setAccountFocus(null)}
              onOpenProjects={visible.includes('projects') ? openProjects : undefined}
            />
          )}
          {tab === 'blogs' && <BlogsPanel flash={flash} />}
          {tab === 'employees' && isOwner && <EmployeesPanel flash={flash} />}
          {tab === 'backups' && isOwner && <BackupsPanel flash={flash} />}
          {tab === 'seo' && <SeoPanel />}
          {tab === 'settings' && <SettingsForm />}
          {tab === 'profile' && (
            <ProfileForm
              email={user.email}
              role={user.role}
              name={user.name}
              permissions={user.permissions}
              avatar={avatar}
              onProfileSaved={({ name, avatar: a }) => { setDisplayName(name); setAvatar(a); }}
            />
          )}
        </div>
      </main>

      {toastNode}
    </div>
  );
}
