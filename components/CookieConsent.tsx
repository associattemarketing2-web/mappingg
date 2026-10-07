'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import './cookie-consent.css';

// Cookie consent banner. Essential cookies (sign-in session, Google sign-in
// round-trip, this choice) are always on. Analytics/marketing cookies set via
// Google Tag Manager stay off — Google Consent Mode defaults to "denied" in
// app/layout.tsx — until the visitor accepts here. The choice is kept in the
// `mg_cookie_consent` cookie for a year, and "Cookie settings" links (or any
// `mpg:cookie-settings` window event) reopen the banner.
export const CONSENT_COOKIE = 'mg_cookie_consent';
const MAX_AGE = 60 * 60 * 24 * 365;

type Choice = 'all' | 'essential';

function readChoice(): Choice | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=(all|essential)`));
  return m ? (m[1] as Choice) : null;
}

function applyChoice(choice: Choice) {
  const v = choice === 'all' ? 'granted' : 'denied';
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  // gtag() pushes the arguments object itself, which is what Consent Mode expects.
  // eslint-disable-next-line prefer-rest-params
  (function gtag(..._args: unknown[]) { w.dataLayer!.push(arguments); })('consent', 'update', {
    analytics_storage: v,
    ad_storage: v,
    ad_user_data: v,
    ad_personalization: v,
  });
  w.dataLayer.push({ event: 'cookie_consent_update', cookie_consent: choice });
}

/** Reopens the cookie banner so a visitor can change their choice. */
export function CookieSettingsButton({ className = 'btn btn-outline' }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event('mpg:cookie-settings'))}>
      <i className="fas fa-sliders" aria-hidden="true" /> Cookie settings
    </button>
  );
}

export default function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!readChoice()) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener('mpg:cookie-settings', reopen);
    return () => window.removeEventListener('mpg:cookie-settings', reopen);
  }, []);

  function choose(choice: Choice) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${choice}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
    applyChoice(choice);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="mg-cookie" role="dialog" aria-live="polite" aria-label="Cookie preferences">
      <div className="mg-cookie-tx">
        <strong>We use cookies</strong>
        <p>
          Essential cookies keep you signed in and the site working. With your OK, we also use analytics cookies to see
          how the map is used and improve it. See our <Link href="/cookies">Cookie Policy</Link>.
        </p>
      </div>
      <div className="mg-cookie-btns">
        <button type="button" className="mg-cookie-btn ghost" onClick={() => choose('essential')}>Essential only</button>
        <button type="button" className="mg-cookie-btn primary" onClick={() => choose('all')}>Accept all</button>
      </div>
    </div>
  );
}
