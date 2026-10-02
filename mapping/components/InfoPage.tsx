import '@/app/info.css';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import TocSpy from '@/components/TocSpy';
import IconFont from '@/components/IconFont';

// Shared building blocks for the company & legal pages (About, Contact, Careers,
// Advertise, Privacy, Terms, Disclaimer): the page shell with hero and footer,
// the legal-document layout with a sticky table of contents, and a few
// decorative map illustrations drawn in the landing page's map palette.

export const LEGAL_UPDATED = '30 September 2026';
export const EMAIL = 'info@associatte.com';

type Tone = 'park' | 'water' | 'earth' | 'road';

const COMPANY_LINKS = [
  { href: '/about', label: 'About us' },
  { href: '/contact', label: 'Contact' },
  { href: '/careers', label: 'Careers' },
  { href: '/advertise', label: 'Advertise' },
];
const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of use' },
  { href: '/disclaimer', label: 'Disclaimer' },
  { href: '/map-data', label: 'Map data & OpenStreetMap' },
];
const EXPLORE_LINKS = [
  { href: '/map', label: 'Live map' },
  { href: '/mundhwa-map-3d', label: '3D map' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/features', label: 'Features' },
  { href: '/blog', label: 'Blog' },
  { href: '/faq', label: 'FAQ' },
];

export default function InfoPage({
  path,
  crumb,
  eyebrow,
  icon,
  tone = 'park',
  title,
  intro,
  meta,
  actions,
  children,
}: {
  path: string;
  crumb: string;
  eyebrow: string;
  icon: string;
  tone?: Tone;
  title: React.ReactNode;
  intro?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="ipg">
      <IconFont />
      <SiteHeader />

      <header className={`ipg-hero tone-${tone}`}>
        <div className="container">
          <div className="inner">
            <nav className="ipg-crumbs" aria-label="Breadcrumb">
              <Link href="/">Home</Link>
              <i className="fas fa-chevron-right" aria-hidden="true" />
              <span aria-current="page">{crumb}</span>
            </nav>
            <div className="hero-icon" aria-hidden="true"><i className={icon} /></div>
            <span className="eyebrow"><span className="dot" />{eyebrow}</span>
            <h1>{title}</h1>
            {intro && <p className="lead">{intro}</p>}
            {meta}
            {actions && <div className="actions">{actions}</div>}
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="ipg-foot">
        <div className="container">
          <div className="cols">
            <div className="about">
              <Link href="/" className="brand" aria-label="Mappingg home">
                <span className="mark" aria-hidden="true" />
                <b>Mappingg<em>.com</em></b>
              </Link>
              <p>Every property project, mapped and verified. A product by Associatte PropTech, Pune.</p>
            </div>
            <FootCol title="Explore" links={EXPLORE_LINKS} path={path} />
            <FootCol title="Company" links={COMPANY_LINKS} path={path} />
            <FootCol title="Legal" links={LEGAL_LINKS} path={path} />
          </div>
          <div className="bottom">
            <span>© {new Date().getFullYear()} Associatte PropTech Pvt Ltd. All rights reserved.</span>
            <span>Questions? <a href={`mailto:${EMAIL}`}>{EMAIL}</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FootCol({ title, links, path }: { title: string; links: { href: string; label: string }[]; path: string }) {
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={l.href === path ? 'page' : undefined}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UpdatedChip({ date = LEGAL_UPDATED }: { date?: string }) {
  return (
    <span className="ipg-meta"><i className="fas fa-calendar-check" aria-hidden="true" /> Last updated {date}</span>
  );
}

export type LegalSection = { id: string; title: string; body: React.ReactNode };

// A legal document: sticky numbered TOC on the left, an optional "at a glance"
// summary, then numbered sections that the TOC links to.
export function LegalDoc({
  path,
  intro,
  glance,
  sections,
}: {
  path: string;
  intro: React.ReactNode;
  glance?: { icon: string; tone?: string; title: string; text: string }[];
  sections: LegalSection[];
}) {
  return (
    <section className="ipg-section tight">
      <div className="container">
        <div className="ipg-legal">
          <aside className="ipg-toc" aria-label="On this page">
            <h4>On this page</h4>
            <ol>
              {sections.map((s) => (
                <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
              ))}
            </ol>
            <div className="toc-other">
              <h4>Legal</h4>
              {LEGAL_LINKS.map((l) => (
                <Link key={l.href} href={l.href} aria-current={l.href === path ? 'page' : undefined}>{l.label}</Link>
              ))}
            </div>
          </aside>

          <article className="ipg-doc">
            {glance && (
              <>
                <div className="ipg-glance-title">At a glance</div>
                <div className="ipg-glance">
                  {glance.map((g) => (
                    <div key={g.title}>
                      <span className={`ipg-ic ${g.tone || ''}`}><i className={g.icon} aria-hidden="true" /></span>
                      <strong>{g.title}</strong>
                      <p>{g.text}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="intro">{intro}</div>
            {sections.map((s, i) => (
              <section id={s.id} key={s.id}>
                <h2><span className="n">{String(i + 1).padStart(2, '0')}</span>{s.title}</h2>
                {s.body}
              </section>
            ))}
          </article>
        </div>
      </div>
      <TocSpy />
    </section>
  );
}

export function ContactBlock() {
  return (
    <div className="ipg-address">
      <i className="fas fa-building" aria-hidden="true" />
      <div>
        <strong>Associatte PropTech Pvt Ltd</strong>
        302 and 303, Naren Pearl, 3rd Floor, Magarpatta Road,<br />
        Above Axis and IndusInd Bank, Hadapsar, Pune - 411028<br />
        Email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
      </div>
    </div>
  );
}

export function CtaBand({
  title,
  text,
  children,
}: {
  title: React.ReactNode;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ipg-section">
      <div className="container">
        <div className="ipg-cta">
          <div className="inner">
            <h2>{title}</h2>
            <p>{text}</p>
            <div className="actions">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Stylised street map (not real geography) — blocks, a park, a river and roads.
export function MapArt() {
  return (
    <svg viewBox="0 0 500 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="500" height="400" fill="#f6f4ee" />
      <g fill="#ece8de">
        <rect x="20" y="20" width="110" height="70" rx="8" /><rect x="160" y="16" width="90" height="84" rx="8" />
        <rect x="360" y="24" width="120" height="64" rx="8" /><rect x="24" y="290" width="100" height="90" rx="8" />
        <rect x="300" y="280" width="80" height="100" rx="8" /><rect x="400" y="300" width="84" height="80" rx="8" />
        <rect x="150" y="300" width="110" height="80" rx="8" />
      </g>
      <g fill="#d6ebce" stroke="#c3e0b8" strokeWidth="2">
        <rect x="270" y="20" width="70" height="72" rx="8" />
        <path d="M24 150c30-16 80-10 100 16s-10 58-58 58S12 176 24 150z" />
      </g>
      <path d="M-20 250C70 220 140 270 230 236S390 170 520 210" fill="none" stroke="#93c2e8" strokeWidth="30" strokeLinecap="round" />
      <path d="M-20 250C70 220 140 270 230 236S390 170 520 210" fill="none" stroke="#a9d0ef" strokeWidth="24" strokeLinecap="round" />
      <g fill="none" strokeLinecap="round">
        <path d="M0 110H500M0 272H500M145 0V400M285 0V400M390 0V400" stroke="#e2ded3" strokeWidth="11" />
        <path d="M0 110H500M0 272H500M145 0V400M285 0V400M390 0V400" stroke="#fff" strokeWidth="7" />
        <path d="M-10 60C150 84 300 40 510 76" stroke="#eab95e" strokeWidth="13" />
        <path d="M-10 60C150 84 300 40 510 76" stroke="#f6d58f" strokeWidth="8" />
      </g>
    </svg>
  );
}

const PIN_COLORS: Record<string, string> = {
  park: '#2f7a3c', road: '#c9861f', earth: '#a9532d', water: '#2d6fa3', grey: '#7d837f',
};

// Map illustration with a few project pins and a floating info tag.
export function MiniMap({
  pins,
  tag,
}: {
  pins: { x: number; y: number; color: keyof typeof PIN_COLORS; icon: string }[];
  tag: { icon: string; title: string; text: string };
}) {
  return (
    <div className="ipg-minimap">
      <MapArt />
      {pins.map((p, i) => (
        <span key={i} className="pin" style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true">
          <b style={{ background: PIN_COLORS[p.color] }}><i className={p.icon} /></b>
        </span>
      ))}
      <div className="tag">
        <span className="ic"><i className={tag.icon} aria-hidden="true" /></span>
        <div>
          <strong>{tag.title}</strong>
          <span>{tag.text}</span>
        </div>
      </div>
    </div>
  );
}
