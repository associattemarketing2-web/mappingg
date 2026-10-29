'use client';

import { useEffect, useState } from 'react';
import PhoneInput from './PhoneInput';
import { PHONE_ERROR, isValidNumber, splitPhone } from '@/lib/phone';
import { WHATSAPP_URL } from '@/lib/contact';

// Public lead-capture form. Submissions post to /api/contact and appear in the
// s-admin CRM (Leads tab). Home buyers also tell us city, locality, budget, BHK
// and timeline. The call / WhatsApp opt-ins are separate and unticked; their
// wording must match CONSENT_TEXT in app/api/contact/route.ts.

const TOPICS = [
  { value: 'Project enquiry', label: 'Buying a home', icon: 'fas fa-house-chimney' },
  { value: 'List my project', label: 'List my project', icon: 'fas fa-building' },
  { value: 'Channel partner', label: 'Channel partner', icon: 'fas fa-handshake' },
  { value: 'Correction', label: 'Correction', icon: 'fas fa-pen-to-square' },
  { value: 'Something else', label: 'Something else', icon: 'fas fa-comment-dots' },
];
const CITIES = ['Pune', 'Mumbai & MMR'];
const BUDGETS = ['Under ₹1 Cr', '₹1 – 2 Cr', '₹2 – 3 Cr', '₹3 Cr +'];
const BHKS = ['1 BHK', '2 BHK', '3 BHK', '4+ BHK'];
const TIMELINES = ['Within 3 months', '3–6 months', '6–12 months', 'Just exploring'];
const PLACEHOLDER: Record<string, string> = {
  'Project enquiry': 'Anything else? e.g. a project you liked, or a question about a locality.',
  'List my project': 'Project name, location and MahaRERA number.',
  'Channel partner': 'Your name or firm and MahaRERA agent number.',
  Correction: 'Which project, and what needs fixing?',
  'Something else': 'How can we help?',
};

const EMPTY = {
  name: '', email: '', phone: '', subject: TOPICS[0].value, message: '', company: '',
  city: '', locality: '', budget: '', bhk: '', timeline: '', consent_call: false, consent_whatsapp: false,
  // Set from /contact?project=<name>&pin=<number> ("Enquire" on a project page or card).
  project: '', project_number: '',
};

export default function ContactForm() {
  const [f, setF] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((p) => ({ ...p, [k]: v }));
  const buying = f.subject === 'Project enquiry';
  const hasNeeds = buying && !!(f.city || f.locality || f.budget || f.bhk || f.timeline);

  // Which project the visitor came from, so the lead is linked to it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const project = (q.get('project') || '').trim().slice(0, 200);
    const pin = /^d{1,7}$/.test(q.get('pin') || '') ? (q.get('pin') as string) : '';
    if (project) setF((p) => ({ ...p, subject: 'Project enquiry', project, project_number: pin }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!f.name.trim()) return setError('Please add your name.');
    if (!f.message.trim() && !hasNeeds && !f.project) return setError(buying ? 'Tell us what you’re looking for, or add a message.' : 'Please add a message.');
    if (!f.email.trim() && !f.phone.trim()) return setError('Add a phone number or email so we can reply.');
    if (splitPhone(f.phone).number && !isValidNumber(splitPhone(f.phone).number)) return setError(PHONE_ERROR);
    setSending(true);
    try {
      // Buyer details are only sent for the "Buying a home" topic.
      const body = buying ? f : { ...f, city: '', locality: '', budget: '', bhk: '', timeline: '', project: '', project_number: '' };
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
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
        <h3>Thank you, {f.name.trim().split(' ')[0]}! We&apos;ve got your message.</h3>
        <p>Our team will get back to you shortly at the contact details you shared.</p>
        <div className="cf-done-actions">
          <a href="/map" className="btn btn-primary"><i className="fas fa-map-location-dot" aria-hidden="true" /> Explore the live map</a>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener" className="btn btn-outline"><i className="fab fa-whatsapp" aria-hidden="true" /> Chat on WhatsApp</a>
        </div>
      </div>
    );
  }

  return (
    <form className="cf-card" onSubmit={submit} noValidate>
      <div className="cf-head">
        <span className="cf-head-ic"><i className="fas fa-paper-plane" aria-hidden="true" /></span>
        <div>
          <h3>Send us a message</h3>
          <p>Your message goes straight to the Mappingg team.</p>
        </div>
      </div>

      {error ? <div className="ipg-form-err" role="alert">{error}</div> : null}

      {buying && f.project ? (
        <p className="cf-project">
          <i className="fas fa-building" aria-hidden="true" /> <span>Enquiry about <b>{f.project}</b></span>
          <button type="button" onClick={() => setF((p) => ({ ...p, project: '', project_number: '' }))} aria-label={`Remove ${f.project} from this enquiry`}>
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </p>
      ) : null}

      <fieldset className="cf-block">
        <legend>What can we help with?</legend>
        <div className="cf-topics" role="radiogroup">
          {TOPICS.map((t) => (
            <button
              type="button" key={t.value} role="radio" aria-checked={f.subject === t.value}
              className={`cf-topic${f.subject === t.value ? ' on' : ''}`} onClick={() => set('subject', t.value)}
            >
              <i className={t.icon} aria-hidden="true" /> {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="cf-grid">
        <div className="fld">
          <label htmlFor="cf-name">Your name <span className="req">*</span></label>
          <div className="cf-input"><i className="fas fa-user" aria-hidden="true" />
            <input id="cf-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" autoComplete="name" required />
          </div>
        </div>
        <div className="fld">
          <label htmlFor="cf-phone">Phone / WhatsApp</label>
          <PhoneInput id="cf-phone" value={f.phone} onChange={(v) => set('phone', v)} />
        </div>
        <div className="fld wide">
          <label htmlFor="cf-email">Email</label>
          <div className="cf-input"><i className="fas fa-envelope" aria-hidden="true" />
            <input id="cf-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>
          <span className="cf-hint">Add a phone number or an email (or both) so we can reply.</span>
        </div>
      </div>

      {buying ? (
        <fieldset className="cf-block cf-needs">
          <legend><i className="fas fa-house-chimney" aria-hidden="true" /> What are you looking for? <span className="opt">Optional, helps us suggest the right projects</span></legend>
          <div className="cf-grid">
            <div className="fld">
              <span className="lbl">City</span>
              <div className="cf-chips">
                {CITIES.map((c) => (
                  <button type="button" key={c} aria-pressed={f.city === c} className={`cf-chip${f.city === c ? ' on' : ''}`} onClick={() => set('city', f.city === c ? '' : c)}>{c}</button>
                ))}
              </div>
            </div>
            <div className="fld">
              <label htmlFor="cf-locality">Preferred locality</label>
              <div className="cf-input"><i className="fas fa-location-dot" aria-hidden="true" />
                <input id="cf-locality" value={f.locality} onChange={(e) => set('locality', e.target.value)} placeholder="e.g. Kharadi, Baner, Thane" />
              </div>
            </div>
            <div className="fld wide">
              <span className="lbl">Size</span>
              <div className="cf-chips">
                {BHKS.map((b) => (
                  <button type="button" key={b} aria-pressed={f.bhk === b} className={`cf-chip${f.bhk === b ? ' on' : ''}`} onClick={() => set('bhk', f.bhk === b ? '' : b)}>{b}</button>
                ))}
              </div>
            </div>
            <div className="fld">
              <label htmlFor="cf-budget">Budget</label>
              <select id="cf-budget" value={f.budget} onChange={(e) => set('budget', e.target.value)}>
                <option value="">Select budget</option>
                {BUDGETS.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div className="fld">
              <label htmlFor="cf-timeline">When do you plan to buy?</label>
              <select id="cf-timeline" value={f.timeline} onChange={(e) => set('timeline', e.target.value)}>
                <option value="">Select timeline</option>
                {TIMELINES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </fieldset>
      ) : null}

      <div className="fld cf-msg">
        <label htmlFor="cf-message">Message {buying ? <span className="opt">optional</span> : <span className="req">*</span>}</label>
        <textarea id="cf-message" rows={4} value={f.message} onChange={(e) => set('message', e.target.value)} placeholder={PLACEHOLDER[f.subject]} />
      </div>

      {/* Honeypot (hidden from humans) */}
      <input
        className="ipg-hp" tabIndex={-1} autoComplete="off" aria-hidden="true"
        value={f.company} onChange={(e) => set('company', e.target.value)}
        name="company" placeholder="Company"
      />

      <div className="cf-consent">
        <label className="cf-check">
          <input type="checkbox" checked={f.consent_call} onChange={(e) => set('consent_call', e.target.checked)} />
          <span>Associatte PropTech (Mappingg) may <b>call</b> me about matching projects.</span>
        </label>
        <label className="cf-check">
          <input type="checkbox" checked={f.consent_whatsapp} onChange={(e) => set('consent_whatsapp', e.target.checked)} />
          <span>Associatte PropTech (Mappingg) may message me on <b>WhatsApp</b> about matching projects.</span>
        </label>
        <p className="cf-fine">Both are optional. We&apos;ll reply to this enquiry either way, and you can opt out any time. See our <a href="/privacy">Privacy Policy</a>.</p>
      </div>

      <button className="btn btn-primary cf-submit" type="submit" disabled={sending}>
        {sending ? <><i className="fas fa-spinner fa-spin" aria-hidden="true" /> Sending…</> : <><i className="fas fa-paper-plane" aria-hidden="true" /> Send message</>}
      </button>

      <ul className="cf-trust">
        <li><i className="fas fa-shield-halved" aria-hidden="true" /> No spam</li>
        <li><i className="fas fa-certificate" aria-hidden="true" /> MahaRERA numbers checked</li>
        <li><i className="fas fa-user-check" aria-hidden="true" /> A real person replies</li>
      </ul>
    </form>
  );
}
