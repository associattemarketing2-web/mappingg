'use client';

import { useState } from 'react';

const SUBJECTS = ['Project enquiry', 'List my project', 'Channel partner', 'Correction', 'Something else'];

// Public lead-capture form. Submissions post to /api/contact and appear in the
// s-admin CRM (Leads tab).
export default function ContactForm() {
  const [f, setF] = useState({ name: '', email: '', phone: '', subject: SUBJECTS[0], message: '', company: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!f.name.trim() || !f.message.trim()) return setError('Please add your name and a message.');
    if (!f.email.trim() && !f.phone.trim()) return setError('Add an email or phone so we can reply.');
    setSending(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || 'Something went wrong.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="ipg-form-done">
        <span className="ic"><i className="fas fa-circle-check" aria-hidden="true" /></span>
        <h3>Thank you — we&apos;ve got your message.</h3>
        <p>Our team will get back to you shortly at the contact details you shared.</p>
      </div>
    );
  }

  return (
    <form className="ipg-form" onSubmit={submit} noValidate>
      {error ? <div className="ipg-form-err" role="alert">{error}</div> : null}
      <div className="ipg-form-grid">
        <div className="fld">
          <label htmlFor="cf-name">Your name *</label>
          <input id="cf-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" required />
        </div>
        <div className="fld">
          <label htmlFor="cf-subject">Topic</label>
          <select id="cf-subject" value={f.subject} onChange={(e) => set('subject', e.target.value)}>
            {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="fld">
          <label htmlFor="cf-email">Email</label>
          <input id="cf-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div className="fld">
          <label htmlFor="cf-phone">Phone / WhatsApp</label>
          <input id="cf-phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98xxxxxxxx" autoComplete="tel" />
        </div>
        <div className="fld wide">
          <label htmlFor="cf-message">Message *</label>
          <textarea id="cf-message" rows={5} value={f.message} onChange={(e) => set('message', e.target.value)} placeholder="How can we help?" required />
        </div>
      </div>
      {/* Honeypot (hidden from humans) */}
      <input
        className="ipg-hp" tabIndex={-1} autoComplete="off" aria-hidden="true"
        value={f.company} onChange={(e) => set('company', e.target.value)}
        name="company" placeholder="Company"
      />
      <div className="ipg-form-foot">
        <button className="btn btn-primary" type="submit" disabled={sending}>
          <i className="fas fa-paper-plane" aria-hidden="true" /> {sending ? 'Sending…' : 'Send message'}
        </button>
        <span className="ipg-form-note">We&apos;ll only use your details to reply to this enquiry.</span>
      </div>
    </form>
  );
}
