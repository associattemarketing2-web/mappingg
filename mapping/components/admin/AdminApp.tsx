'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SettingsForm from './SettingsForm';
import ProfileForm from './ProfileForm';
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
  intake: { label: 'Projects Intake', icon: 'fa-file-arrow-up' },
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
            <a href="/s-admin/submissions"><i className="fas fa-location-dot" /><span><b>Developer submissions</b><small>Review & publish to the map</small></span></a>
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
      <iframe title="Map editor" src="/s-admin/map" className="adm-frame" />
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
          <p className="adm-note" style={{ marginTop: 16 }}><i className="fas fa-lightbulb" /><span>Visitor and ranking numbers come from Google Search Console and Analytics once they&apos;re connected in Settings.</span></p>
        </div>
      </div>
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
  async function remove(p: Post) {
    if (!confirm(`Delete “${p.title}”?`)) return;
    try {
      const r = await fetch(`/api/admin/blogs?id=${encodeURIComponent(p.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setPosts((l) => l.filter((x) => x.id !== p.id)); flash('Post deleted');
    } catch { flash('Delete failed', true); }
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
        <table className="adm-table">
          <thead><tr><th>Title</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
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
  async function remove(e: Emp) {
    if (!confirm(`Remove ${e.email}? They will lose access.`)) return;
    try {
      const r = await fetch(`/api/admin/employees?id=${encodeURIComponent(e.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setList((l) => l.filter((x) => x.id !== e.id)); flash('Employee removed');
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
        <table className="adm-table">
          <thead><tr><th>Employee</th><th>Access</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
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
      )}
    </div>
  );
}

/* ------------------------------ Leads / CRM ------------------------------ */
interface Lead {
  id: string; name: string; email?: string; phone?: string; subject?: string;
  message?: string; source?: string; status: 'new' | 'contacted' | 'won' | 'lost';
  notes?: string; created_at?: string; updated_at?: string;
}
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

function LeadsPanel({ flash }: { flash: (m: string, e?: boolean) => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | Lead['status']>('all');
  const [sel, setSel] = useState<Lead | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/leads', { credentials: 'same-origin' });
      const b = await r.json();
      setLeads(Array.isArray(b.data) ? b.data : []);
    } catch { flash('Could not load leads', true); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = {
    all: leads.length,
    new: leads.filter((l) => l.status === 'new').length,
    contacted: leads.filter((l) => l.status === 'contacted').length,
    won: leads.filter((l) => l.status === 'won').length,
    lost: leads.filter((l) => l.status === 'lost').length,
  };
  const term = q.trim().toLowerCase();
  const list = leads.filter((l) =>
    (filter === 'all' || l.status === filter) &&
    (!term || [l.name, l.email, l.phone, l.subject, l.message].some((x) => (x || '').toLowerCase().includes(term))),
  );

  function open(l: Lead) { setSel(l); setNotes(l.notes || ''); }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/leads', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ id, ...body }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message || 'Failed');
      setLeads((ls) => ls.map((x) => (x.id === id ? b.data : x)));
      setSel((s) => (s && s.id === id ? b.data : s));
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
    if (!confirm(`Delete lead from ${l.name}? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/admin/leads?id=${encodeURIComponent(l.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setLeads((ls) => ls.filter((x) => x.id !== l.id));
      if (sel?.id === l.id) setSel(null);
      flash('Lead deleted');
    } catch { flash('Delete failed', true); }
  }

  const initials = (l: Lead) => (l.name || l.email || '?').slice(0, 2).toUpperCase();

  return (
    <>
      <div className="crm-stats">
        {([['all', 'Total'], ['new', 'New'], ['contacted', 'Contacted'], ['won', 'Won'], ['lost', 'Lost']] as const).map(([k, lbl]) => (
          <button key={k} className={`crm-stat${filter === k ? ' on' : ''} s-${k}`} onClick={() => setFilter(k as typeof filter)}>
            <div className="v">{counts[k as keyof typeof counts]}</div><div className="l">{lbl}</div>
          </button>
        ))}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>Leads {list.length ? `(${list.length})` : ''}</h3>
          <div className="crm-tools">
            <input className="crm-search" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="adm-btn ghost sm" onClick={load}><i className="fas fa-rotate" /> Refresh</button>
          </div>
        </div>
        {loading ? (
          <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
        ) : list.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-address-book" /><p>No leads yet. Submissions from the Contact form appear here.</p></div>
        ) : (
          <table className="adm-table crm-table">
            <thead><tr><th>Lead</th><th>Topic</th><th>Status</th><th>Received</th><th></th></tr></thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id} className="crm-row" onClick={() => open(l)}>
                  <td className="t-title">
                    <span className="crm-ini">{initials(l)}</span>
                    <span className="crm-id"><b>{l.name}</b><small>{l.email || l.phone || '—'}</small></span>
                  </td>
                  <td>{l.subject || '—'}</td>
                  <td><span className={`crm-pill ${l.status}`}>{LEAD_STAGES.find((s) => s.key === l.status)?.label}</span></td>
                  <td className="muted">{leadWhen(l.created_at)}</td>
                  <td><button className="adm-btn ghost sm" onClick={(e) => { e.stopPropagation(); open(l); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sel && (
        <div className="crm-drawer-overlay" onClick={() => setSel(null)}>
          <aside className="crm-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="crm-drawer-head">
              <div className="crm-id big"><span className="crm-ini">{initials(sel)}</span><span><b>{sel.name}</b><small>{sel.subject}</small></span></div>
              <button className="adm-btn ghost sm" onClick={() => setSel(null)}><i className="fas fa-xmark" /></button>
            </div>

            <div className="crm-pipeline">
              {LEAD_STAGES.map((s) => (
                <button key={s.key} className={`crm-stage${sel.status === s.key ? ' on' : ''} ${s.key}`} disabled={busy} onClick={() => setStatus(sel, s.key)}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="crm-contact">
              {sel.email && <a className="adm-btn ghost sm" href={`mailto:${sel.email}`}><i className="fas fa-envelope" /> {sel.email}</a>}
              {sel.phone && <a className="adm-btn ghost sm" href={`tel:${sel.phone}`}><i className="fas fa-phone" /> {sel.phone}</a>}
              {sel.phone && <a className="adm-btn ghost sm" target="_blank" rel="noopener" href={`https://wa.me/${sel.phone.replace(/\D/g, '')}`}><i className="fab fa-whatsapp" /> WhatsApp</a>}
            </div>

            <div className="crm-block"><h4>Message</h4><p className="crm-msg">{sel.message || '—'}</p></div>
            <div className="crm-block">
              <h4>Internal notes</h4>
              <textarea className="crm-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for your team…" />
              <div className="adm-actions" style={{ marginTop: 8 }}>
                <button className="adm-btn primary sm" disabled={busy} onClick={saveNotes}><i className="fas fa-floppy-disk" /> Save notes</button>
                <button className="adm-btn danger sm" onClick={() => remove(sel)}><i className="fas fa-trash" /> Delete</button>
              </div>
            </div>
            <p className="crm-meta">Received {leadWhen(sel.created_at)} · via {sel.source || 'contact form'}</p>
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
  profile?: Record<string, string>; created_at?: string; updated_at?: string;
}
const ACCOUNT_ROLES: Record<Account['role'], { label: string; icon: string }> = {
  buyer: { label: 'Buyer / Investor', icon: 'fa-house-chimney' },
  developer: { label: 'Developer / Builder', icon: 'fa-building' },
  agent: { label: 'Agent / Channel Partner', icon: 'fa-handshake' },
};
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

function AccountsPanel({ flash, isOwner, onPendingChange }: {
  flash: (m: string, e?: boolean) => void; isOwner: boolean; onPendingChange?: (n: number) => void;
}) {
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | Account['role'] | 'pending' | 'rejected'>('all');
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [sel, setSel] = useState<Account | null>(null);
  const [notes, setNotes] = useState('');
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);

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

  const isPending = (a: Account) => statusOf(a) === 'pending';
  const counts = {
    all: rows.length,
    buyer: rows.filter((a) => a.role === 'buyer').length,
    developer: rows.filter((a) => a.role === 'developer').length,
    agent: rows.filter((a) => a.role === 'agent').length,
    pending: rows.filter(isPending).length,
    rejected: rows.filter((a) => statusOf(a) === 'rejected').length,
  };
  useEffect(() => { if (!loading) onPendingChange?.(counts.pending); }, [counts.pending, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const queue = rows.filter(isPending).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const term = q.trim().toLowerCase();
  const list = rows.filter((a) =>
    (filter === 'all' || (filter === 'pending' || filter === 'rejected' ? statusOf(a) === filter : a.role === filter)) &&
    (!term || [a.name, a.email, a.mobile, ...Object.values(a.profile || {})].some((x) => String(x || '').toLowerCase().includes(term))),
  );

  function open(a: Account) { setSel(a); setNotes(a.notes || ''); setNewPass(''); setRejectReason(''); setRejecting(false); }

  async function decide(a: Account, decision: 'approve' | 'reject' | 'reset') {
    if (decision === 'reject' && !rejectReason.trim()) { flash('Please write a reason — the applicant will see it.', true); return; }
    const ok = await patch(a.id, { decision, reason: decision === 'reject' ? rejectReason.trim() : undefined });
    if (!ok) return;
    setRejecting(false); setRejectReason('');
    flash(decision === 'approve' ? `${a.name || a.email} approved — their dashboard is now unlocked` : decision === 'reject' ? 'Application rejected' : 'Moved back to pending');
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
      setRows((ls) => ls.map((x) => (x.id === id ? b.data : x)));
      setSel((s) => (s && s.id === id ? b.data : s));
      return true;
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); return false; } finally { setBusy(false); }
  }

  async function remove(a: Account) {
    if (!confirm(`Delete the account of ${a.name || a.email}? They will no longer be able to sign in. This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/admin/accounts?id=${encodeURIComponent(a.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setRows((ls) => ls.filter((x) => x.id !== a.id));
      if (sel?.id === a.id) setSel(null);
      flash('Account deleted');
    } catch { flash('Delete failed', true); }
  }

  function exportCsv() {
    const keys = ['area', 'configuration', 'budget', 'timeline', 'purpose', 'company', 'designation', 'activeProjects', 'reraProject', 'website', 'agency', 'reraAgent', 'areas'];
    const head = ['Name', 'Email', 'WhatsApp', 'Type', 'Status', 'Signed up', ...keys];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = list.map((a) => [a.name, a.email, a.mobile, ACCOUNT_ROLES[a.role]?.label, ({ pending: 'Pending', approved: 'Verified', rejected: 'Rejected' } as const)[statusOf(a)], a.created_at, ...keys.map((k) => a.profile?.[k])].map(esc).join(','));
    const url = URL.createObjectURL(new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url; link.download = `mappingg-accounts-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  const initials = (a: Account) => (a.name || a.email || '?').slice(0, 2).toUpperCase();
  const statusPill = (a: Account) => {
    const st = statusOf(a);
    if (st === 'pending') return <span className="crm-pill contacted"><i className="fas fa-hourglass-half" /> Pending</span>;
    if (st === 'rejected') return <span className="crm-pill lost"><i className="fas fa-circle-xmark" /> Rejected</span>;
    return <span className="crm-pill won"><i className="fas fa-circle-check" /> {a.role === 'buyer' ? 'Active' : 'Verified'}</span>;
  };

  return (
    <>
      <div className="crm-stats">
        {([['all', 'All accounts'], ['buyer', 'Buyers'], ['developer', 'Developers'], ['agent', 'Partners'], ['pending', 'Awaiting verification'], ['rejected', 'Rejected']] as const).map(([k, lbl]) => (
          <button key={k} className={`crm-stat${filter === k ? ' on' : ''} s-${({ all: 'all', buyer: 'won', developer: 'new', agent: 'contacted', pending: 'contacted', rejected: 'lost' } as const)[k]}`} onClick={() => setFilter(k)}>
            <div className="v">{counts[k]}</div><div className="l">{lbl}</div>
          </button>
        ))}
      </div>

      {queue.length > 0 && (
        <div className="adm-panel vq">
          <div className="adm-panel-head">
            <h3><i className="fas fa-user-shield" /> Verification queue <span className="vq-count">{queue.length}</span></h3>
            <span className="muted vq-sub">Developers and channel partners can&apos;t use their dashboard until you approve them.</span>
          </div>
          <div className="vq-list">
            {queue.map((a) => (
              <div className="vq-item" key={a.id}>
                <span className="crm-ini">{initials(a)}</span>
                <div className="vq-main">
                  <b>{a.name || a.email}</b>
                  <small>{ACCOUNT_ROLES[a.role]?.label} · {orgOf(a) || '—'}{reraOf(a) ? ` · RERA ${reraOf(a)}` : ''}</small>
                </div>
                <span className="muted vq-when">{leadWhen(a.created_at)}</span>
                <button className="adm-btn primary sm" onClick={() => open(a)}><i className="fas fa-magnifying-glass" /> Review</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>Accounts {list.length ? `(${list.length})` : ''}</h3>
          <div className="crm-tools">
            <input className="crm-search" placeholder="Search name, email, phone, company, RERA…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="adm-btn ghost sm" onClick={exportCsv} disabled={!list.length}><i className="fas fa-file-csv" /> Export</button>
            <button className="adm-btn ghost sm" onClick={load}><i className="fas fa-rotate" /> Refresh</button>
          </div>
        </div>
        {loading ? (
          <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
        ) : list.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-users" /><p>No accounts here yet. Buyers, developers and partners who sign up on the site appear here.</p></div>
        ) : (
          <table className="adm-table crm-table">
            <thead><tr><th>Account</th><th>Type</th><th>Company / area</th><th>Status</th><th>Signed up</th><th></th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="crm-row" onClick={() => open(a)}>
                  <td className="t-title">
                    <span className="crm-ini">{initials(a)}</span>
                    <span className="crm-id"><b>{a.name || '—'}</b><small>{a.email}{a.mobile ? ` · ${a.mobile}` : ''}</small></span>
                  </td>
                  <td><i className={`fas ${ACCOUNT_ROLES[a.role]?.icon}`} style={{ color: 'var(--muted)', marginRight: 6 }} />{ACCOUNT_ROLES[a.role]?.label || a.role}</td>
                  <td>{orgOf(a) || <span className="muted">—</span>}</td>
                  <td>{statusPill(a)}</td>
                  <td className="muted">{leadWhen(a.created_at)}</td>
                  <td><button className="adm-btn ghost sm" onClick={(e) => { e.stopPropagation(); open(a); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sel && (
        <div className="crm-drawer-overlay" onClick={() => setSel(null)}>
          <aside className="crm-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="crm-drawer-head">
              <div className="crm-id big"><span className="crm-ini">{initials(sel)}</span><span><b>{sel.name || sel.email}</b><small>{ACCOUNT_ROLES[sel.role]?.label}</small></span></div>
              <button className="adm-btn ghost sm" onClick={() => setSel(null)}><i className="fas fa-xmark" /></button>
            </div>

            <div className="crm-contact">
              <a className="adm-btn ghost sm" href={`mailto:${sel.email}`}><i className="fas fa-envelope" /> {sel.email}</a>
              {sel.mobile && <a className="adm-btn ghost sm" href={`tel:${sel.mobile}`}><i className="fas fa-phone" /> {sel.mobile}</a>}
              {sel.mobile && <a className="adm-btn ghost sm" target="_blank" rel="noopener" href={`https://wa.me/${sel.mobile.replace(/\D/g, '')}`}><i className="fab fa-whatsapp" /> WhatsApp</a>}
            </div>

            <div className="crm-block">
              <h4>Sign-up details</h4>
              <table className="adm-table">
                <tbody>
                  {PROFILE_FIELDS[sel.role]?.map(([k, lbl]) => (
                    <tr key={k}><td className="muted">{lbl}</td><td>{sel.profile?.[k] || '—'}</td></tr>
                  ))}
                  <tr><td className="muted">Signed up</td><td>{sel.created_at ? new Date(sel.created_at).toLocaleString('en-IN') : '—'}</td></tr>
                </tbody>
              </table>
            </div>

            {sel.role !== 'buyer' && (
              <div className={`crm-block vf vf-${statusOf(sel)}`}>
                <h4>Verification {statusPill(sel)}</h4>
                {statusOf(sel) === 'pending' && (
                  <ol className="vf-steps">
                    <li>Check the {sel.role === 'developer' ? 'company and MahaRERA project number' : 'agency and MahaRERA agent number'} above.</li>
                    <li>
                      {reraOf(sel)
                        ? <>Search <b>{reraOf(sel)}</b> on MahaRERA{' '}
                            <a className="adm-btn ghost sm" href={MAHARERA_SEARCH[sel.role as 'developer' | 'agent']} target="_blank" rel="noopener" onClick={() => copyRera(sel)}>
                              <i className="fas fa-arrow-up-right-from-square" /> Open MahaRERA (number copied)
                            </a></>
                        : <>No RERA number was given — ask them on WhatsApp before approving.</>}
                    </li>
                    <li>Approve to unlock their dashboard, or reject with a reason they&apos;ll see.</li>
                  </ol>
                )}
                {statusOf(sel) === 'rejected' && sel.verification_note && (
                  <p className="vf-reason"><b>Reason shown to them:</b> {sel.verification_note}</p>
                )}
                {sel.verified_at && statusOf(sel) !== 'pending' && (
                  <p className="crm-meta" style={{ marginTop: 0 }}>
                    {statusOf(sel) === 'approved' ? 'Approved' : 'Rejected'} {leadWhen(sel.verified_at)}{sel.verified_by ? ` by ${sel.verified_by}` : ''}
                  </p>
                )}

                {!isOwner ? (
                  <p className="crm-meta" style={{ marginTop: 0 }}><i className="fas fa-lock" /> Only the super admin can approve or reject accounts.</p>
                ) : rejecting ? (
                  <div className="vf-reject">
                    <textarea className="crm-notes" rows={3} autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="e.g. The MahaRERA number doesn't match the company name — please contact us with your correct details." />
                    <div className="adm-actions" style={{ marginTop: 8 }}>
                      <button className="adm-btn danger sm" disabled={busy || !rejectReason.trim()} onClick={() => decide(sel, 'reject')}><i className="fas fa-circle-xmark" /> Reject application</button>
                      <button className="adm-btn ghost sm" onClick={() => { setRejecting(false); setRejectReason(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="adm-actions">
                    {statusOf(sel) !== 'approved' && (
                      <button className="adm-btn primary sm" disabled={busy} onClick={() => decide(sel, 'approve')}><i className="fas fa-circle-check" /> Approve</button>
                    )}
                    {statusOf(sel) !== 'rejected' && (
                      <button className="adm-btn danger sm" disabled={busy} onClick={() => setRejecting(true)}><i className="fas fa-circle-xmark" /> Reject…</button>
                    )}
                    {statusOf(sel) !== 'pending' && (
                      <button className="adm-btn ghost sm" disabled={busy} onClick={() => decide(sel, 'reset')}><i className="fas fa-rotate-left" /> Back to pending</button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="crm-block">
              <h4>Internal notes</h4>
              <textarea className="crm-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for your team…" />
              <div className="adm-actions" style={{ marginTop: 8 }}>
                <button className="adm-btn primary sm" disabled={busy} onClick={async () => { if (await patch(sel.id, { notes })) flash('Notes saved'); }}><i className="fas fa-floppy-disk" /> Save notes</button>
              </div>
            </div>

            <div className="crm-block">
              <h4>Login</h4>
              <p className="crm-meta" style={{ marginTop: 0 }}>Signs in with <b>{sel.email}</b>. Passwords are stored encrypted and can&apos;t be viewed, only reset.</p>
              <div className="adm-actions">
                <input className="crm-search" type="text" autoComplete="off" placeholder="New password (min 8 characters)" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
                <button className="adm-btn ghost sm" disabled={busy || newPass.length < 8} onClick={async () => { if (await patch(sel.id, { password: newPass })) { setNewPass(''); flash('Password reset — share it with the user securely'); } }}><i className="fas fa-key" /> Reset password</button>
                <button className="adm-btn danger sm" onClick={() => remove(sel)}><i className="fas fa-trash" /> Delete account</button>
              </div>
            </div>
            <p className="crm-meta">Last updated {leadWhen(sel.updated_at || sel.created_at)}</p>
          </aside>
        </div>
      )}
    </>
  );
}

/* ------------------------------- Backups --------------------------------- */
interface PinSummary { id: string; number: number | null; title: string; developer: string; location: string; status: string; updated_at: string; }
interface Snapshot { id: string; created_at: string; reason: 'auto' | 'manual'; size: number; counts: Record<string, number>; }
interface DeletedPin extends PinSummary { history_id: string; deleted_at: string; blank: boolean; }
interface Compare { snapshot: Snapshot; missing: PinSummary[]; added: PinSummary[]; changed: number; }
interface HistorySummary { total: number; edits: number; deletes: number; first: string | null; last: string | null; }

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

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/backups', { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setLive(b.data.live || {}); setSnaps(b.data.snapshots || []); setDeleted(b.data.deleted || []); setKeep(b.data.keep || 14); setHistory(b.data.history || null);
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

  if (loading && !snaps.length) return <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Checking backups…</p></div>;

  const latest = snaps[0];
  const realDeleted = deleted.filter((d) => !d.blank);
  const blankDeleted = deleted.filter((d) => d.blank);
  const deletedList = showBlank ? deleted : realDeleted;
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
          <table className="adm-table">
            <thead><tr><th>Project</th><th>Deleted</th><th /></tr></thead>
            <tbody>
              {deletedList.map((p) => (
                <tr key={p.history_id}>
                  <td className="t-title"><b>{p.number != null ? `#${p.number} ` : ''}{pinName(p)}</b><small className="muted"> {[p.developer, p.location].filter(Boolean).join(' · ')}</small></td>
                  <td className="muted">{fmtDate(p.deleted_at)}</td>
                  <td><button className="adm-btn ghost sm" disabled={!!busy} onClick={() => restoreDeleted(p)}><i className="fas fa-rotate-left" /> Restore</button></td>
                </tr>
              ))}
            </tbody>
          </table>
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
    ? ['dashboard', 'map', 'intake', 'leads', 'accounts', 'blogs', 'employees', 'backups', 'seo', 'settings', 'profile']
    : ['dashboard', ...GRANTABLE.map((g) => g.key).filter((k) => user.permissions.includes(k)), 'profile'];

  // Profile and Settings live in the top-right account menu, not the tab row.
  const MENU_TABS = ['profile', 'settings'];
  const tabRow = visible.filter((k) => !MENU_TABS.includes(k));
  const [tab, setTab] = useState(visible[0] || 'dashboard');
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
  // open straight to /s-admin (handled by <LockRedirect/> in the root layout).
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    try { setLocked(localStorage.getItem('mg_lock_panel') === '/s-admin'); } catch {}
  }, []);
  function toggleLock() {
    try {
      if (localStorage.getItem('mg_lock_panel')) {
        localStorage.removeItem('mg_lock_panel');
        setLocked(false);
        flash('Unlocked — the app opens normally now.');
      } else {
        localStorage.setItem('mg_lock_panel', '/s-admin');
        setLocked(true);
        flash('Locked — the installed app will open straight to s-admin.');
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
          <a className="adm-chip" href="/" target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> View site</a>
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
          </button>
        ))}
      </nav>

      <main className="adm2-main">
        <div className="adm-content" style={tab === 'map' || tab === 'intake' ? { maxWidth: 'none', padding: 0 } : undefined}>
          {tab === 'dashboard' && <DashboardPanel onGo={(t) => visible.includes(t) && setTab(t)} />}
          {warm.includes('map') && <div hidden={tab !== 'map'}><MapPanel /></div>}
          {warm.includes('intake') && <div hidden={tab !== 'intake'}><IntakePanel /></div>}
          {tab === 'leads' && <LeadsPanel flash={flash} />}
          {tab === 'accounts' && <AccountsPanel flash={flash} isOwner={isOwner} onPendingChange={setPendingCount} />}
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
