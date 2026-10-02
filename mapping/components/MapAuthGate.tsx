'use client';

import { useEffect, useState } from 'react';

// Login gate for the live map. The map page stays fully server-rendered and
// crawlable (great for SEO), but a guest immediately gets a sign-in prompt over
// a blurred map — no preview of the map at all. Signed-in users never see it.
//
// It is intentionally client-only: search engines don't run this, so they keep
// indexing the project list underneath. We start gated and only reveal the map
// once a signed-in session is confirmed, so the map never flashes for guests.
export default function MapAuthGate() {
  const [gated, setGated] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => { if (!cancelled && b && b.session && b.session.user) setGated(false); })
      // Fail open on a network blip so a real user is never locked out.
      .catch(() => { if (!cancelled) setGated(false); });
    return () => { cancelled = true; };
  }, []);

  if (!gated) return null;

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
