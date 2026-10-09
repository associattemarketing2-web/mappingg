'use client';

import { useState } from 'react';
import PhoneInput from '@/components/PhoneInput';
import { isValidNumber, splitPhone } from '@/lib/phone';

// Asks a signed-in account for its mobile / WhatsApp number (see
// app/dashboard/add-mobile). On save the server says where to go next.
export default function AddMobileForm({ name, email, google }: { name: string; email: string; google: boolean }) {
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidNumber(splitPhone(mobile).number)) { setErr('Please enter a valid 10-digit mobile number.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/my/mobile', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || 'Could not save your number');
      window.location.href = b.redirect || '/map';
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save your number');
      setBusy(false);
    }
  }
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    try { localStorage.removeItem('mpg_map_open'); } catch {}
    window.location.href = '/';
  }

  return (
    <div className="bp">
      <header className="bp-top">
        <a className="bp-brand" href="/" aria-label="Mappingg home"><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></a>
        <div className="bp-top-actions">
          <button type="button" className="bp-btn ghost" onClick={signOut}><i className="fas fa-right-from-bracket" /> <span className="bp-hide-sm">Sign out</span></button>
        </div>
      </header>

      <main className="bp-main" style={{ maxWidth: 520 }}>
        <form className="bp-card" onSubmit={save}>
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>
            <i className="fas fa-mobile-screen-button" style={{ color: 'var(--bp-forest)' }} /> Add your mobile number
          </h2>
          <p className="bp-muted" style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5 }}>
            {google ? 'You signed in with Google. ' : ''}Hi{name ? ` ${name.split(' ')[0]}` : ''}, one last step: add your
            WhatsApp / mobile number so our team can share project details and reach you about your enquiries.
          </p>
          <div className="bp-grid">
            <label className="bp-field wide"><span>Email <small>(used to sign in)</small></span>
              <input value={email} disabled />
            </label>
            <div className="bp-field wide"><span>Mobile / WhatsApp number</span>
              <PhoneInput value={mobile} onChange={(v) => { setMobile(v); setErr(''); }} required />
            </div>
          </div>
          {err && <p className="bp-msg err" role="alert">{err}</p>}
          <div className="bp-actions">
            <button type="submit" className="bp-btn primary" disabled={busy}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-check" /> Save &amp; continue</>}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
