'use client';

import { useEffect, useRef, useState } from 'react';

// Bell in the admin top bar: developers adding / editing projects (waiting for
// approval) and new developer / partner sign-ups. Checks every minute; the red
// count is what's new since you last opened it.
interface Note { id: string; type: string; user_id: string; name: string; role?: string; detail: string; at: string; unread: boolean; project_id?: string }
interface Payload { pendingProjects: number; unread: number; items: Note[] }

const ICON: Record<string, string> = {
  project_added: 'fa-map-pin', project_edited: 'fa-pen', project_deleted: 'fa-trash', signup: 'fa-user-plus',
  project_delete_requested: 'fa-trash-can',
};
const ago = (d: string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export default function NotificationBell({ onOpenProjects, onOpenAccount, onPending, flash }: {
  onOpenProjects: (focus?: { ownerId?: string; projectId?: string }) => void;
  onOpenAccount: (userId: string) => void;
  onPending?: (n: number) => void;
  flash?: (m: string) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lastUnread = useRef<number | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/notifications', { credentials: 'same-origin' });
      if (!r.ok) return;
      const b = await r.json();
      const d: Payload = b.data;
      setData(d);
      onPending?.(d.pendingProjects);
      // A gentle heads-up when something new arrives while the panel is open.
      if (lastUnread.current !== null && d.unread > lastUnread.current && d.items[0]) {
        flash?.(`🔔 ${d.items[0].name}: ${d.items[0].detail}`);
      }
      lastUnread.current = d.unread;
    } catch { /* offline — try again next minute */ }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the count in the browser tab too.
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
    lastUnread.current = 0;
    try { await fetch('/api/admin/notifications', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
  }
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setTimeout(markRead, 1500); // opening the bell marks things as seen
  }
  function pick(n: Note) {
    setOpen(false);
    if (n.type === 'signup') onOpenAccount(n.user_id);
    else if (n.project_id) onOpenProjects({ projectId: n.project_id });
    else onOpenProjects({ ownerId: n.user_id });
  }

  const count = data?.unread || 0;
  return (
    <div className="nb-wrap" ref={ref}>
      <button type="button" className={`adm-chip nb-bell${count ? ' has' : ''}`} onClick={toggle} aria-label={count ? `${count} new notifications` : 'Notifications'} aria-expanded={open}>
        <i className="fas fa-bell" />
        {count > 0 && <span className="nb-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="nb-pop" role="dialog" aria-label="Notifications">
          <div className="nb-pop-head">
            <b>Notifications</b>
            {data && data.items.some((i) => i.unread) && <button type="button" className="link-btn" onClick={markRead}>Mark all read</button>}
          </div>
          {data && data.pendingProjects > 0 && (
            <button type="button" className="nb-pending" onClick={() => { setOpen(false); onOpenProjects(); }}>
              <i className="fas fa-map-pin" />
              <span><b>{data.pendingProjects} {data.pendingProjects === 1 ? 'project' : 'projects'} waiting for approval</b><small>Review and publish them to the map</small></span>
              <i className="fas fa-chevron-right" />
            </button>
          )}
          {!data ? (
            <p className="nb-empty">Loading…</p>
          ) : data.items.length === 0 ? (
            <p className="nb-empty">No notifications yet. You&apos;ll see here when developers add projects.</p>
          ) : (
            <ul className="nb-list">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={n.unread ? 'unread' : ''} onClick={() => pick(n)}>
                    <span className={`nb-ic t-${n.type}`}><i className={`fas ${ICON[n.type] || 'fa-bell'}`} /></span>
                    <span className="nb-tx"><b>{n.name}</b><span>{n.detail}</span><small>{ago(n.at)}</small></span>
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
