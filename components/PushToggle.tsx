'use client';

import { useCallback, useEffect, useState } from 'react';

// Phone push notifications for the team (lib/push.ts, /api/push, public/sw.js).
//   <PushToggle />  — "Phone notifications: on / off" in the admin's user menu
//   <PushPrompt />  — a one-time card in the installed app (or on a phone)
//                     asking to turn them on; "Not now" hides it for 2 weeks.
// iPhone: Apple only allows web push for an app added to the Home Screen
// (iOS 16.4+), so in Safari it explains that instead.

type State = 'loading' | 'unsupported' | 'ios-install' | 'off-server' | 'blocked' | 'off' | 'on' | 'busy';

const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isPhone = () => typeof navigator !== 'undefined' && /android|iphone|ipad|mobile/i.test(navigator.userAgent);

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function api(body?: unknown, endpoint = '') {
  const r = await fetch(body ? '/api/push' : `/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data;
}

function usePush() {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const info = await api(undefined, sub?.endpoint || '');
      if (!info.configured) return setState('off-server');
      if (Notification.permission === 'denied') return setState('blocked');
      if (sub && !info.subscribed) {
        // Subscribed in the browser but unknown to the server (e.g. it was cleaned up): register it again.
        await api({ action: 'subscribe', subscription: sub.toJSON() });
      }
      setState(sub ? 'on' : 'off');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check notifications');
      setState('off');
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const turnOn = async () => {
    setState('busy'); setError('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return false; }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api();
      const sub = (await reg.pushManager.getSubscription())
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource });
      await api({ action: 'subscribe', subscription: sub.toJSON() });
      await api({ action: 'test' });
      setState('on');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications');
      setState('off');
      return false;
    }
  };

  const turnOff = async () => {
    setState('busy'); setError('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api({ action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      setState('off');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn off notifications');
      setState('on');
    }
  };

  const test = async () => { try { await api({ action: 'test' }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not send a test'); } };

  return { state, error, turnOn, turnOff, test };
}

const HELP: Partial<Record<State, string>> = {
  'ios-install': 'On iPhone, first add Mappingg to the Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on.',
  unsupported: 'This browser can’t show notifications. Use Chrome on Android / computer, or the app added to the iPhone Home Screen.',
  'off-server': 'Notifications are not set up on the server yet (WEB_PUSH keys).',
  blocked: 'Notifications are blocked for this site. Allow them in the browser / phone settings (Site settings → Notifications), then try again.',
};

/** Menu item for the admin's user menu. */
export function PushToggle() {
  const { state, error, turnOn, turnOff, test } = usePush();
  const on = state === 'on';
  const help = HELP[state];
  return (
    <>
      <button
        type="button"
        onClick={() => (on ? turnOff() : state === 'off' ? turnOn() : undefined)}
        disabled={state === 'busy' || state === 'loading'}
        title={error || help || ''}
      >
        <i className={`fas ${on ? 'fa-bell' : 'fa-bell-slash'}`} /> Phone notifications: {state === 'busy' || state === 'loading' ? '…' : on ? 'On' : 'Off'}
      </button>
      {on && <button type="button" onClick={test}><i className="fas fa-paper-plane" /> Send a test notification</button>}
      {(help || error) && <small style={{ display: 'block', padding: '2px 14px 8px', color: 'var(--muted, #6b7280)', fontSize: 11.5, lineHeight: 1.4, maxWidth: 260 }}>{error || help}</small>}
    </>
  );
}

const DISMISS_KEY = 'mappingg-push-prompt-dismissed';

/** One-time card in the installed app (or on a phone) asking to turn notifications on. */
export function PushPrompt() {
  const { state, error, turnOn } = usePush();
  const [hidden, setHidden] = useState(true);
  const [lift, setLift] = useState(false); // above the "Install app" button when not installed yet

  useEffect(() => {
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch { /* storage blocked */ }
    setHidden(!(isStandalone() || isPhone()) || Date.now() - dismissed < 14 * 86_400_000);
    setLift(!isStandalone());
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage blocked */ }
    setHidden(true);
  };

  if (hidden || !['off', 'busy', 'ios-install'].includes(state)) return null;
  const ios = state === 'ios-install';
  return (
    <div role="dialog" aria-label="Turn on notifications" style={{
      position: 'fixed', left: 12, right: 12, bottom: `calc(${lift ? 76 : 12}px + env(safe-area-inset-bottom))`, zIndex: 2000, maxWidth: 420, margin: '0 auto',
      background: '#fff', color: '#111827', border: '1px solid #e5e7eb', borderRadius: 14, boxShadow: '0 12px 32px rgba(0,0,0,.18)', padding: 14,
      display: 'flex', gap: 12, alignItems: 'flex-start', fontFamily: 'inherit',
    }}>
      <i className="fas fa-bell" style={{ fontSize: 20, color: '#0f5c47', marginTop: 2 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 14.5, marginBottom: 2 }}>Get notifications on this phone</b>
        <span style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.45, display: 'block' }}>
          {ios ? HELP['ios-install'] : 'New leads, WhatsApp messages and opened links — even when the app is closed.'}
        </span>
        {error && <span style={{ fontSize: 12.5, color: '#b45309', display: 'block', marginTop: 4 }}>{error}</span>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {!ios && (
            <button type="button" onClick={async () => { if (await turnOn()) dismiss(); }} disabled={state === 'busy'}
              style={{ background: '#0f5c47', color: '#fff', border: 0, borderRadius: 9, padding: '9px 14px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', minHeight: 40 }}>
              {state === 'busy' ? 'Turning on…' : 'Turn on'}
            </button>
          )}
          <button type="button" onClick={dismiss}
            style={{ background: 'transparent', color: '#374151', border: '1px solid #d1d5db', borderRadius: 9, padding: '9px 14px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', minHeight: 40 }}>
            {ios ? 'OK' : 'Not now'}
          </button>
        </div>
      </div>
    </div>
  );
}
