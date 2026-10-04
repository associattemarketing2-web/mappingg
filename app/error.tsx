'use client';

// Root error boundary — shown instead of a blank screen when a route throws.
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface for diagnostics; details are never shown to the user.
    console.error(error);
  }, [error]);

  return (
    <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center' }}>
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
        <p style={{ color: '#5b6672', marginBottom: '1.5rem' }}>
          We hit an unexpected error loading this page. You can try again, or head back to the map.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={reset}
            style={{ padding: '0.6rem 1.1rem', borderRadius: 8, border: 'none', background: '#1b2430', color: '#fff', cursor: 'pointer' }}
          >
            Try again
          </button>
          <a
            href="/map"
            style={{ padding: '0.6rem 1.1rem', borderRadius: 8, border: '1px solid #d0d6dd', color: '#1b2430', textDecoration: 'none' }}
          >
            Open the map
          </a>
        </div>
      </div>
    </main>
  );
}
