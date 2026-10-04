'use client';

import { useEffect, useRef, useState } from 'react';

// Bell in the developer dashboard: the review status of the developer's own
// projects — waiting for approval, approved (live on the map) or not approved.
// Checks every minute; the red count is decisions made since they last looked.
interface Note { id: string; project_id: string; state: 'pending' | 'approved' | 'rejected'; detail: string; at: string; unread: boolean }
interface Payload { counts: { pending: number; approved: number; rejected: number }; unread: number; items: Note[] }

const ICON = { pending: 'fa-hourglass-half', approved: 'fa-circle-check', rejected: 'fa-circle-xmark' } as const;
const TONE = { pending: 'project_edited', approved: 'signup', rejected: 'project_deleted' } as const; // reuse admin bell colours
const ago = (d: string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export default function DevNotificationBell({ onOpenProjects }: { onOpenProjects: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const r = await fetch('/api/my/notifications', { credentials: 'same-origin' });
      if (r.ok) setData((await r.json()).data);
    } catch { /* try again next minute */ }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    window.addEventListener('focus', load);
    return () => { clearInterval(t); window.removeEventListener('focus', load); };
  }, []);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = data?.unread ? `(${data.unread}) ${base}` : base;
  }, [data?.unread]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function markRead() {
    if (!data?.unread) return;
    setData((d) => (d ? { ...d, unread: 0, items: d.items.map((i) => ({ ...i, unread: false })) } : d));
    try { await fetch('/api/my/notifications', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
  }
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setTimeout(markRead, 1500);
  }

  const count = data?.unread || 0;
  const c = data?.counts;
  return (
    <div className="nb-wrap" ref={ref}>
      <button type="button" className={`adm-chip nb-bell${count ? ' has' : ''}`} onClick={toggle} aria-label={count ? `${count} new updates` : 'Project updates'} aria-expanded={open}>
        <i className="fas fa-bell" />
        {count > 0 && <span className="nb-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="nb-pop" role="dialog" aria-label="Project updates">
          <div className="nb-pop-head">
            <b>Project updates</b>
            {data && data.items.some((i) => i.unread) && <button type="button" className="link-btn" onClick={markRead}>Mark all read</button>}
          </div>
          {c && (c.pending + c.approved + c.rejected) > 0 && (
            <div className="dnb-counts">
              <span className="p"><b>{c.pending}</b> waiting</span>
              <span className="a"><b>{c.approved}</b> approved</span>
              <span className="r"><b>{c.rejected}</b> not approved</span>
            </div>
          )}
          {!data ? (
            <p className="nb-empty">Loading…</p>
          ) : data.items.length === 0 ? (
            <p className="nb-empty">No updates yet. When you add a project, you&apos;ll see here when it&apos;s approved.</p>
          ) : (
            <ul className="nb-list">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={n.unread ? 'unread' : ''} onClick={() => { setOpen(false); onOpenProjects(); }}>
                    <span className={`nb-ic t-${TONE[n.state]}`}><i className={`fas ${ICON[n.state]}`} /></span>
                    <span className="nb-tx">
                      <b>{n.state === 'pending' ? 'Waiting for approval' : n.state === 'approved' ? 'Approved' : 'Not approved'}</b>
                      <span>{n.detail}</span>
                      <small>{ago(n.at)}</small>
                    </span>
                    {n.unread && <span className="nb-dot" aria-label="New" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
