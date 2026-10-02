import Link from 'next/link';
import { statusLabel, type SeoProject } from '@/lib/seo-data';
import SignOutButton from './SignOutButton';
import DeveloperProjects from './DeveloperProjects';

export interface DashboardAccount {
  name: string;
  email: string;
  mobile: string;
  role: 'buyer' | 'developer' | 'agent';
  verified: boolean;
  created_at: string;
  profile: Record<string, string>;
}

const ROLE_META = {
  buyer: { label: 'Buyer / Investor', icon: 'fa-house-chimney', panel: 'Buyer dashboard' },
  developer: { label: 'Developer / Builder', icon: 'fa-building', panel: 'Developer dashboard' },
  agent: { label: 'Agent / Broker / Channel Partner', icon: 'fa-handshake', panel: 'Partner dashboard' },
} as const;

const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const splitAreas = (s?: string) => (s || '').split(/[,/;]+/).map(norm).filter(Boolean);
const inAreas = (p: SeoProject, areas: string[]) => areas.some((a) => norm(p.location).includes(a));
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

function ProjectList({ items, empty }: { items: SeoProject[]; empty: string }) {
  if (!items.length) return <p className="dsh-empty">{empty}</p>;
  return (
    <ul className="dsh-projects">
      {items.slice(0, 12).map((p) => (
        <li key={p.id}>
          <span className={`dsh-dot s-${(p.status || '').toLowerCase()}`} aria-hidden="true" />
          <div className="meta">
            <b>{p.title || `Project #${p.number}`}</b>
            <small>{[p.location, p.developer].filter(Boolean).join(' · ') || '—'}</small>
          </div>
          <span className="dsh-status">{statusLabel(p.status) || '—'}</span>
          <Link className="dsh-link" href={`/map?pin=${encodeURIComponent(p.id)}`}>
            View on map <i className="fas fa-arrow-right" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="dsh-field">
      <span>{label}</span>
      <b>{value || '—'}</b>
    </div>
  );
}

export default function RoleDashboard({ account, projects }: { account: DashboardAccount; projects: SeoProject[] }) {
  const meta = ROLE_META[account.role];
  const p = account.profile;
  const firstName = account.name.split(' ')[0] || 'there';
  const live = projects.filter((x) => (x.status || '').toLowerCase() !== 'sold');

  let stats: { label: string; value: string | number; icon: string }[] = [];
  let main: React.ReactNode = null;
  let details: React.ReactNode = null;
  let actions: { href: string; label: string; icon: string }[] = [];

  if (account.role === 'buyer') {
    const areas = splitAreas(p.area);
    const matches = areas.length ? live.filter((x) => inAreas(x, areas)) : [];
    stats = [
      { label: 'Live projects on the map', value: live.length, icon: 'fa-map-location-dot' },
      { label: 'Matching your areas', value: areas.length ? matches.length : '—', icon: 'fa-bullseye' },
      { label: 'Ready to move', value: live.filter((x) => x.status === 'available').length, icon: 'fa-key' },
      { label: 'Upcoming launches', value: live.filter((x) => x.status === 'upcoming').length, icon: 'fa-rocket' },
    ];
    main = (
      <section className="dsh-card">
        <h2><i className="fas fa-bullseye" /> {areas.length ? `Projects in ${p.area}` : 'Latest projects'}</h2>
        <ProjectList
          items={areas.length ? matches : live.slice(-12).reverse()}
          empty="No live projects in your preferred areas yet — explore the full map to see everything nearby."
        />
      </section>
    );
    details = (
      <>
        <Field label="Preferred area" value={p.area} />
        <Field label="Configuration" value={p.configuration} />
        <Field label="Budget" value={p.budget} />
        <Field label="Planning to buy" value={p.timeline} />
        <Field label="Buying for" value={p.purpose} />
      </>
    );
    actions = [
      { href: '/map', label: 'Open the live map', icon: 'fa-map-location-dot' },
      { href: '/how-it-works', label: 'How to compare projects', icon: 'fa-scale-balanced' },
      { href: '/contact', label: 'Talk to our team', icon: 'fa-comments' },
    ];
  } else if (account.role === 'developer') {
    // Developers add and see only their own projects (owner-scoped, server-enforced).
    stats = [
      { label: 'Active projects (declared)', value: p.activeProjects || '—', icon: 'fa-building' },
      { label: 'Live projects on Mappingg', value: live.length, icon: 'fa-map-location-dot' },
      { label: 'MahaRERA project no.', value: p.reraProject || '—', icon: 'fa-shield-halved' },
      { label: 'Account status', value: account.verified ? 'Approved' : 'Pending', icon: 'fa-user-check' },
    ];
    main = <DeveloperProjects />;
    details = (
      <>
        <Field label="Company" value={p.company} />
        <Field label="Your role" value={p.designation} />
        <Field label="MahaRERA project no." value={p.reraProject} />
        <Field label="Website" value={p.website} />
      </>
    );
    actions = [
      { href: '/advertise', label: 'Promote your projects', icon: 'fa-bullhorn' },
      { href: '/map', label: 'Open the live map', icon: 'fa-map-location-dot' },
      { href: '/contact', label: 'Talk to our team', icon: 'fa-comments' },
    ];
  } else {
    const areas = splitAreas(p.areas);
    const inMine = areas.length ? live.filter((x) => inAreas(x, areas)) : [];
    stats = [
      { label: 'Live projects in your areas', value: inMine.length, icon: 'fa-map-pin' },
      { label: 'Areas you cover', value: areas.length, icon: 'fa-layer-group' },
      { label: 'New & upcoming launches', value: inMine.filter((x) => x.status === 'upcoming').length, icon: 'fa-rocket' },
      { label: 'Live projects across the map', value: live.length, icon: 'fa-map-location-dot' },
    ];
    main = (
      <section className="dsh-card">
        <h2><i className="fas fa-map-pin" /> Projects in your areas</h2>
        <ProjectList
          items={inMine}
          empty="No live projects found in your listed areas yet — open the live map to browse every project."
        />
      </section>
    );
    details = (
      <>
        <Field label="Agency / firm" value={p.agency} />
        <Field label="MahaRERA agent no." value={p.reraAgent} />
        <Field label="Areas you work in" value={p.areas} />
      </>
    );
    actions = [
      { href: '/map', label: 'Share project maps with clients', icon: 'fa-share-nodes' },
      { href: '/blog', label: 'New launches & market updates', icon: 'fa-newspaper' },
      { href: '/contact', label: 'Partner support', icon: 'fa-headset' },
    ];
  }

  return (
    <div className="dsh">
      <header className="dsh-top">
        <Link href="/" className="dsh-brand">
          <span className="mark" aria-hidden="true" />
          <span><b>Mappingg<em>.com</em></b><small>{meta.panel}</small></span>
        </Link>
        <div className="dsh-top-right">
          <span className="dsh-chip">
            <span className="who">{initials(account.name)}</span>
            <span className="who-meta"><b>{account.name}</b><small>{meta.label}</small></span>
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="dsh-content">
        <section className="dsh-hero">
          <div>
            <span className="dsh-role"><i className={`fas ${meta.icon}`} /> {meta.label}</span>
            <h1>Welcome back, {firstName}!</h1>
            <p>{account.role === 'buyer'
              ? 'Find, check and compare projects — with live status, MahaRERA-verified RERA numbers and possession dates.'
              : account.role === 'developer'
                ? 'Track your projects on the map and reach buyers and channel partners comparing projects in your area.'
                : 'Show clients exactly where a project is and what its RERA record says — and close faster.'}</p>
          </div>
          <Link href="/map" className="dsh-btn primary"><i className="fas fa-map-location-dot" /> Open live map</Link>
        </section>

        {!account.verified && (
          <div className="dsh-notice">
            <i className="fas fa-shield-halved" />
            <span><b>Verification pending.</b> We&apos;re checking your RERA number on MahaRERA — usually within one working day. You can use the live map meanwhile.</span>
          </div>
        )}

        <div className="dsh-stats">
          {stats.map((s) => (
            <div className="dsh-stat" key={s.label}>
              <i className={`fas ${s.icon}`} />
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="dsh-grid">
          {main}
          <aside className="dsh-side">
            <section className="dsh-card">
              <h2><i className="fas fa-user" /> Your details</h2>
              <Field label="Email" value={account.email} />
              <Field label="WhatsApp" value={account.mobile} />
              {details}
              <Field label="Status" value={account.verified ? 'Verified' : 'Pending verification'} />
            </section>
            <section className="dsh-card">
              <h2><i className="fas fa-bolt" /> Quick actions</h2>
              <div className="dsh-actions">
                {actions.map((a) => (
                  <Link key={a.label} href={a.href}><i className={`fas ${a.icon}`} /> {a.label}</Link>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
