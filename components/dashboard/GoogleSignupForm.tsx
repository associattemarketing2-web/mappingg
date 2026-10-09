'use client';

import { useState } from 'react';
import PhoneInput from '@/components/PhoneInput';
import { isValidNumber, splitPhone } from '@/lib/phone';

// The full sign-up form for a first-time Google sign-in (see
// app/dashboard/complete-signup). Same account types, fields and options as the
// sign-up form on the home page (components/landing/body.ts); every field is
// required except a developer's website. The account is created on submit.
type Role = 'buyer' | 'developer' | 'agent';
type Field = { key: string; label: string; placeholder?: string; options?: string[]; pills?: string[]; optional?: boolean; wide?: boolean };

const ROLES: { key: Role; label: string; icon: string }[] = [
  { key: 'buyer', label: 'Buyer / Investor', icon: 'fa-house-chimney' },
  { key: 'developer', label: 'Developer / Builder', icon: 'fa-building' },
  { key: 'agent', label: 'Agent / Broker / Channel Partner', icon: 'fa-handshake' },
];

const FIELDS: Record<Role, { title: string; hint?: string; fields: Field[] }> = {
  buyer: {
    title: "Tell us what you're looking for", hint: 'Helps us match you to the right projects',
    fields: [
      { key: 'area', label: 'Preferred area', placeholder: 'e.g. Mundhwa, Kharadi' },
      { key: 'configuration', label: 'Configuration', options: ['1 BHK', '2 BHK', '3 BHK', '4+ BHK', 'Plot / Villa'] },
      { key: 'budget', label: 'Budget', options: ['Under 1 Cr', '75L - 1.5 Cr', '1.5Cr - 2.5 Cr', '3Cr +'] },
      { key: 'timeline', label: 'Planning to buy', options: ['Within 3 months', '3–6 months', '6–12 months', 'Just exploring'] },
      { key: 'purpose', label: 'Buying for', pills: ['Self use', 'Investment', 'Both'], wide: true },
    ],
  },
  developer: {
    title: 'Company details',
    fields: [
      { key: 'company', label: 'Company / developer name', placeholder: 'e.g. ABC Developers Pvt Ltd', wide: true },
      { key: 'designation', label: 'Your role', options: ['Owner / Director', 'Sales head', 'Marketing head', 'Other'] },
      { key: 'activeProjects', label: 'Active projects', options: ['1', '2–5', '6–10', '10+'] },
      { key: 'reraProject', label: 'A MahaRERA project no.', placeholder: 'P52100012345' },
      { key: 'website', label: 'Website', placeholder: 'https://', optional: true },
    ],
  },
  agent: {
    title: 'Agency details',
    fields: [
      { key: 'agency', label: 'Agency / firm name (or “Individual”)', placeholder: 'e.g. Prime Realty Advisors', wide: true },
      { key: 'reraAgent', label: 'MahaRERA agent no.', placeholder: 'A5XXXXXXXXXX' },
      { key: 'areas', label: 'Areas you work in', placeholder: 'Mundhwa, Kharadi' },
    ],
  },
};

export default function GoogleSignupForm({ name: googleName, email, initialRole }: { name: string; email: string; initialRole: Role }) {
  const [role, setRole] = useState<Role>(initialRole);
  const [name, setName] = useState(googleName);
  const [mobile, setMobile] = useState('');
  const [profile, setProfile] = useState<Record<Role, Record<string, string>>>({ buyer: {}, developer: {}, agent: {} });
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const group = FIELDS[role];
  const values = profile[role];
  const set = (k: string, v: string) => { setProfile((p) => ({ ...p, [role]: { ...p[role], [k]: v } })); setErr(''); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Please enter your full name.'); return; }
    if (!isValidNumber(splitPhone(mobile).number)) { setErr('Please enter a valid 10-digit WhatsApp number.'); return; }
    const missing = group.fields.find((f) => !f.optional && !(values[f.key] || '').trim());
    if (missing) { setErr(`Please fill in “${missing.label}”.`); return; }
    if ((role === 'developer' && (values.reraProject || '').trim().length < 4) || (role === 'agent' && (values.reraAgent || '').trim().length < 4)) {
      setErr('Please enter a valid MahaRERA number.'); return;
    }
    if (!terms) { setErr('Please accept the Terms & Privacy to continue.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { role, name: name.trim(), mobile, terms: true, profile: Object.fromEntries(group.fields.map((f) => [f.key, (values[f.key] || '').trim()])) };
      const r = await fetch('/api/auth/google/complete', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (b?.error?.code === 'expired' || b?.error?.code === 'exists') { window.location.href = '/?signin=1'; return; }
        throw new Error(b?.error?.message || 'Could not create your account');
      }
      window.location.href = b.redirect || '/map';
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not create your account');
      setBusy(false);
    }
  }

  return (
    <div className="bp">
      <header className="bp-top">
        <a className="bp-brand" href="/" aria-label="Mappingg home"><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></a>
      </header>

      <main className="bp-main" style={{ maxWidth: 640 }}>
        <form className="bp-card" onSubmit={submit} noValidate>
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>
            <i className="fab fa-google" style={{ color: 'var(--bp-forest)' }} /> Complete your sign-up
          </h2>
          <p className="bp-muted" style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5 }}>
            Hi{googleName ? ` ${googleName.split(' ')[0]}` : ''}, you signed in with Google. Fill in your details to create your account.
            <br /><small>* All fields are required</small>
          </p>

          <div className="bp-field wide" style={{ marginBottom: 16 }}>
            <span>I am a</span>
            <div className="gs-roles" role="radiogroup" aria-label="Account type">
              {ROLES.map((r) => (
                <button key={r.key} type="button" role="radio" aria-checked={role === r.key} className={`gs-role${role === r.key ? ' on' : ''}`} onClick={() => { setRole(r.key); setErr(''); }}>
                  <i className={`fas ${r.icon}`} /> {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bp-grid">
            <label className="bp-field"><span>Full name</span>
              <input value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="Your name" autoComplete="name" required />
            </label>
            <div className="bp-field"><span>WhatsApp number</span>
              <PhoneInput value={mobile} onChange={(v) => { setMobile(v); setErr(''); }} required />
            </div>
            <label className="bp-field wide"><span>Email <small>(from Google, used to sign in)</small></span>
              <input value={email} disabled />
            </label>
          </div>

          <h3 style={{ fontSize: 15, margin: '20px 0 4px' }}>{group.title}</h3>
          {group.hint && <p className="bp-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>{group.hint}</p>}
          <div className="bp-grid">
            {group.fields.map((f) => (
              f.pills ? (
                <div key={f.key} className={`bp-field${f.wide ? ' wide' : ''}`}><span>{f.label}</span>
                  <div className="gs-roles" role="radiogroup" aria-label={f.label}>
                    {f.pills.map((o) => (
                      <button key={o} type="button" role="radio" aria-checked={values[f.key] === o} className={`gs-role${values[f.key] === o ? ' on' : ''}`} onClick={() => set(f.key, o)}>{o}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <label key={f.key} className={`bp-field${f.wide ? ' wide' : ''}`}>
                  <span>{f.label}{f.optional && <small> (optional)</small>}</span>
                  {f.options ? (
                    <select value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} required>
                      <option value="" disabled>Select…</option>
                      {f.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} required={!f.optional} type={f.key === 'website' ? 'url' : 'text'} />
                  )}
                </label>
              )
            ))}
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, fontSize: 13.5 }}>
            <input type="checkbox" checked={terms} onChange={(e) => { setTerms(e.target.checked); setErr(''); }} style={{ marginTop: 3 }} />
            <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> &amp; <a href="/privacy" target="_blank" rel="noopener">Privacy</a> and to be contacted on WhatsApp.</span>
          </label>

          {err && <p className="bp-msg err" role="alert">{err}</p>}
          <div className="bp-actions">
            <button type="submit" className="bp-btn primary" disabled={busy}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Creating account…</> : <><i className="fas fa-check" /> Create account</>}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
