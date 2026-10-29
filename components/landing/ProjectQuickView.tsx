'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { QuickView } from '@/lib/home/quickview';
import { WHATSAPP_NUMBER, WHATSAPP_DISPLAY } from '@/lib/contact';
import { isValidNumber, splitPhone, PHONE_ERROR } from '@/lib/phone';

// "Enquire now" popup for project cards on the home page. Any link with
// data-quickview="<pin number>" opens it (event delegation, so server-rendered
// cards work too); without JavaScript the link still goes to the contact form.
// Blocks with no data are left out — nothing here is made up.

type Load = { k: 'loading' } | { k: 'error' } | { k: 'ready'; p: QuickView };

export default function ProjectQuickView() {
  const [num, setNum] = useState<number | null>(null);
  const [load, setLoad] = useState<Load>({ k: 'loading' });
  const [shot, setShot] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [form, setForm] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const fetchIt = useCallback(async (n: number) => {
    setLoad({ k: 'loading' });
    try {
      const r = await fetch(`/api/project-quickview?n=${n}`);
      if (!r.ok) throw new Error(String(r.status));
      setLoad({ k: 'ready', p: (await r.json()) as QuickView });
    } catch {
      setLoad({ k: 'error' });
    }
  }, []);

  // Open from any [data-quickview] link.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('[data-quickview]') as HTMLElement | null;
      const n = a ? Number(a.dataset.quickview) : NaN;
      if (!a || !Number.isInteger(n)) return;
      e.preventDefault();
      opener.current = a;
      setShot(0); setAboutOpen(false); setForm(a.dataset.quickviewForm === '1'); setCopied(false);
      setNum(n);
      fetchIt(n);
    };
    // Capture phase: runs before SmoothLinks' client-side navigation (components/SmoothLinks.tsx),
    // which then skips this click because it is already handled (defaultPrevented).
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [fetchIt]);

  const close = useCallback(() => {
    setNum(null);
    opener.current?.focus({ preventScroll: true });
  }, []);

  // While open: lock page scroll, Esc closes, Tab stays inside the dialog.
  useEffect(() => {
    if (num == null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('mpg-auth-open'); // hides the cookie banner under the popup
    dialog.current?.querySelector<HTMLElement>('.qv-x')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !dialog.current) return;
      const f = [...dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex="0"]')].filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove('mpg-auth-open');
      document.removeEventListener('keydown', onKey);
    };
  }, [num, close]);

  if (num == null) return null;
  const p = load.k === 'ready' ? load.p : null;
  const pageUrl = p ? `${window.location.origin}${p.href}` : '';
  const waText = p ? `Hi, I'm interested in ${p.title}${p.locality ? `, ${p.locality}` : ''}. Please share details. ${pageUrl}` : '';

  async function copyLink() {
    try { await navigator.clipboard.writeText(pageUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy this link', pageUrl); }
  }

  return (
    <div className="qv-back" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="qv" role="dialog" aria-modal="true" aria-labelledby="qv-title" ref={dialog}>
        <button type="button" className="qv-x" onClick={close} aria-label="Close"><i className="fas fa-xmark" aria-hidden="true" /></button>

        {load.k === 'loading' && (
          <div className="qv-body" aria-busy="true">
            <h2 id="qv-title" className="sr-only">Loading project</h2>
            <div className="qv-skel"><span /><span /><span /><span /></div>
          </div>
        )}

        {load.k === 'error' && (
          <div className="qv-body qv-err" role="alert">
            <h2 id="qv-title">We couldn’t load this project</h2>
            <p>Check your connection and try again.</p>
            <button type="button" className="hf-btn hf-btn-solid" onClick={() => fetchIt(num)}>Try again</button>
          </div>
        )}

        {p && (
          <>
            <div className="qv-body">
              <header className="qv-head">
                {p.logo && (
                  // eslint-disable-next-line @next/next/no-img-element -- small logo from /api/media
                  <span className="qv-logo"><img src={p.logo} alt={`${p.developer} logo`} width={88} height={88} /></span>
                )}
                <div className="qv-head-main">
                  <h2 id="qv-title">{p.title}</h2>
                  <div className="qv-chips">
                    {p.status && <span className="qv-chip st">{p.status}</span>}
                    {p.type && <span className="qv-chip">{p.type}</span>}
                    {p.green && <span className="qv-chip green"><i className="fas fa-leaf" aria-hidden="true" /> {p.green}</span>}
                  </div>
                  <p className="qv-meta">
                    {p.developer && <span><i className="fas fa-building" aria-hidden="true" /> {p.developer}</span>}
                    {(p.locality || p.city) && <span><i className="fas fa-location-dot" aria-hidden="true" /> {[p.locality, p.city].filter(Boolean).join(', ')}</span>}
                  </p>
                  {(p.rera || p.possession) && (
                    <dl className="qv-meta2">
                      {p.rera && <div><dt>RERA No.</dt><dd>{p.rera}</dd></div>}
                      {p.possession && <div><dt>Possession</dt><dd>{p.possession}</dd></div>}
                    </dl>
                  )}
                </div>
              </header>

              {p.photos.length > 0 && (
                <div className="qv-gallery">
                  <div className="qv-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- cached /api/media or CDN photo */}
                    <img src={p.photos[shot]} alt={`${p.title} — photo ${shot + 1} of ${p.photos.length}`} className={p.photos[shot] === p.image && !p.photos.slice(0, shot).length && p.photos.length === 1 ? 'fit' : ''} />
                    {p.video && <a className="qv-video" href={p.video} target="_blank" rel="noopener"><i className="fas fa-play" aria-hidden="true" /> Watch video</a>}
                    {p.photos.length > 1 && <span className="qv-count">{shot + 1}/{p.photos.length}</span>}
                  </div>
                  {p.photos.length > 1 && (
                    <div className="qv-thumbs" role="list" aria-label="Photos">
                      {p.photos.map((src, i) => (
                        <button key={src} type="button" role="listitem" className={i === shot ? 'on' : ''} onClick={() => setShot(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === shot}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!p.photos.length && p.video && (
                <a className="qv-video solo" href={p.video} target="_blank" rel="noopener"><i className="fas fa-play" aria-hidden="true" /> Watch project video</a>
              )}

              {p.facts.length > 0 && (
                <dl className="qv-facts">
                  {p.facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
                </dl>
              )}

              {p.price && (
                <div className="qv-price"><small>Starting price</small><b>{p.price}</b></div>
              )}

              {(p.units.length > 0 || p.configs.length > 0 || p.area) && (
                <table className="qv-table qv-units">
                  <thead><tr><th scope="col">Configuration</th><th scope="col">{p.units.length || /carpet/.test(p.area) ? 'Carpet area' : 'Area'}</th><th scope="col">Price</th></tr></thead>
                  <tbody>
                    {p.units.length > 0
                      ? p.units.map((u) => <tr key={u.config}><td>{u.config}</td><td>{u.area || '—'}</td><td className="pr">{u.price || <span className="req">On request</span>}</td></tr>)
                      : <tr><td>{p.configs.join(', ') || '—'}</td><td>{p.area.replace(/ carpet$/, '') || '—'}</td><td className="pr">{p.price || <span className="req">On request</span>}</td></tr>}
                  </tbody>
                </table>
              )}

              {(p.about || p.usp) && (
                <section className="qv-about">
                  <button type="button" onClick={() => setAboutOpen((v) => !v)} aria-expanded={aboutOpen}>
                    <span><b>About {p.title}</b></span><i className={`fas fa-chevron-${aboutOpen ? 'up' : 'down'}`} aria-hidden="true" />
                  </button>
                  <p className={aboutOpen ? 'open' : ''}>{p.about || p.usp}</p>
                </section>
              )}

              {p.highlights.length > 0 && (
                <section>
                  <h3 className="qv-h3">Key highlights</h3>
                  <ul className="qv-hl">
                    {p.highlights.map((h, i) => (
                      <li key={h}><i className={`fas ${['fa-location-dot', 'fa-house-chimney', 'fa-water', 'fa-star'][i % 4]}`} aria-hidden="true" /><span>{h}</span></li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="qv-h3">Explore more</h3>
                {/* A file we don't have yet is asked for on WhatsApp ("on request"), never faked. */}
                <div className="qv-more">
                  {([
                    ['pay', 'fa-file-invoice', 'Payment plan', p.paymentPlan, 'payment plan'],
                    ['fp', 'fa-table-cells-large', 'Floor plans', p.floorPlans[0] || '', 'floor plans'],
                    ['bro', 'fa-image', 'Brochure', p.brochure, 'brochure'],
                    ['tour', 'fa-street-view', '360° tour', p.tour360, '360° tour'],
                  ] as const).map(([cls, icon, label, url, what]) => (
                    <a key={cls} className={cls} target="_blank" rel="noopener"
                      href={url || `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hi, please share the ${what} of ${p.title} (Mappingg).`)}`}>
                      <i className={`fas ${icon}`} aria-hidden="true" /> <span>{label}{!url && <small> on request</small>}</span> <i className="fas fa-chevron-right" aria-hidden="true" />
                    </a>
                  ))}
                </div>
                {p.floorPlans.length > 1 && (
                  <p className="qv-fplist">{p.floorPlans.map((u, i) => <a key={u} href={u} target="_blank" rel="noopener">Floor plan {i + 1}</a>)}</p>
                )}
                <a className="qv-full" href={p.href}>See the full project page <i className="fas fa-chevron-right" aria-hidden="true" /></a>
              </section>

              {form && <VisitForm p={p} />}
            </div>

            <div className="qv-actions">
              <a className="wa" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener"><i className="fab fa-whatsapp" aria-hidden="true" /> WhatsApp</a>
              <a className="call" href={`tel:+${WHATSAPP_NUMBER}`} aria-label={`Call ${WHATSAPP_DISPLAY}`}><i className="fas fa-phone" aria-hidden="true" /> Call</a>
              <button type="button" className="visit" onClick={() => { setForm(true); setTimeout(() => dialog.current?.querySelector<HTMLInputElement>('#qv-name')?.focus(), 50); }}>
                <i className="fas fa-calendar-check" aria-hidden="true" /> Book site visit
              </button>
              <button type="button" className="copy" onClick={copyLink} aria-live="polite"><i className={`fas ${copied ? 'fa-check' : 'fa-link'}`} aria-hidden="true" /> {copied ? 'Copied' : 'Copy link'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Short enquiry inside the popup: name + mobile (email optional) → the contact-leads CRM, linked to the project. */
function VisitForm({ p }: { p: QuickView }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    if (!name.trim()) return setErr('Please add your name.');
    if (!isValidNumber(splitPhone(phone).number)) return setErr(PHONE_ERROR);
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr('That email address looks invalid.');
    setErr(''); setState('sending');
    try {
      const r = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone, email: email.trim(), subject: 'Project enquiry', project: p.title, project_number: p.number, message: 'Wants to book a site visit / get details (from the home page).' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || 'Something went wrong. Please try again.');
      setState('done');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Something went wrong. Please try again.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return <p className="qv-done" role="status"><i className="fas fa-circle-check" aria-hidden="true" /> Thanks, {name.trim().split(' ')[0]}! Our team will contact you soon about {p.title}.</p>;
  }
  return (
    <form className="qv-form" onSubmit={submit} noValidate>
      <h3 className="qv-h3">Book a site visit</h3>
      <p>Share your details and our team will call or WhatsApp you.</p>
      {err && <p className="qv-form-err" role="alert">{err}</p>}
      <label><span>Name *</span><input id="qv-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} required /></label>
      <label><span>Mobile number *</span><input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" autoComplete="tel" placeholder="10-digit number" maxLength={16} required /></label>
      <label><span>Email <small>(optional)</small></span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} /></label>
      <button type="submit" className="hf-btn hf-btn-solid" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Request a call back'}</button>
    </form>
  );
}
