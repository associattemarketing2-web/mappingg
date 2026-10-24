'use client';

import { useState } from 'react';
import PhoneInput from './PhoneInput';
import { PHONE_ERROR, isValidNumber, splitPhone } from '@/lib/phone';
import { WHATSAPP_URL } from '@/lib/contact';
import { CONSENT_FORMS } from '@/lib/consent';
import { REQ_BHK, REQ_BUDGETS, REQ_CITIES, REQ_PURPOSES, REQ_TIMELINES } from '@/lib/buyer-requirement';

// Public Buyer Requirement form → /api/buyer-requirement → Leads / Buyer leads.
// The contact-consent box is required and starts unticked; the call / WhatsApp
// marketing opt-ins are separate and optional. Wording comes from lib/consent.ts,
// the same text that is stored with the lead.

const TEXT = CONSENT_FORMS.requirement.text;
const EMPTY = {
  name: '', phone: '', email: '', city: '', areas: '', bhk: '', budget: '', timeline: '', purpose: '', notes: '', company: '',
  consent: false, consent_call: false, consent_whatsapp: false,
};

export default function BuyerRequirementForm() {
  const [f, setF] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (f.name.trim().length < 2) return setError('Please add your name.');
    if (!f.city) return setError('Choose a city.');
    if (f.areas.trim().length < 2) return setError('Tell us which areas you prefer.');
    if (!f.bhk) return setError('Choose the home size.');
    if (!f.budget) return setError('Choose a budget.');
    if (!f.timeline) return setError('Choose when you plan to buy.');
    if (!f.phone.trim() && !f.email.trim()) return setError('Add a mobile number or email so we can reach you.');
    if (splitPhone(f.phone).number && !isValidNumber(splitPhone(f.phone).number)) return setError(PHONE_ERROR);
    if (!f.consent) return setError('Please tick the box to let us contact you about this requirement.');
    setSending(true);
    try {
      const res = await fetch('/api/buyer-requirement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error?.message || 'Something went wrong.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="cf-card cf-done">
        <span className="ic"><i className="fas fa-circle-check" aria-hidden="true" /></span>
        <h3>Thanks, {f.name.trim().split(' ')[0]}! We have your requirement.</h3>
        <p>Our team will look for {f.bhk} homes in {f.areas.trim()} and get back to you.</p>
        <div className="cf-done-actions">
          <a href="/map" className="btn btn-primary"><i className="fas fa-map-location-dot" aria-hidden="true" /> Explore the live map</a>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener" className="btn btn-outline"><i className="fab fa-whatsapp" aria-hidden="true" /> Chat on WhatsApp</a>
        </div>
      </div>
    );
  }

  const chips = (k: 'city' | 'bhk' | 'purpose', list: readonly string[]) => (
    <div className="cf-chips">
      {list.map((v) => (
        <button type="button" key={v} aria-pressed={f[k] === v} className={`cf-chip${f[k] === v ? ' on' : ''}`} onClick={() => set(k, f[k] === v ? '' : v)}>{v}</button>
      ))}
    </div>
  );

  return (
    <form className="cf-card" onSubmit={submit} noValidate>
      <div className="cf-head">
        <span className="cf-head-ic"><i className="fas fa-clipboard-list" aria-hidden="true" /></span>
        <div>
          <h3>Your home requirement</h3>
          <p>Takes a minute. We only use it to find homes for you.</p>
        </div>
      </div>

      {error ? <div className="ipg-form-err" role="alert">{error}</div> : null}

      <fieldset className="cf-block cf-needs">
        <legend><i className="fas fa-house-chimney" aria-hidden="true" /> What are you looking for?</legend>
        <div className="cf-grid">
          <div className="fld wide">
            <span className="lbl">City <span className="req">*</span></span>
            {chips('city', REQ_CITIES)}
          </div>
          <div className="fld wide">
            <label htmlFor="br-areas">Preferred areas <span className="req">*</span></label>
            <div className="cf-input"><i className="fas fa-location-dot" aria-hidden="true" />
              <input id="br-areas" value={f.areas} onChange={(e) => set('areas', e.target.value)} placeholder="e.g. Kharadi, Viman Nagar" maxLength={200} />
            </div>
          </div>
          <div className="fld wide">
            <span className="lbl">Home size <span className="req">*</span></span>
            {chips('bhk', REQ_BHK)}
          </div>
          <div className="fld">
            <label htmlFor="br-budget">Budget <span className="req">*</span></label>
            <select id="br-budget" value={f.budget} onChange={(e) => set('budget', e.target.value)}>
              <option value="">Select budget</option>
              {REQ_BUDGETS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="br-timeline">When do you plan to buy? <span className="req">*</span></label>
            <select id="br-timeline" value={f.timeline} onChange={(e) => set('timeline', e.target.value)}>
              <option value="">Select timeline</option>
              {REQ_TIMELINES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="fld wide">
            <span className="lbl">Buying for <span className="opt">optional</span></span>
            {chips('purpose', REQ_PURPOSES)}
          </div>
        </div>
      </fieldset>

      <div className="cf-grid">
        <div className="fld">
          <label htmlFor="br-name">Your name <span className="req">*</span></label>
          <div className="cf-input"><i className="fas fa-user" aria-hidden="true" />
            <input id="br-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" autoComplete="name" maxLength={120} />
          </div>
        </div>
        <div className="fld">
          <label htmlFor="br-phone">Mobile / WhatsApp</label>
          <PhoneInput id="br-phone" value={f.phone} onChange={(v) => set('phone', v)} />
        </div>
        <div className="fld wide">
          <label htmlFor="br-email">Email</label>
          <div className="cf-input"><i className="fas fa-envelope" aria-hidden="true" />
            <input id="br-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" autoComplete="email" maxLength={200} />
          </div>
          <span className="cf-hint">Add a mobile number or an email (or both).</span>
        </div>
      </div>

      <div className="fld cf-msg">
        <label htmlFor="br-notes">Anything else? <span className="opt">optional</span></label>
        <textarea id="br-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} placeholder="e.g. near a school, east-facing, ready to move…" />
      </div>

      <input className="ipg-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.company} onChange={(e) => set('company', e.target.value)} name="company" placeholder="Company" />

      <div className="cf-consent">
        <label className="cf-check">
          <input type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} required />
          <span>{TEXT.enquiry} <span className="req">*</span></span>
        </label>
        <label className="cf-check">
          <input type="checkbox" checked={f.consent_call} onChange={(e) => set('consent_call', e.target.checked)} />
          <span>{TEXT.call} <span className="opt">optional</span></span>
        </label>
        <label className="cf-check">
          <input type="checkbox" checked={f.consent_whatsapp} onChange={(e) => set('consent_whatsapp', e.target.checked)} />
          <span>{TEXT.whatsapp} <span className="opt">optional</span></span>
        </label>
        <p className="cf-fine">You can ask us to stop contacting you at any time. See our <a href="/privacy">Privacy Policy</a>.</p>
      </div>

      <button className="btn btn-primary cf-submit" type="submit" disabled={sending}>
        {sending ? <><i className="fas fa-spinner fa-spin" aria-hidden="true" /> Sending…</> : <><i className="fas fa-paper-plane" aria-hidden="true" /> Send my requirement</>}
      </button>
    </form>
  );
}
