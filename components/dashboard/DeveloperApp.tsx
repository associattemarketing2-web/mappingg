'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import DeveloperProjects from './DeveloperProjects';
import DevNotificationBell from './DevNotificationBell';
import ProfileForm from '@/components/admin/ProfileForm';
import PlanSummary from '@/components/subscriptions/PlanSummary';
import SubscriptionCenter from '@/components/subscriptions/SubscriptionCenter';
import DevMedia from '@/components/subscriptions/DevMedia';

// Developer control panel — the SAME shell/design as the super-admin (reuses
// admin.css: adm2 / adm2-top / adm2-tabs / adm-content), but with only the tabs
// a developer needs, and every bit of data scoped to their own projects:
//   Dashboard · Map Editor · Projects Intake
// The Map Editor is the identical legacy editor the super-admin uses; the server
// (see /api/db) owner-scopes every pin read/write, so a developer only ever sees
// and edits their own pins and each change is held for super-admin review.
export interface DevUser { email: string; name: string }

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
  { key: 'map', label: 'Map Editor', icon: 'fa-map-location-dot' },
  { key: 'intake', label: 'Projects Intake', icon: 'fa-location-dot' },
  { key: 'media', label: 'Project media', icon: 'fa-images', subs: true },
  { key: 'subscription', label: 'Subscription', icon: 'fa-crown', subs: true },
] as const;

// 'profile' lives in the top-right account menu, not the tab row (same as the
// super-admin), so it isn't part of TABS.
type TabKey = (typeof TABS)[number]['key'] | 'profile' | 'fulledit';

interface MyProject {
  id: string; title: string; location: string; status: string; type: string;
  price: string; configuration: string; description: string;
  lat: number | null; lng: number | null; review: 'pending' | 'rejected' | 'live'; created_at: string;
}

function DevDashboard({ onGo, subscriptions }: { onGo: (t: TabKey) => void; subscriptions: boolean }) {
  const [items, setItems] = useState<MyProject[] | null>(null);
  useEffect(() => {
    fetch('/api/my/projects', { credentials: 'same-origin' })
      .then((r) => r.json()).then((b) => setItems(Array.isArray(b.data) ? b.data : [])).catch(() => setItems([]));
  }, []);
  const c = {
    total: items?.length ?? 0,
    pending: items?.filter((p) => p.review === 'pending').length ?? 0,
    live: items?.filter((p) => p.review === 'live').length ?? 0,
    rejected: items?.filter((p) => p.review === 'rejected').length ?? 0,
  };
  const stats = [
    { icon: 'fa-building', v: c.total, l: 'Your projects' },
    { icon: 'fa-hourglass-half', v: c.pending, l: 'Pending review' },
    { icon: 'fa-map-location-dot', v: c.live, l: 'Live on the map' },
    { icon: 'fa-circle-xmark', v: c.rejected, l: 'Not approved' },
  ];
  return (
    <>
      {subscriptions && (
        <div style={{ marginBottom: 20 }}>
          <PlanSummary manageHref="/dashboard/developer/subscription" onManage={() => onGo('subscription')} />
        </div>
      )}
      <div className="adm-cards">
        {stats.map((s) => (
          <div className="adm-stat" key={s.l}>
            <div className="ic"><i className={`fas ${s.icon}`} /></div>
            <b>{items === null ? '…' : s.v}</b>
            <span>{s.l}</span>
          </div>
        ))}
      </div>
      <div className="adm-panel" style={{ marginTop: 20 }}>
        <div className="adm-panel-head"><h3>Quick actions</h3></div>
        <div className="dash-actions">
          <button onClick={() => onGo('map')}><i className="fas fa-map-location-dot" /><span><b>Map editor</b><small>Place &amp; edit your project pins</small></span></button>
          <button onClick={() => onGo('intake')}><i className="fas fa-location-dot" /><span><b>Projects intake</b><small>Add, bulk upload or update your projects</small></span></button>
          <a href="/map" target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /><span><b>Live map</b><small>See your projects as published</small></span></a>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
        New or edited projects are reviewed by the Mappingg team before they appear on the public map.
      </p>
    </>
  );
}

export default function DeveloperApp({ user, subscriptions = false }: { user: DevUser; subscriptions?: boolean }) {
  // Subscription-only tabs (media, plan) disappear while the master switch is off.
  const tabs = TABS.filter((t) => !('subs' in t) || subscriptions);
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('dashboard');
  // The Map Editor is a whole app in an iframe; once opened it stays mounted so
  // switching back is instant (same pattern as the super-admin).
  const [warmMap, setWarmMap] = useState(false);
  useEffect(() => { if (tab === 'map') setWarmMap(true); }, [tab]);
  // Name + avatar shown in the top-right chip; the Profile tab can change them.
  const [displayName, setDisplayName] = useState(user.name || '');
  const [avatar, setAvatar] = useState('');
  useEffect(() => {
    fetch('/api/admin/profile', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => { if (b?.data) { setDisplayName(b.data.name || user.name || ''); setAvatar(b.data.avatar || ''); } })
      .catch(() => {});
  }, [user.name]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    router.push('/'); router.refresh();
  }

  // "Edit all details" (Map Editor pin header or a Projects Intake row): opens the
  // project in the full project form (every field), shown here in the panel.
  // Saving there sends it to the Mappingg team for review, like any other edit.
  const [fullEdit, setFullEdit] = useState<{ url: string; back: TabKey } | null>(null);
  const [fullEditMsg, setFullEditMsg] = useState('');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const openFullEdit = async (pinId: string) => {
    setFullEditMsg('');
    try {
      const res = await fetch('/api/my/projects/full-edit', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pinId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.data?.url) throw new Error(body?.error?.message || `Could not open the full form (${res.status})`);
      setFullEdit({ url: body.data.url, back: tabRef.current === 'fulledit' ? 'intake' : tabRef.current });
      setTab('fulledit');
    } catch (e) {
      setFullEditMsg(e instanceof Error ? e.message : 'Could not open the full form');
    }
  };
  const openFullEditRef = useRef(openFullEdit);
  openFullEditRef.current = openFullEdit;
  useEffect(() => {
    // The Map Editor runs in a same-origin iframe and posts { type: 'mg:edit-pin', pinId }.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; pinId?: string } | null;
      if (d && d.type === 'mg:edit-pin' && d.pinId) openFullEditRef.current(String(d.pinId));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const initials = (displayName || user.email || '?').slice(0, 2).toUpperCase();
  const fullBleed = tab === 'map';

  return (
    <div className="adm2">
      <header className="adm2-top">
        <a className="adm2-brand" href="/" target="_blank" rel="noopener" aria-label="Mappingg.com home">
          <span className="mark" aria-hidden="true" />
          <span><b>Mappingg<em>.com</em></b><small>Developer panel</small></span>
        </a>
        <div className="adm2-top-right" ref={menuRef}>
          <DevNotificationBell onOpenProjects={() => setTab('intake')} />
          <a className="adm-chip" href="/map" target="_blank" rel="noopener" title="Open the live map"><i className="fas fa-arrow-up-right-from-square" /> <span className="adm-hide-sm">View site</span></a>
          <button className="adm-chip" onClick={() => setMenuOpen((v) => !v)}>
            <span className="who">
              {avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatar} alt="" />
                : initials}
            </span>
            <span className="who-meta"><b>{displayName || user.email.split('@')[0]}</b><small>Developer</small></span>
            <i className="fas fa-chevron-down" />
          </button>
          {menuOpen && (
            <div className="adm2-menu">
              <button className={tab === 'profile' ? 'on' : ''} onClick={() => { setTab('profile'); setMenuOpen(false); }}><i className="fas fa-user" /> Profile</button>
              <div className="adm2-menu-sep" />
              <button onClick={logout}><i className="fas fa-right-from-bracket" /> Sign out</button>
            </div>
          )}
        </div>
      </header>

      <nav className="adm2-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`adm2-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
            onPointerEnter={() => { if (t.key === 'map') setWarmMap(true); }}
          >
            <i className={`fas ${t.icon}`} /> {t.label}
          </button>
        ))}
      </nav>

      <main className="adm2-main">
        <div className="adm-content" style={fullBleed ? { maxWidth: 'none', padding: 0 } : undefined}>
          {fullEditMsg && (
            <div className="dsh-notice" role="alert" style={{ background: '#fdecec', color: '#b42318', margin: fullBleed ? 12 : '0 0 12px' }}>
              <i className="fas fa-triangle-exclamation" /> <span>{fullEditMsg}</span>
              <button type="button" className="adm-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setFullEditMsg('')} aria-label="Dismiss"><i className="fas fa-xmark" /></button>
            </div>
          )}
          {tab === 'dashboard' && <DevDashboard onGo={setTab} subscriptions={subscriptions} />}
          {warmMap && (
            <div hidden={tab !== 'map'}>
              <div className="adm-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <iframe title="Map editor" src="/dashboard/map" className="adm-frame" />
              </div>
            </div>
          )}
          {tab === 'intake' && <DeveloperProjects onEditAll={openFullEdit} />}
          {tab === 'fulledit' && fullEdit && (
            <div className="adm-panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="adm-panel-head" style={{ padding: '12px 16px', margin: 0 }}>
                <h3>Edit all details</h3>
                <div className="adm-actions">
                  <a className="adm-btn ghost sm" href={fullEdit.url} target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> New tab</a>
                  <button type="button" className="adm-btn ghost sm" onClick={() => setTab(fullEdit.back)}><i className="fas fa-arrow-left" /> Back</button>
                </div>
              </div>
              <iframe title="Edit all details" src={fullEdit.url} className="adm-frame" />
            </div>
          )}
          {subscriptions && tab === 'media' && <DevMedia />}
          {subscriptions && tab === 'subscription' && <SubscriptionCenter email={user.email} />}
          {tab === 'profile' && (
            <ProfileForm
              email={user.email}
              role="developer"
              name={displayName}
              avatar={avatar}
              onProfileSaved={({ name, avatar: a }) => { setDisplayName(name); setAvatar(a); }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
