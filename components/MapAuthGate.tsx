'use client';

import { useEffect, useState } from 'react';

// Login gate for the live map. The map page stays fully server-rendered and
// crawlable (great for SEO), but a guest gets a sign-in prompt over a blurred
// map — no preview of the map at all. Signed-in users never see it.
//
// It is intentionally client-only: search engines don't run this, so they keep
// indexing the project list underneath.
//
// Flash-free by design:
//  - We start in a neutral `checking` state (blurred loader, NO sign-in text),
//    so a signed-in user never flashes the sign-in prompt while the async
//    session check is in flight, and the map still never flashes for guests.
//  - A signed-in user's browser remembers access in localStorage, so on repeat
//    visits the map opens INSTANTLY (no loader at all); the async check still
//    runs and self-corrects a stale hint.
type Gate = 'checking' | 'guest' | 'pending' | 'open';

const HINT_KEY = 'mpg_map_open';

export default function MapAuthGate() {
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    let cancelled = false;

    // Optimistic: a previously-confirmed session opens the map immediately, so
    // returning signed-in users see no loader. The fetch below still verifies.
    try { if (localStorage.getItem(HINT_KEY) === '1') setGate('open'); } catch {}

    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return;
        const user = b && b.session && b.session.user;
        if (!user) {
          try { localStorage.removeItem(HINT_KEY); } catch {}
          setGate('guest');
          return;
        }
        // Developers and channel partners must be approved by the super-admin
        // before they can open the live map. Buyers and staff are never gated.
        const needsApproval = user.role === 'developer' || user.role === 'agent';
        if (needsApproval && user.verified === false) {
          try { localStorage.removeItem(HINT_KEY); } catch {}
          setGate('pending');
          return;
        }
        try { localStorage.setItem(HINT_KEY, '1'); } catch {}
        setGate('open');
      })
      // Fail open on a network blip so a real user is never locked out.
      .catch(() => { if (!cancelled) setGate('open'); });
    return () => { cancelled = true; };
  }, []);

  if (gate === 'open') return null;

  // Neutral loading veil while the session check is in flight — blurred like the
  // gate, but with no sign-in prompt, so logged-in users never see sign-in flash.
  if (gate === 'checking') {
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 100000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(8, 20, 16, 0.5)', backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
      >
        <div
          style={{
            width: 38, height: 38, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.35)', borderTopColor: '#fff',
            animation: 'mpg-gate-spin 0.8s linear infinite',
          }}
        />
        <style>{'@keyframes mpg-gate-spin{to{transform:rotate(360deg)}}'}</style>
      </div>
    );
  }

  if (gate === 'pending') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mgate-title"
        style={{
          position: 'fixed', inset: 0, zIndex: 100000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(8, 20, 16, 0.5)', backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)', padding: 20,
        }}
      >
        <div
          style={{
            maxWidth: 440, width: '100%', background: '#fff', borderRadius: 18,
            padding: '28px 26px', textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0,0,0,0.28)', fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ fontSize: 34, marginBottom: 6 }} aria-hidden="true">⏳</div>
          <h2 id="mgate-title" style={{ margin: '0 0 8px', fontSize: 20, color: '#0f2e24' }}>
            Your account is awaiting approval
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5, color: '#4a5a54' }}>
            You can&apos;t open the live map until the Mappingg team approves your account. We verify
            your MahaRERA number on MahaRERA — usually within one working day. You&apos;ll get access
            automatically once approved.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href="/dashboard"
              style={{
                background: '#0f5c47', color: '#fff', textDecoration: 'none',
                padding: '12px 16px', borderRadius: 11, fontWeight: 700, fontSize: 15,
              }}
            >
              Go to my dashboard
            </a>
            <a href="/" style={{ color: '#6b7a74', textDecoration: 'none', fontSize: 13, marginTop: 4 }}>
              ← Back to home
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mgate-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(8, 20, 16, 0.5)', backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)', padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 420, width: '100%', background: '#fff', borderRadius: 18,
          padding: '28px 26px', textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0,0,0,0.28)', fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 34, marginBottom: 6 }} aria-hidden="true">🗺️</div>
        <h2 id="mgate-title" style={{ margin: '0 0 8px', fontSize: 20, color: '#0f2e24' }}>
          Sign in to explore the live map
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5, color: '#4a5a54' }}>
          See every live project with status, MahaRERA-verified RERA numbers, pricing and nearby
          infrastructure. It takes under a minute.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a
            href="/?signin=1"
            style={{
              background: '#0f5c47', color: '#fff', textDecoration: 'none',
              padding: '12px 16px', borderRadius: 11, fontWeight: 700, fontSize: 15,
            }}
          >
            Sign in
          </a>
          <a
            href="/?signin=1"
            style={{
              background: '#eef4f1', color: '#0f5c47', textDecoration: 'none',
              padding: '12px 16px', borderRadius: 11, fontWeight: 700, fontSize: 15,
            }}
          >
            Create an account
          </a>
          <a href="/" style={{ color: '#6b7a74', textDecoration: 'none', fontSize: 13, marginTop: 4 }}>
            ← Back to home
          </a>
        </div>
      </div>
    </div>
  );
}
