'use client';

import { useState } from 'react';

// "Copy share link" next to a project in the super admin: a /map?share=… link
// that opens the live map without signing in, showing only this project; the
// person may open its card 3 times before being asked to create an account
// (lib/share-link.ts).
export default function ShareLinkButton({ pinId, className = 'adm-btn ghost sm' }: { pinId: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function copy() {
    setState('busy'); setMsg('');
    try {
      const r = await fetch('/api/admin/share-link', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin_id: pinId }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.data?.url) throw new Error(b?.error?.message || 'Could not make the link');
      try { await navigator.clipboard.writeText(b.data.url); } catch { window.prompt('Copy this link:', b.data.url); }
      setState('done');
      setTimeout(() => setState('idle'), 2500);
    } catch (e) {
      setState('error'); setMsg(e instanceof Error ? e.message : 'Could not make the link');
      setTimeout(() => setState('idle'), 4000);
    }
  }

  return (
    <button type="button" className={className} onClick={copy} disabled={state === 'busy'} title={msg || 'Opens the map without sign-in, showing only this project (3 free views)'}>
      <i className={`fas ${state === 'done' ? 'fa-check' : state === 'error' ? 'fa-triangle-exclamation' : 'fa-share-nodes'}`} />{' '}
      {state === 'busy' ? 'Making link…' : state === 'done' ? 'Link copied' : state === 'error' ? 'Try again' : 'Copy share link'}
    </button>
  );
}
