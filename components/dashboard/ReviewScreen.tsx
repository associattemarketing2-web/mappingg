import Link from 'next/link';
import SignOutButton from './SignOutButton';

// Shown to developer / agent accounts until the super admin approves them.
// It only echoes back what they submitted — no project data is loaded.
export interface ReviewAccount {
  name: string;
  email: string;
  mobile: string;
  role: 'developer' | 'agent';
  status: 'pending' | 'rejected';
  note: string;
  created_at: string;
  profile: Record<string, string>;
}

const ROLE = {
  developer: { label: 'Developer / Builder', icon: 'fa-building' },
  agent: { label: 'Agent / Broker / Channel Partner', icon: 'fa-handshake' },
} as const;
const FIELDS: Record<ReviewAccount['role'], [string, string][]> = {
  developer: [['company', 'Company'], ['designation', 'Your role'], ['activeProjects', 'Active projects'], ['reraProject', 'MahaRERA project no.'], ['website', 'Website']],
  agent: [['agency', 'Agency / firm'], ['reraAgent', 'MahaRERA agent no.'], ['areas', 'Areas you work in']],
};

export default function ReviewScreen({ account }: { account: ReviewAccount }) {
  const meta = ROLE[account.role];
  const rejected = account.status === 'rejected';
  const firstName = account.name.split(' ')[0] || 'there';
  const submitted = account.created_at
    ? new Date(account.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <div className="dsh">
      <header className="dsh-top">
        <Link href="/" className="dsh-brand">
          <span className="mark" aria-hidden="true" />
          <span><b>Mappingg<em>.com</em></b><small>{rejected ? 'Application not approved' : 'Under review'}</small></span>
        </Link>
        <div className="dsh-top-right"><SignOutButton /></div>
      </header>

      <main className="dsh-content dsh-review">
        <section className={`dsh-review-card${rejected ? ' is-rejected' : ''}`}>
          <div className="dsh-review-icon"><i className={`fas ${rejected ? 'fa-circle-xmark' : 'fa-hourglass-half'}`} /></div>
          <span className="dsh-role"><i className={`fas ${meta.icon}`} /> {meta.label}</span>
          {rejected ? (
            <>
              <h1>We couldn&apos;t verify your account</h1>
              <p>Sorry {firstName} — our team wasn&apos;t able to approve this {account.role === 'developer' ? 'developer' : 'partner'} account.</p>
              {account.note && <div className="dsh-review-reason"><b>Reason</b><span>{account.note}</span></div>}
              <p className="dsh-review-small">If something was entered incorrectly, contact us and we&apos;ll review it again.</p>
            </>
          ) : (
            <>
              <h1>Thanks, {firstName} — your account is being verified</h1>
              <p>Our team is checking your details{account.role === 'developer' ? ' and MahaRERA project number' : ' and MahaRERA agent number'}. This usually takes one working day. Your dashboard unlocks as soon as you&apos;re approved.</p>
              <ol className="dsh-steps">
                <li className="done"><i className="fas fa-check" /> Account created{submitted ? ` · ${submitted}` : ''}</li>
                <li className="now"><i className="fas fa-magnifying-glass" /> Details checked by our team</li>
                <li><i className="fas fa-unlock" /> Dashboard unlocked</li>
              </ol>
            </>
          )}
          <div className="dsh-review-actions">
            <Link href="/map" className="dsh-btn primary"><i className="fas fa-map-location-dot" /> Browse the live map</Link>
            <Link href="/contact" className="dsh-btn ghost"><i className="fas fa-headset" /> Contact us</Link>
          </div>
        </section>

        <section className="dsh-card">
          <h2><i className="fas fa-file-lines" /> Details you submitted</h2>
          <div className="dsh-field"><span>Name</span><b>{account.name || '—'}</b></div>
          <div className="dsh-field"><span>Email</span><b>{account.email}</b></div>
          <div className="dsh-field"><span>WhatsApp</span><b>{account.mobile || '—'}</b></div>
          {FIELDS[account.role].map(([k, label]) => (
            <div className="dsh-field" key={k}><span>{label}</span><b>{account.profile[k] || '—'}</b></div>
          ))}
        </section>
      </main>
    </div>
  );
}
