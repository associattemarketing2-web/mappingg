import Link from 'next/link';
import { statusLabel, type SeoProject } from '@/lib/seo-data';
import SignOutButton from './SignOutButton';

// Agents / channel partners have no dashboard: after signing in they use the
// live map (like buyers). This is their only other page — "My profile": the
// projects they enquired about, projects in the areas they cover, and their
// account details. (Favourites are saved with the heart on the map's project
// cards and are not listed here.)

export interface AgentAccount {
  name: string;
  email: string;
  mobile: string;
  created_at: string;
  profile: Record<string, string>;
  /** Projects they enquired about on the live map. */
  enquiries: { pin_id: string; at: string; times: number }[];
  last_login_at: string;
  login_count: number;
}

const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const splitAreas = (s?: string) => (s || '').split(/[,/;]+/).map(norm).filter(Boolean);
const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const fmtDate = (d?: string) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="dsh-field">
      <span>{label}</span>
      <b>{value || '—'}</b>
    </div>
  );
}

function ProjectRow({ p, note }: { p: SeoProject; note?: string }) {
  return (
    <li>
      <span className={`dsh-dot s-${(p.status || '').toLowerCase()}`} aria-hidden="true" />
      <div className="meta">
        <b>{p.title || `Project #${p.number ?? ''}`}</b>
        <small>{[p.location, p.developer, note].filter(Boolean).join(' · ') || '—'}</small>
      </div>
      <span className="dsh-status">{statusLabel(p.status) || '—'}</span>
      <Link className="dsh-link" href={`/map?pin=${encodeURIComponent(p.id)}`}>
        View on map <i className="fas fa-arrow-right" />
      </Link>
    </li>
  );
}

export default function AgentProfile({ account, projects }: { account: AgentAccount; projects: SeoProject[] }) {
  const p = account.profile;
  const areas = splitAreas(p.areas);
  const live = projects.filter((x) => (x.status || '').toLowerCase() !== 'sold');
  const inMine = areas.length ? live.filter((x) => areas.some((a) => norm(x.location).includes(a))) : [];
  const byId = new Map(projects.map((x) => [x.id, x]));
  const enquired = account.enquiries
    .map((e) => ({ e, p: byId.get(e.pin_id) }))
    .filter((x): x is { e: AgentAccount['enquiries'][number]; p: SeoProject } => !!x.p);
  const firstName = account.name.split(' ')[0] || 'there';

  return (
    <div className="dsh bp">
      <header className="bp-top">
        <a className="bp-brand" href="/" aria-label="Mappingg home"><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></a>
        <div className="bp-top-actions">
          <a className="bp-btn primary" href="/map"><i className="fas fa-map-location-dot" /> <span className="bp-hide-sm">Open live map</span></a>
          <SignOutButton className="bp-btn ghost" />
        </div>
      </header>

      <main className="bp-main">
        <section className="bp-hero">
          <span className="bp-av" aria-hidden="true">{initialsOf(account.name)}</span>
          <div>
            <h1>Hi {firstName}</h1>
            <p>
              {account.email}
              {account.created_at ? ` · Channel partner since ${new Date(account.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}` : ''}
            </p>
          </div>
        </section>

        <a className="bp-map-cta" href="/map">
          <span className="ic"><i className="fas fa-map-location-dot" /></span>
          <span><b>Explore the live map</b><small>Every project with status, RERA, prices and what&apos;s nearby. Tap Enquire on any project for full details.</small></span>
          <i className="fas fa-arrow-right" />
        </a>

        <section className="dsh-card" id="enquiries">
          <h2><i className="fas fa-envelope-open-text" /> Projects you enquired about {enquired.length ? <span className="dsh-count">{enquired.length}</span> : null}</h2>
          {enquired.length ? (
            <ul className="dsh-projects">
              {enquired.map(({ e, p: proj }) => (
                <ProjectRow key={e.pin_id} p={proj} note={`Enquired ${fmtDate(e.at)}${e.times > 1 ? ` · ${e.times}×` : ''}`} />
              ))}
            </ul>
          ) : (
            <p className="dsh-empty">You haven&apos;t enquired about any project yet. Open a project on the <Link href="/map">live map</Link> and tap Enquire now.</p>
          )}
        </section>

        <section className="dsh-card">
          <h2><i className="fas fa-map-pin" /> Projects in your areas</h2>
          {inMine.length ? (
            <ul className="dsh-projects">
              {inMine.slice(0, 12).map((x) => <ProjectRow key={x.id} p={x} />)}
            </ul>
          ) : (
            <p className="dsh-empty">No live projects found in your listed areas yet — open the live map to browse every project.</p>
          )}
        </section>

        <section className="dsh-card">
          <h2><i className="fas fa-user" /> Your details</h2>
          <Field label="Name" value={account.name} />
          <Field label="Email" value={account.email} />
          <Field label="WhatsApp" value={account.mobile} />
          <Field label="Agency / firm" value={p.agency} />
          <Field label="MahaRERA agent no." value={p.reraAgent} />
          <Field label="Areas you work in" value={p.areas} />
          <Field label="Member since" value={fmtDate(account.created_at)} />
          <Field label="Last login" value={fmtDate(account.last_login_at)} />
          <Field label="Sign-ins" value={account.login_count ? String(account.login_count) : ''} />
          <p className="dsh-note">To change these details, contact <a href="/contact">partner support</a>.</p>
        </section>
      </main>
    </div>
  );
}
