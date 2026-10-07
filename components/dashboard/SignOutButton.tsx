'use client';

export default function SignOutButton({ className = 'dsh-btn ghost' }: { className?: string }) {
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    // Clear the landing page's cached account so the header shows "Sign in" again,
    // and the live map's "already signed in" hint so its gate doesn't open briefly.
    try { localStorage.removeItem('mappingg_demo_user'); } catch {}
    try { localStorage.removeItem('mpg_map_open'); } catch {}
    window.location.href = '/';
  }
  return (
    <button type="button" className={className} onClick={signOut}>
      <i className="fas fa-right-from-bracket" /> <span className={className.includes('bp-btn') ? 'bp-hide-sm' : undefined}>Sign out</span>
    </button>
  );
}
