'use client';

export default function SignOutButton() {
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    // Clear the landing page's cached account so the header shows "Sign in" again.
    try { localStorage.removeItem('mappingg_demo_user'); } catch {}
    window.location.href = '/';
  }
  return (
    <button type="button" className="dsh-btn ghost" onClick={signOut}>
      <i className="fas fa-right-from-bracket" /> Sign out
    </button>
  );
}
