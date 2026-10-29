'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import './signin-prompt.css';

// Sign-in popup for guests on public pages, with the "How to use Mappingg" video.
// It never opens on arrival: only once the visitor is engaged (45 s on a page, or
// from their 2nd page view), and at most once per browser session (shared with
// the home page's modal via sessionStorage — see public/landing.js). The form signs in
// for real (POST /api/auth/login, the same call as the home page's modal); WhatsApp
// OTP, "Forgot password" and "Create account" open the full modal on the home page,
// which shows itself on load there (public/landing.js). Signed-in users never see it.
// Client-only: search engines don't run it, so pages stay fully crawlable.

const DELAY_MS = 1000;
/** Time on a first page before the prompt may open. */
const ENGAGED_MS = 45_000;
const PV_KEY = 'mg-pv';
const PROMPTED_KEY = 'mg-signin-prompted';
const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};
const SRC = '/video/how-mappingg-works-v1.mp4';
const POSTER = '/video/how-mappingg-works-v1.jpg';

/** Pages where the popup never shows: the home page (its own modal), the map (its own
 *  sign-in gate), signed-in areas, sign-in itself and the legal pages people must be able to read. */
const SKIP = [/^\/$/, /^\/map(\/|$)/, /^\/dashboard(\/|$)/, /^\/s-admin(\/|$)/, /^\/signin(\/|$)/, /^\/intake(\/|$)/,
  /^\/(privacy|terms|cookies|disclaimer|map-data)(\/|$)/];

// Reset by a refresh (a fresh page load), not by moving between pages.
let closedThisLoad = false;
// The page last counted as a view, so React's dev double-run of effects (StrictMode)
// doesn't count one visit twice and open the prompt early.
let countedPath: string | null = null;

export default function SignInPrompt() {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Page views this session (the home page's modal reads the same counter).
    let views = Number(ss.get(PV_KEY)) || 0;
    if (countedPath !== pathname) { countedPath = pathname; views += 1; ss.set(PV_KEY, String(views)); }
    if (closedThisLoad || ss.get(PROMPTED_KEY) || SKIP.some((r) => r.test(pathname))) return;
    try { if (window.self !== window.top) return; } catch { return; } // never inside an embed
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => {
        if (cancelled || (b && b.session && b.session.user)) return;
        timer = setTimeout(() => {
          if (closedThisLoad || ss.get(PROMPTED_KEY)) return;
          ss.set(PROMPTED_KEY, '1');
          setOpen(true);
        }, views >= 2 ? DELAY_MS : ENGAGED_MS);
      })
      .catch(() => { /* offline or blocked: just don't prompt */ });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [pathname]);

  const close = () => { closedThisLoad = true; setOpen(false); };

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('mpg-auth-open'); // hides the cookie banner under the popup
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    emailRef.current?.focus({ preventScroll: true });
    const v = video.current;
    try { if (v && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) v.play().catch(() => {}); } catch { /* ignore */ }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('mpg-auth-open');
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      v?.pause();
    };
  }, [open]);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const b = await r.json().catch(() => ({}));
      if (r.ok && b.user) {
        // Staff → super admin, buyers → the live map, developers and partners → their dashboard.
        window.location.href = b.redirect || '/dashboard';
        return;
      }
      setError((b.error && b.error.message) || 'Invalid login credentials');
    } catch {
      setError('Network error — please try again.');
    }
    setBusy(false);
  }

  if (!open) return null;
  return (
    <div className="sip" role="dialog" aria-modal="true" aria-labelledby="sip-title" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sip-card">
        <button type="button" className="sip-x" onClick={close} aria-label="Close"><i className="fas fa-xmark" /></button>
        <figure className="sip-video">
          <video ref={video} src={SRC} poster={POSTER} muted playsInline loop controls preload="metadata" aria-label="How to find property near you on Mappingg: tap Near Me on the live map" />
          <figcaption><i className="fas fa-location-crosshairs" /> Find property near you <span>· tap Near Me on the live map</span></figcaption>
        </figure>
        <div className="sip-main">
          <span className="sip-brand"><span className="sip-mark" aria-hidden="true" /><span>Mappingg<em>.com</em></span></span>
          <h2 id="sip-title">Sign in to explore the live map</h2>
          <p>See projects near you with price, carpet area, possession date and RERA number. It&apos;s free.</p>
          <form className="sip-form" onSubmit={signIn} noValidate>
            <label className="sip-field"><span>Email</span>
              <input ref={emailRef} type="email" autoComplete="username" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="sip-field"><span>Password</span>
              <span className="sip-pass">
                <input type={showPass ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? 'Hide password' : 'Show password'}><i className={`fas ${showPass ? 'fa-eye-slash' : 'fa-eye'}`} /></button>
              </span>
            </label>
            <div className="sip-row"><a href="/?signin=1">Forgot password?</a></div>
            {error && <p className="sip-err" role="alert"><i className="fas fa-triangle-exclamation" /> {error}</p>}
            <button type="submit" className="sip-btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="sip-or">or</div>
          <div className="sip-alt">
            <a className="sip-btn wa" href="/?signin=1"><i className="fab fa-whatsapp" /> WhatsApp OTP</a>
            <a className="sip-btn google" href="/api/auth/google/start"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg> Google</a>
          </div>
          <p className="sip-new">New to Mappingg? <a href="/?signup=1">Create a free account</a></p>
          <button type="button" className="sip-later" onClick={close}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}
