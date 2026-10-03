'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import DeveloperProjects from './DeveloperProjects';

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
] as const;

type TabKey = (typeof TABS)[number]['key'];

interface MyProject {
  id: string; title: string; location: string; status: string; type: string;
  price: string; configuration: string; description: string;
  lat: number | null; lng: number | null; review: 'pending' | 'rejected' | 'live'; created_at: string;
}

function DevDashboard({ onGo }: { onGo: (t: TabKey) => void }) {
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

export default function DeveloperApp({ user }: { user: DevUser }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('dashboard');
  // The Map Editor is a whole app in an iframe; once opened it stays mounted so
  // switching back is instant (same pattern as the super-admin).
  const [warmMap, setWarmMap] = useState(false);
  useEffect(() => { if (tab === 'map') setWarmMap(true); }, [tab]);
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

  const initials = (user.name || user.email || '?').slice(0, 2).toUpperCase();
  const fullBleed = tab === 'map';

  return (
    <div className="adm2">
      <header className="adm2-top">
        <a className="adm2-brand" href="/" target="_blank" rel="noopener" aria-label="Mappingg.com home">
          <span className="mark" aria-hidden="true" />
          <span><b>Mappingg<em>.com</em></b><small>Developer panel</small></span>
        </a>
        <div className="adm2-top-right" ref={menuRef}>
          <a className="adm-chip" href="/" target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> View site</a>
          <button className="adm-chip" onClick={() => setMenuOpen((v) => !v)}>
            <span className="who">{initials}</span>
            <span className="who-meta"><b>{user.name || user.email.split('@')[0]}</b><small>Developer</small></span>
            <i className="fas fa-chevron-down" />
          </button>
          {menuOpen && (
            <div className="adm2-menu">
              <button onClick={logout}><i className="fas fa-right-from-bracket" /> Sign out</button>
            </div>
          )}
        </div>
      </header>

      <nav className="adm2-tabs">
        {TABS.map((t) => (
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
          {tab === 'dashboard' && <DevDashboard onGo={setTab} />}
          {warmMap && (
            <div hidden={tab !== 'map'}>
              <div className="adm-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <iframe title="Map editor" src="/dashboard/map" className="adm-frame" />
              </div>
            </div>
          )}
          {tab === 'intake' && <div className="adm-content" style={{ padding: 0, maxWidth: 820 }}><DeveloperProjects /></div>}
        </div>
      </main>
    </div>
  );
}
