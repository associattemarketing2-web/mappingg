import Link from 'next/link';
import './subscriptions.css';

// Header + page frame for the account pages under /dashboard/<role>/…
// (subscription, CRM, premium tools). Links depend on the account type.
type Role = 'developer' | 'agent' | 'buyer';

const LINKS: Record<Role, { href: string; label: string; icon: string }[]> = {
  developer: [
    { href: '/dashboard/developer', label: 'Dashboard', icon: 'fa-gauge-high' },
    { href: '/dashboard/developer/subscription', label: 'Subscription', icon: 'fa-crown' },
  ],
  agent: [
    { href: '/map', label: 'Live map', icon: 'fa-map-location-dot' },
    { href: '/dashboard/agent/crm', label: 'Leads & CRM', icon: 'fa-address-book' },
    { href: '/dashboard/agent/subscription', label: 'Subscription', icon: 'fa-crown' },
    { href: '/dashboard/agent', label: 'Profile', icon: 'fa-user' },
  ],
  buyer: [
    { href: '/map', label: 'Live map', icon: 'fa-map-location-dot' },
    { href: '/dashboard/buyer/premium', label: 'Premium tools', icon: 'fa-gem' },
    { href: '/dashboard/buyer/subscription', label: 'Subscription', icon: 'fa-crown' },
    { href: '/dashboard/buyer', label: 'Profile', icon: 'fa-user' },
  ],
};

export default function AccountShell({ role, active, title, intro, children, narrow }: { role: Role; active: string; title: string; intro?: string; children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className="sub sub-page">
      <header className="sub-top">
        <a className="sub-brand" href="/" aria-label="Mappingg.com home"><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></a>
        <nav aria-label="Account">
          {LINKS[role].map((l) => (
            <Link key={l.href} href={l.href} className={`sub-btn sm ${active === l.href ? 'primary' : 'ghost'}`} aria-current={active === l.href ? 'page' : undefined}>
              <i className={`fas ${l.icon}`} aria-hidden="true" /> <span className="hide-sm">{l.label}</span>
            </Link>
          ))}
        </nav>
      </header>
      <main className={`sub-wrap${narrow ? ' narrow' : ''}`}>
        <div>
          <h1 style={{ fontSize: 'clamp(22px, 3.6vw, 30px)', letterSpacing: '-.03em' }}>{title}</h1>
          {intro && <p className="sub-muted" style={{ marginTop: 6 }}>{intro}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
