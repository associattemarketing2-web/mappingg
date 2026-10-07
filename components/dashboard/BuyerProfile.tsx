'use client';

import { useEffect, useState } from 'react';
import PhoneInput from '@/components/PhoneInput';
import BuyerCompare from './BuyerCompare';

// Buyers have no dashboard: after signing in they use the live map. This is
// their only other page — "My profile": the projects in their compare list,
// contact details and what they're looking for (which also tells the Mappingg
// team what to suggest).
interface Me { name: string; email: string; mobile: string; profile: Record<string, string>; created_at: string; google: boolean }

const PREF_FIELDS: { key: string; label: string; placeholder: string; options?: string[] }[] = [
  { key: 'area', label: 'Preferred area', placeholder: 'e.g. Mundhwa, Kharadi' },
  { key: 'configuration', label: 'Configuration', placeholder: 'e.g. 2 BHK', options: ['1 BHK', '2 BHK', '3 BHK', '4 BHK', '5+ BHK', 'Plot', 'Commercial'] },
  { key: 'budget', label: 'Budget', placeholder: 'e.g. ₹50 L – ₹1 Cr', options: ['Under ₹50 L', '₹50 L – ₹1 Cr', '₹1 – 2 Cr', '₹2 – 5 Cr', 'Above ₹5 Cr'] },
  { key: 'timeline', label: 'Planning to buy', placeholder: 'e.g. 3–6 months', options: ['Within 3 months', '3–6 months', '6–12 months', 'Just exploring'] },
  { key: 'purpose', label: 'Buying for', placeholder: 'Self use / Investment', options: ['Self use', 'Investment', 'Both'] },
];

export default function BuyerProfile() {
  const [me, setMe] = useState<Me | null>(null);
  const [form, setForm] = useState<{ name: string; mobile: string; profile: Record<string, string> }>({ name: '', mobile: '', profile: {} });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/my/profile', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => {
        if (!b?.data) return;
        setMe(b.data);
        setForm({ name: b.data.name, mobile: b.data.mobile, profile: { ...b.data.profile } });
      })
      .catch(() => setMsg({ text: 'Could not load your profile.', err: true }));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/my/profile', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || 'Could not save');
      setMsg({ text: 'Saved — thanks! We use this to suggest the right projects.' });
    } catch (err) { setMsg({ text: err instanceof Error ? err.message : 'Could not save', err: true }); } finally { setBusy(false); }
  }
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    try { localStorage.removeItem('mpg_map_open'); } catch {}
    window.location.href = '/';
  }

  const initials = (form.name || me?.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  return (
    <div className="bp">
      <header className="bp-top">
        <a className="bp-brand" href="/" aria-label="Mappingg home"><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></a>
        <div className="bp-top-actions">
          <a className="bp-btn primary" href="/map"><i className="fas fa-map-location-dot" /> Open live map</a>
          <button type="button" className="bp-btn ghost" onClick={signOut}><i className="fas fa-right-from-bracket" /> <span className="bp-hide-sm">Sign out</span></button>
        </div>
      </header>

      <main className="bp-main">
        <section className="bp-hero">
          <span className="bp-av" aria-hidden="true">{initials || '?'}</span>
          <div>
            <h1>{me ? `Hi ${(form.name || 'there').split(' ')[0]}` : 'My profile'}</h1>
            <p>{me?.email}{me?.created_at ? ` · Buyer since ${new Date(me.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}` : ''}</p>
          </div>
        </section>

        <a className="bp-map-cta" href="/map">
          <span className="ic"><i className="fas fa-map-location-dot" /></span>
          <span><b>Explore the live map</b><small>Every project with status, RERA, prices and what&apos;s nearby. Tap Enquire on any project for full details.</small></span>
          <i className="fas fa-arrow-right" />
        </a>

        <BuyerCompare />

        <form className="bp-card" onSubmit={save}>
          <h2>Your details</h2>
          {!me ? <p className="bp-muted"><i className="fas fa-spinner fa-spin" /> Loading…</p> : (
            <>
              <div className="bp-grid">
                <label className="bp-field"><span>Full name</span>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={120} />
                </label>
                <div className="bp-field"><span>WhatsApp number</span>
                  <PhoneInput value={form.mobile} onChange={(v) => setForm((f) => ({ ...f, mobile: v }))} />
                </div>
                <label className="bp-field wide"><span>Email <small>(used to sign in)</small></span>
                  <input value={me.email} disabled />
                </label>
              </div>

              <h2>What you&apos;re looking for</h2>
              <div className="bp-grid">
                {PREF_FIELDS.map((f) => (
                  <label key={f.key} className={`bp-field${f.key === 'area' ? ' wide' : ''}`}><span>{f.label}</span>
                    {f.options ? (
                      <select value={form.profile[f.key] || ''} onChange={(e) => setForm((s) => ({ ...s, profile: { ...s.profile, [f.key]: e.target.value } }))}>
                        <option value="">Choose…</option>
                        {[...new Set([...(form.profile[f.key] && !f.options.includes(form.profile[f.key]) ? [form.profile[f.key]] : []), ...f.options])].map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input value={form.profile[f.key] || ''} placeholder={f.placeholder} onChange={(e) => setForm((s) => ({ ...s, profile: { ...s.profile, [f.key]: e.target.value } }))} maxLength={200} />
                    )}
                  </label>
                ))}
              </div>

              {msg && <p className={`bp-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}
              <div className="bp-actions">
                <button type="submit" className="bp-btn primary" disabled={busy}>{busy ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-floppy-disk" /> Save changes</>}</button>
              </div>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
