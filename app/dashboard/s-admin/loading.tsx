// Super-admin loading UI — shown instantly while the (dynamic, per-user) admin
// panel renders. Safe here because this segment's auth redirect lives in its
// layout, which runs outside this boundary and so still sends a real 307.
//
// Deliberately NOT at the app root (or /dashboard, whose pages redirect): a
// loading.tsx streams the pages beneath it, which commits a 200 status before notFound()/permanentRedirect() can run — so
// unknown projects became "soft 404s", slug redirects weren't real 308s and
// sign-in redirects became 1-second meta refreshes.
// Public pages don't need it: App Router keeps the current page on screen until
// the next one is ready, so navigation never shows a blank screen.
export default function Loading() {
  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div
        aria-label="Loading"
        role="status"
        style={{
          width: 36,
          height: 36,
          border: '3px solid #e3e8ee',
          borderTopColor: '#1b2430',
          borderRadius: '50%',
          animation: 'mpg-spin 0.8s linear infinite',
        }}
      />
      <style>{'@keyframes mpg-spin{to{transform:rotate(360deg)}}'}</style>
    </main>
  );
}
