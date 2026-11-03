'use client';

import { useState } from 'react';

// The form on /delete-account. Signed-in accounts with a password are deleted
// at once (POST /api/my/account/delete). Everyone else, including people who
// can't sign in or don't have the app, sends a deletion request to the team
// through the contact form API.

export type DeleteAccountState = 'signed-out' | 'staff' | 'password' | 'no-password';

type Props = { state: DeleteAccountState; email?: string; name?: string };

export default function DeleteAccountForm({ state, email = '', name = '' }: Props) {
  const [mode, setMode] = useState<DeleteAccountState>(state);
  if (mode === 'staff') {
    return (
      <div className="cf-card">
        <div className="cf-head">
          <span className="cf-head-ic"><i className="fas fa-user-shield" aria-hidden="true" /></span>
          <div>
            <h3>This is a team account</h3>
            <p>Team accounts are managed by the Mappingg owner. Please ask them to remove it.</p>
          </div>
        </div>
      </div>
    );
  }
  if (mode === 'password') return <InstantDelete email={email} onNeedsRequest={() => setMode('no-password')} />;
  return <DeletionRequest signedIn={mode === 'no-password'} email={email} name={name} />;
}

function InstantDelete({ email, onNeedsRequest }: { email: string; onNeedsRequest: () => void }) {
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!password) return setError('Enter your password to confirm.');
    if (!understood) return setError('Please tick the box to confirm you understand.');
    if (!window.confirm('Delete your Mappingg account permanently? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/my/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirm: 'DELETE' }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok) return setDone(true);
      const code = out?.error?.code;
      if (code === 'no_password') return onNeedsRequest();
      if (res.status === 401) return setError('Your session has ended. Please sign in again, then come back to this page.');
      setError(out?.error?.message || 'Something went wrong. Please try again.');
    } catch {
      setError('Could not reach Mappingg. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="cf-card cf-done">
        <span className="ic"><i className="fas fa-circle-check" aria-hidden="true" /></span>
        <h3>Your account has been deleted</h3>
        <p>You have been signed out everywhere. We have sent a confirmation to {email || 'your email'}.</p>
        <div className="cf-done-actions">
          <a href="/" className="btn btn-primary"><i className="fas fa-house" aria-hidden="true" /> Back to Mappingg</a>
        </div>
      </div>
    );
  }

  return (
    <form className="cf-card" onSubmit={submit} noValidate>
      <div className="cf-head">
        <span className="cf-head-ic da-danger"><i className="fas fa-user-xmark" aria-hidden="true" /></span>
        <div>
          <h3>Delete my account</h3>
          <p>Signed in as <b>{email}</b></p>
        </div>
      </div>

      {error ? <div className="ipg-form-err" role="alert">{error}</div> : null}

      <div className="cf-grid">
        <div className="fld wide">
          <label htmlFor="da-password">Your password <span className="req">*</span></label>
          <div className="cf-input"><i className="fas fa-lock" aria-hidden="true" />
            <input id="da-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <span className="cf-hint">We ask for it again so no one else can delete your account.</span>
        </div>
      </div>

      <label className="cf-check da-check">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span>I understand my account will be deleted permanently and can&apos;t be restored.</span>
      </label>

      <button className="btn btn-primary cf-submit da-submit" type="submit" disabled={busy}>
        {busy ? <><i className="fas fa-spinner fa-spin" aria-hidden="true" /> Deleting…</> : <><i className="fas fa-trash-can" aria-hidden="true" /> Delete my account permanently</>}
      </button>
    </form>
  );
}

function DeletionRequest({ signedIn, email: accountEmail, name: accountName }: { signedIn: boolean; email: string; name: string }) {
  const [f, setF] = useState({ name: accountName, email: accountEmail, phone: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!f.name.trim()) return setError('Please enter your name.');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setError('Enter the email address of your Mappingg account.');
    setBusy(true);
    try {
      const message = [
        'Please delete my Mappingg account and its personal data.',
        `Account email: ${f.email.trim()}`,
        f.phone.trim() ? `Account phone: ${f.phone.trim()}` : '',
        f.reason.trim() ? `Reason: ${f.reason.trim()}` : '',
        signedIn ? 'Sent while signed in (account without a password).' : 'Sent from the public deletion page (not signed in).',
      ].filter(Boolean).join('\n');
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), subject: 'Account deletion request', message }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error?.message || 'Something went wrong. Please try again.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="cf-card cf-done">
        <span className="ic"><i className="fas fa-circle-check" aria-hidden="true" /></span>
        <h3>Request received</h3>
        <p>We will confirm it with you at {f.email.trim()} and delete the account within 30 days.</p>
        <div className="cf-done-actions">
          <a href="/" className="btn btn-primary"><i className="fas fa-house" aria-hidden="true" /> Back to Mappingg</a>
        </div>
      </div>
    );
  }

  return (
    <form className="cf-card" onSubmit={submit} noValidate>
      <div className="cf-head">
        <span className="cf-head-ic da-danger"><i className="fas fa-user-xmark" aria-hidden="true" /></span>
        <div>
          <h3>Request account deletion</h3>
          <p>{signedIn
            ? 'Your account signs in with Google or a WhatsApp code, so our team deletes it for you.'
            : 'No app or sign-in needed. Use the email of your Mappingg account.'}</p>
        </div>
      </div>

      {!signedIn ? (
        <p className="da-signin">
          Have your password? <a href="/?signin=1">Sign in</a> and come back to this page to delete your account instantly.
        </p>
      ) : null}

      {error ? <div className="ipg-form-err" role="alert">{error}</div> : null}

      <div className="cf-grid">
        <div className="fld">
          <label htmlFor="da-name">Your name <span className="req">*</span></label>
          <div className="cf-input"><i className="fas fa-user" aria-hidden="true" />
            <input id="da-name" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" required />
          </div>
        </div>
        <div className="fld">
          <label htmlFor="da-phone">Phone / WhatsApp <span className="opt">Optional</span></label>
          <div className="cf-input"><i className="fas fa-phone" aria-hidden="true" />
            <input id="da-phone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" autoComplete="tel" />
          </div>
        </div>
        <div className="fld wide">
          <label htmlFor="da-email">Account email <span className="req">*</span></label>
          <div className="cf-input"><i className="fas fa-envelope" aria-hidden="true" />
            <input id="da-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" autoComplete="email" required readOnly={signedIn && !!accountEmail} />
          </div>
        </div>
        <div className="fld wide">
          <label htmlFor="da-reason">Reason <span className="opt">Optional</span></label>
          <textarea id="da-reason" value={f.reason} onChange={(e) => set('reason', e.target.value)} maxLength={1000} rows={3} />
        </div>
      </div>

      <button className="btn btn-primary cf-submit da-submit" type="submit" disabled={busy}>
        {busy ? <><i className="fas fa-spinner fa-spin" aria-hidden="true" /> Sending…</> : <><i className="fas fa-paper-plane" aria-hidden="true" /> Send deletion request</>}
      </button>
    </form>
  );
}
