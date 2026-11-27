'use client';

import { useEffect, useRef, useState } from 'react';

// Bell in the admin top bar: everything people do on the site — new sign-ups,
// projects added / edited / approved / deleted, account decisions and profile
// changes, new leads and map enquiries, plus routine activity (sign-ins,
// favourites). Checks every 2 minutes while the tab is open (and on focus); the
// red count is what's new since you last opened it. New items also pop up as a
// desktop notification once you allow it, like the EzyLoan admin.
type Category = 'project' | 'account' | 'lead' | 'activity';
interface Note {
  id: string; type: string; category: Category; user_id: string; name: string; role?: string; detail: string; at: string;
  unread: boolean; actor?: string; project_id?: string; lead_id?: string; quiet?: boolean;
}
interface Payload { pendingProjects: number; unread: number; items: Note[]; sections?: { project: boolean; account: boolean; lead: boolean } }

const ICON: Record<string, string> = {
  project_added: 'fa-map-pin', project_edited: 'fa-pen', project_deleted: 'fa-trash', project_delete_requested: 'fa-trash-can',
  project_approved: 'fa-circle-check', project_rejected: 'fa-circle-xmark', project_delete_approved: 'fa-trash',
  project_delete_rejected: 'fa-rotate-left', project_admin_edit: 'fa-pen-to-square', project_assigned: 'fa-user-tag', project_unassigned: 'fa-user-minus',
  signup: 'fa-user-plus', approved: 'fa-user-check', rejected: 'fa-user-xmark', reset: 'fa-hourglass-half', access: 'fa-key',
  role_changed: 'fa-id-badge', profile_edited: 'fa-user-pen', password_reset: 'fa-lock', deleted: 'fa-user-slash',
  contact: 'fa-envelope', enquiry: 'fa-comment-dots',
  login: 'fa-right-to-bracket', favorite: 'fa-heart', compare: 'fa-code-compare',
};
const TABS: { key: 'all' | Category; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'project', label: 'Projects' }, { key: 'account', label: 'Accounts' },
  { key: 'lead', label: 'Leads' }, { key: 'activity', label: 'Activity' },
];
const POLL_MS = 120_000;
const ago = (d: string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;
const canPush = () => canNotify() && 'serviceWorker' in navigator && 'PushManager' in window;
function urlB64ToUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
/** Subscribes this browser to Web Push and stores it on the server. */
async function subscribePush(): Promise<boolean> {
  const cfg = await fetch('/api/admin/push', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
  const key = cfg?.data?.publicKey;
  if (!cfg?.data?.configured || !key) return false;
  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) as BufferSource });
  const r = await fetch('/api/admin/push', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  return r.ok;
}

export default function NotificationBell({ onOpenProjects, onOpenAccount, onOpenLead, onPending, flash }: {
  onOpenProjects: (focus?: { ownerId?: string; projectId?: string }) => void;
  onOpenAccount: (userId: string) => void;
  onOpenLead?: (leadId: string) => void;
  onPending?: (n: number) => void;
  flash?: (m: string) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'all' | Category>('all');
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');
  // True once this browser gets real device notifications (Web Push), even with the site closed.
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushRef = useRef(false); // read by the poll timer (state would be stale there)
  useEffect(() => { pushRef.current = pushOn; }, [pushOn]);
  const ref = useRef<HTMLDivElement>(null);
  // Ids already shown, so a refresh only alerts about genuinely new items.
  const known = useRef<Set<string> | null>(null);

  function alertNew(fresh: Note[]) {
    if (!fresh.length) return;
    const top = fresh[0];
    const text = fresh.length === 1 ? `${top.name}: ${top.detail}` : `${fresh.length} new — ${top.name}: ${top.detail}`;
    flash?.(`🔔 ${text}`);
    // With Web Push on, the server already sent a device notification for this.
    if (pushRef.current || !canNotify() || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(fresh.length === 1 ? 'Mappingg — new notification' : `Mappingg — ${fresh.length} new notifications`, {
        body: text, icon: '/icons/icon-192.png', tag: 'mappingg-admin',
      });
      n.onclick = () => { window.focus(); setOpen(true); n.close(); };
    } catch { /* some mobile browsers only allow notifications from a service worker */ }
  }

  async function load() {
    try {
      const r = await fetch('/api/admin/notifications', { credentials: 'same-origin' });
      if (!r.ok) return;
      const b = await r.json();
      const d: Payload = b.data;
      setData(d);
      onPending?.(d.pendingProjects);
      if (known.current) {
        const prev = known.current;
        alertNew(d.items.filter((i) => i.unread && !i.quiet && !prev.has(i.id)));
      }
      known.current = new Set(d.items.map((i) => i.id));
    } catch { /* offline — try again on the next check */ }
  }
  useEffect(() => {
    if (canNotify()) setPerm(Notification.permission);
    // Already allowed before? Make sure this browser is subscribed to push.
    if (canPush() && Notification.permission === 'granted') {
      subscribePush().then(setPushOn).catch(() => setPushOn(false));
    }
    load();
    // Every 2 min while visible, and on focus at most once a minute (each check is a DB read).
    let last = Date.now();
    const refresh = (force = false) => {
      if (document.visibilityState !== 'visible' || (!force && Date.now() - last < 60_000)) return;
      last = Date.now();
      load();
    };
    const t = setInterval(() => refresh(true), POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
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
    try { await fetch('/api/admin/notifications', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
  }
  async function enableDesktop() {
    if (!canNotify()) { flash?.('This browser does not support notifications.'); return; }
    setPushBusy(true);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') { flash?.('Notifications are blocked — allow them from the 🔒 icon in the address bar.'); return; }
      if (!canPush()) { flash?.('Alerts will show while the site is open (this browser has no push support).'); return; }
      const ok = await subscribePush();
      setPushOn(ok);
      if (ok) {
        await fetch('/api/admin/push', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
        flash?.('Device notifications on — a test alert was sent.');
      } else flash?.('Could not turn on device notifications (push keys missing on the server?).');
    } catch (e) {
      flash?.(`Could not turn on notifications: ${e instanceof Error ? e.message : 'error'}`);
    } finally { setPushBusy(false); }
  }
  async function sendTest() {
    const r = await fetch('/api/admin/push', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) }).catch(() => null);
    flash?.(r?.ok ? 'Test alert sent to your devices.' : 'Test failed.');
  }
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setTimeout(markRead, 1500); // opening the bell marks things as seen
  }
  function pick(n: Note) {
    setOpen(false);
    if (n.category === 'lead' && n.lead_id && onOpenLead) onOpenLead(n.lead_id);
    else if (n.project_id) onOpenProjects({ projectId: n.project_id });
    else if (n.category === 'project') onOpenProjects({ ownerId: n.user_id });
    else if (n.user_id) onOpenAccount(n.user_id);
  }

  const count = data?.unread || 0;
  const s = data?.sections;
  const tabs = TABS.filter((t) => t.key === 'all' || t.key === 'activity' ? true : !s || s[t.key]);
  const shown = (data?.items || []).filter((i) => tab === 'all' || i.category === tab);
  const unreadIn = (k: 'all' | Category) => (data?.items || []).filter((i) => i.unread && (k === 'all' || i.category === k)).length;
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
            <span className="nb-head-acts">
              {perm !== 'unsupported' && perm !== 'denied' && !pushOn && (
                <button type="button" className="link-btn" onClick={enableDesktop} disabled={pushBusy}>
                  <i className="fas fa-desktop" /> {pushBusy ? 'Turning on…' : 'Turn on device alerts'}
                </button>
              )}
              {pushOn && <button type="button" className="link-btn" onClick={sendTest} title="Alerts reach this device even when the site is closed"><i className="fas fa-bell" /> Alerts on · test</button>}
              {perm === 'denied' && <span className="link-btn" title="Allow notifications from the lock icon in the address bar"><i className="fas fa-bell-slash" /> Blocked</span>}
              {data && data.items.some((i) => i.unread) && <button type="button" className="link-btn" onClick={markRead}>Mark all read</button>}
            </span>
          </div>
          <div className="nb-tabs" role="tablist">
            {tabs.map((t) => {
              const n = unreadIn(t.key);
              return (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
                  {t.label}{n > 0 && <span>{n}</span>}
                </button>
              );
            })}
          </div>
          {data && data.pendingProjects > 0 && (tab === 'all' || tab === 'project') && (
            <button type="button" className="nb-pending" onClick={() => { setOpen(false); onOpenProjects(); }}>
              <i className="fas fa-map-pin" />
              <span><b>{data.pendingProjects} {data.pendingProjects === 1 ? 'project' : 'projects'} waiting for approval</b><small>Review and publish them to the map</small></span>
              <i className="fas fa-chevron-right" />
            </button>
          )}
          {!data ? (
            <p className="nb-empty">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="nb-empty">Nothing here yet. You&apos;ll see sign-ups, projects, leads and account activity as they happen.</p>
          ) : (
            <ul className="nb-list">
              {shown.map((n) => (
                <li key={n.id}>
                  <button type="button" className={n.unread ? 'unread' : ''} onClick={() => pick(n)}>
                    <span className={`nb-ic t-${n.type} c-${n.category}`}><i className={`fas ${ICON[n.type] || 'fa-bell'}`} /></span>
                    <span className="nb-tx">
                      <b>{n.name}</b>
                      <span>{n.detail}</span>
                      <small>{ago(n.at)}{n.actor ? ` · by ${n.actor}` : ''}</small>
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
