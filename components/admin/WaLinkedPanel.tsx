'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFile } from './WaComposer';

// s-admin → Communication → WhatsApp Inbox: WhatsApp numbers linked by
// scanning a QR (linked device, like WhatsApp Web), all chats in one place.
// Data: /api/admin/wa-linked (numbers + chats), /messages, /media.
// The connections live on the separate always-on gateway (/wa-gateway).

type Flash = (m: string, e?: boolean) => void;
const API = '/api/admin/wa-linked';
const IST = { timeZone: 'Asia/Kolkata' } as const;

interface Acc {
  id: string; label: string; phone: string; wa_name: string; last_error: string; status: string; running: boolean; qr: string;
  owner_email: string; members: string[]; connected_at: string | null; last_seen_at: string | null; manage: boolean; unread: number;
}
interface Chat {
  account_id: string; jid: string; phone: string; name: string; is_group: boolean; last_text: string; last_at: string | null;
  last_from_me: boolean; unread: number; assigned_to: string;
}
interface Msg {
  id: string; from_me: boolean; sender: string; kind: string; body: string; status: string; ts: string; history: boolean; sent_by: string;
  media: { mimetype?: string; filename?: string; size?: number; voice?: boolean; lat?: number; lng?: number } | null;
}
interface Data {
  me: string; admin: boolean; gateway: { configured: boolean; ok: boolean; error: string };
  accounts: Acc[]; chats: Chat[]; more: boolean; team: { email: string; name: string }[];
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data as T;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  connected: { label: 'Connected', tone: 'ok' },
  connecting: { label: 'Connecting…', tone: 'wait' },
  qr: { label: 'Scan the QR', tone: 'wait' },
  new: { label: 'Starting…', tone: 'wait' },
  qr_expired: { label: 'QR expired', tone: 'off' },
  logged_out: { label: 'Logged out', tone: 'off' },
  replaced: { label: 'Opened elsewhere', tone: 'bad' },
  failed: { label: 'Login refused', tone: 'bad' },
};
const statusOf = (a: Acc) => STATUS[a.status] || { label: a.status, tone: 'off' };
const accName = (a?: Acc) => (!a ? '' : a.label || a.wa_name || (a.phone ? `+${a.phone}` : 'New number'));
const fmtPhone = (d: string) => (d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : d ? `+${d}` : '');
const chatTitle = (c: Chat) => c.name || fmtPhone(c.phone) || (c.is_group ? 'Group' : 'Unknown');
const initials = (s: string) => (s.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '#').toUpperCase();
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', IST);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', ...IST });
const fullTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', ...IST });
function listTime(iso: string | null) {
  if (!iso) return '';
  if (dayKey(iso) === dayKey(new Date().toISOString())) return clock(iso);
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...IST });
}
function dayLabel(iso: string) {
  const k = dayKey(iso);
  if (k === dayKey(new Date().toISOString())) return 'Today';
  if (k === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...IST });
}
const keyOf = (c: { account_id: string; jid: string }) => `${c.account_id}|${c.jid}`;
const kb = (n?: number) => (!n ? '' : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Runs `fn` every `ms` while the tab is visible. */
function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms]);
}

function Ticks({ m }: { m: Msg }) {
  if (!m.from_me) return null;
  if (m.status === 'failed') return <i className="fas fa-circle-exclamation wa-tick fail" title="Not sent" />;
  if (m.status === 'read') return <i className="fas fa-check-double wa-tick read" title="Read" />;
  if (m.status === 'delivered') return <i className="fas fa-check-double wa-tick" title="Delivered" />;
  if (m.status === 'pending') return <i className="far fa-clock wa-tick" title="Sending" />;
  return <i className="fas fa-check wa-tick" title="Sent" />;
}

function MediaView({ m, account }: { m: Msg; account: string }) {
  const src = `${API}/media?account=${account}&id=${encodeURIComponent(m.id)}`;
  // eslint-disable-next-line @next/next/no-img-element -- private, login-only file
  if (m.kind === 'image' || m.kind === 'sticker') return <a href={src} target="_blank" rel="noreferrer"><img className="wl-img" src={src} alt={m.body || 'Photo'} loading="lazy" /></a>;
  if (m.kind === 'video') return <video className="wl-img" src={src} controls preload="none" />;
  if (m.kind === 'audio') return <audio src={src} controls preload="none" />;
  if (m.kind === 'document') return <a className="wl-doc" href={src} target="_blank" rel="noreferrer"><i className="fas fa-file-lines" /> <span>{m.media?.filename || 'Document'}</span> <small>{kb(m.media?.size)}</small></a>;
  if (m.kind === 'location' && m.media?.lat != null) return <a className="wl-doc" href={`https://maps.google.com/?q=${m.media.lat},${m.media.lng}`} target="_blank" rel="noreferrer"><i className="fas fa-location-dot" /> <span>Location</span></a>;
  if (m.kind === 'contact') return <span className="wl-doc"><i className="fas fa-address-card" /> <span>Contact card</span></span>;
  if (m.kind === 'poll') return <span className="wl-doc"><i className="fas fa-square-poll-horizontal" /> <span>Poll</span></span>;
  return null;
}

/* --------------------------- link a new number --------------------------- */

function LinkCard({ a, onChanged, flash }: { a: Acc; onChanged: () => void; flash: Flash }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  async function pair() {
    setBusy(true);
    try { setCode((await api<{ code: string }>(API, { action: 'pair', account: a.id, phone })).code); } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); }
  }
  async function fresh() {
    setBusy(true); setCode('');
    try { await api(API, { action: 'reconnect', account: a.id }); onChanged(); } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="wl-link">
      <div className="wl-qr">
        {/* eslint-disable-next-line @next/next/no-img-element -- QR data URL */}
        {a.qr ? <img src={a.qr} alt="WhatsApp link QR code" width={240} height={240} />
          : a.status === 'qr_expired' ? <button type="button" className="adm-btn primary" onClick={fresh} disabled={busy}><i className="fas fa-rotate" /> Show new QR</button>
            : <p className="muted"><i className="fas fa-spinner fa-spin" /> Getting a QR from WhatsApp…</p>}
      </div>
      <ol className="wl-steps">
        <li>Open <b>WhatsApp</b> on the phone of this number.</li>
        <li>Tap <b>⋮ / Settings → Linked devices → Link a device</b>.</li>
        <li>Point the phone at this QR. Chats start showing here in a minute.</li>
      </ol>
      <details className="wl-pair">
        <summary>Can&apos;t scan? Link with a code instead</summary>
        <div className="wl-pair-row">
          <input inputMode="tel" placeholder="Number with country code, e.g. 919876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button type="button" className="adm-btn ghost sm" onClick={pair} disabled={busy || phone.replace(/\D/g, '').length < 10}>Get code</button>
        </div>
        {code && <p className="wl-code">{code.replace(/^(.{4})(.{4})$/, '$1-$2')}<small>WhatsApp → Linked devices → Link a device → <b>Link with phone number instead</b>, then type this code.</small></p>}
      </details>
    </div>
  );
}

function LinkDialog({ onClose, onCreated, flash }: { onClose: () => void; onCreated: (id: string) => void; flash: Flash }) {
  const [label, setLabel] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { onCreated((await api<{ account: { id: string } }>(API, { action: 'link', label })).account.id); } catch (e) { flash((e as Error).message, true); setBusy(false); }
  }
  return (
    <div className="wl-dialog" role="dialog" aria-modal="true" aria-label="Link a WhatsApp number">
      <div className="wl-dialog-box">
        <h3><i className="fab fa-whatsapp" /> Link a WhatsApp number</h3>
        <p className="wa-note warn"><i className="fas fa-triangle-exclamation" /> This links the number as a device (like WhatsApp Web). It is not WhatsApp&apos;s official business API: WhatsApp may restrict or ban numbers used for automation or bulk messages. Use it for normal one-to-one chats only.</p>
        <label className="adm-field"><span>Name for this number (optional)</span><input value={label} maxLength={80} placeholder="e.g. Rahul – Sales, Pune office" onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="wl-consent"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I own this number or its owner agreed: their WhatsApp chats will be stored in Mappingg and visible to the team members given access.</label>
        <div className="wl-dialog-foot">
          <button type="button" className="adm-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="adm-btn primary" onClick={go} disabled={!ok || busy}>{busy ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-qrcode" />} Show QR</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- numbers ------------------------------- */

function NumbersView({ data, reload, flash, linking }: { data: Data; reload: () => void; flash: Flash; linking: string }) {
  const [edit, setEdit] = useState<string | null>(null);
  async function act(action: string, a: Acc, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try { await api(API, { action, account: a.id, ...extra }); flash('Done'); reload(); } catch (e) { flash((e as Error).message, true); }
  }
  return (
    <div className="wl-numbers">
      {data.accounts.map((a) => {
        const st = statusOf(a);
        // QR box: while a QR is up (also when re-linking), and for a never-linked number that is starting or whose QR ran out.
        const waiting = a.status === 'qr' || a.status === 'new' || (!a.connected_at && (a.status === 'connecting' || a.status === 'qr_expired'));
        return (
          <div key={a.id} className={`wl-num${a.id === linking ? ' focus' : ''}`}>
            <div className="wl-num-head">
              <span className="wa-avatar" aria-hidden>{initials(accName(a).replace('+', ''))}</span>
              <div className="wl-num-who">
                <b>{accName(a)}</b>
                <small>{a.phone ? fmtPhone(a.phone) : 'Not linked yet'}{a.wa_name && a.label ? ` · ${a.wa_name}` : ''}</small>
              </div>
              <span className={`wl-status ${st.tone}`}>{st.label}</span>
            </div>
            {a.last_error && <p className="wl-err">{a.last_error}</p>}
            {waiting && a.status !== 'logged_out' && <LinkCard a={a} onChanged={reload} flash={flash} />}
            <dl className="wl-facts">
              {a.connected_at && <><dt>Linked</dt><dd>{fullTime(a.connected_at)}</dd></>}
              {a.last_seen_at && <><dt>Last activity</dt><dd>{fullTime(a.last_seen_at)}</dd></>}
              <dt>Linked by</dt><dd>{a.owner_email || '—'}</dd>
              <dt>Team access</dt><dd>{a.members.length ? a.members.join(', ') : 'Only the person who linked it (and the super admin)'}</dd>
            </dl>
            {edit === a.id && a.manage && (
              <MembersEditor a={a} team={data.team} onSave={(members, label) => { setEdit(null); void act('members', a, { members }).then(() => (label !== a.label ? act('rename', a, { label }) : undefined)); }} onCancel={() => setEdit(null)} />
            )}
            <div className="wl-num-actions">
              {['logged_out', 'replaced', 'failed', 'qr_expired'].includes(a.status) || (!a.running && data.gateway.ok)
                ? <button type="button" className="adm-btn primary sm" onClick={() => act('reconnect', a)}><i className="fas fa-plug" /> {a.status === 'logged_out' || a.status === 'qr_expired' ? 'Link again (QR)' : 'Reconnect'}</button> : null}
              {a.manage && <button type="button" className="adm-btn ghost sm" onClick={() => setEdit(edit === a.id ? null : a.id)}><i className="fas fa-user-gear" /> Name &amp; access</button>}
              {a.manage && a.status === 'connected' && <button type="button" className="adm-btn ghost sm" onClick={() => act('logout', a, {}, `Log out ${accName(a)}? Its chats stay here; scan again to reconnect.`)}><i className="fas fa-right-from-bracket" /> Log out</button>}
              {a.manage && <button type="button" className="adm-btn danger sm" onClick={() => act('delete', a, {}, `Remove ${accName(a)} and delete ALL its chats from Mappingg? This cannot be undone.`)}><i className="fas fa-trash" /> Remove</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Shown above the chats for a number that is not connected: what is wrong + the QR right here. */
function NeedsLink({ a, reload, flash }: { a: Acc; reload: () => void; flash: Flash }) {
  const [busy, setBusy] = useState(false);
  const st = statusOf(a);
  const starting = a.status === 'connecting' || a.status === 'new';
  async function relink() {
    setBusy(true);
    try { await api(API, { action: 'reconnect', account: a.id }); reload(); } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className={`wl-needs ${st.tone}`}>
      <div className="wl-num-head">
        <span className="wa-avatar" aria-hidden><i className="fab fa-whatsapp" /></span>
        <div className="wl-num-who">
          <b>{accName(a)} — {st.label}</b>
          <small>
            {a.status === 'qr' ? 'Scan this QR with the phone of this number: WhatsApp → Linked devices → Link a device.'
              : starting ? (a.connected_at ? 'Reconnecting… chats show again in a moment.' : 'Getting a QR from WhatsApp…')
                : 'Not connected, so its chats cannot load. Press the button and scan the QR with this phone. Old chats come in right after linking (keep WhatsApp open on the phone for a few minutes).'}
          </small>
        </div>
        {!starting && a.status !== 'qr' && (
          <button type="button" className="adm-btn primary" onClick={relink} disabled={busy}>
            {busy ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-qrcode" />} Link again (QR)
          </button>
        )}
      </div>
      {a.status === 'qr' && <LinkCard a={a} onChanged={reload} flash={flash} />}
    </div>
  );
}

function MembersEditor({ a, team, onSave, onCancel }: { a: Acc; team: Data['team']; onSave: (m: string[], label: string) => void; onCancel: () => void }) {
  const [sel, setSel] = useState(new Set(a.members));
  const [label, setLabel] = useState(a.label);
  const others = team.filter((t) => t.email !== a.owner_email);
  return (
    <div className="wl-members">
      <label className="adm-field"><span>Name</span><input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></label>
      <span className="wl-members-title">Who else can see all chats of this number</span>
      {!others.length && <p className="muted">No teammates have WhatsApp access yet (Employees → give “WhatsApp”).</p>}
      {others.map((t) => (
        <label key={t.email} className="wl-check">
          <input type="checkbox" checked={sel.has(t.email)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.email); else n.delete(t.email); setSel(n); }} />
          {t.name ? `${t.name} (${t.email})` : t.email}
        </label>
      ))}
      <div className="wl-num-actions">
        <button type="button" className="adm-btn primary sm" onClick={() => onSave([...sel], label)}>Save</button>
        <button type="button" className="adm-btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* --------------------------------- inbox --------------------------------- */

export default function WaLinkedPanel({ flash }: { flash: Flash }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'inbox' | 'numbers'>('inbox');
  const [account, setAccount] = useState('');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Chat | null>(null);
  const [thread, setThread] = useState<{ key: string; messages: Msg[]; more: boolean } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linking, setLinking] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const qRef = useRef(q);
  qRef.current = q;

  const load = useCallback(async () => {
    const p = new URLSearchParams({ filter, ...(account ? { account } : {}), ...(qRef.current.trim() ? { q: qRef.current.trim() } : {}) });
    try {
      const d = await api<Data>(`${API}?${p}`);
      setData(d); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [filter, account]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => void load(), 300); return () => clearTimeout(t); }, [q, load]);
  // Faster while a QR is on screen (it changes every ~20 s and we want "Connected" to show at once).
  const qrOnScreen = Boolean(data?.accounts.some((a) => a.status === 'qr' || a.status === 'new' || a.status === 'connecting'));
  usePoll(() => void load(), qrOnScreen ? 2_500 : 6_000);

  const loadThread = useCallback(async (c: Chat, older = false) => {
    const k = keyOf(c);
    const first = older && thread?.key === k ? thread.messages[0]?.ts : undefined;
    try {
      const r = await api<{ messages: Msg[]; more: boolean }>(`${API}/messages?account=${c.account_id}&jid=${encodeURIComponent(c.jid)}${first ? `&before=${encodeURIComponent(first)}` : ''}`);
      setThread((t) => (older && t?.key === k ? { key: k, messages: [...r.messages, ...t.messages], more: r.more } : { key: k, messages: r.messages, more: r.more }));
    } catch (e) { flash((e as Error).message, true); }
  }, [thread, flash]);

  useEffect(() => {
    if (!open) { setThread(null); return; }
    setThread(null);
    void loadThread(open);
    if (open.unread) void api(API, { action: 'read', account: open.account_id, jid: open.jid }).then(() => load()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.account_id, open?.jid]);
  usePoll(() => {
    if (!open) return;
    void loadThread(open);
    const fresh = data?.chats.find((c) => keyOf(c) === keyOf(open));
    if (fresh?.unread) void api(API, { action: 'read', account: open.account_id, jid: open.jid }).catch(() => undefined);
  }, 4_000);
  const lastId = thread?.messages[thread.messages.length - 1]?.id;
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [lastId]);

  const accById = new Map((data?.accounts || []).map((a) => [a.id, a]));
  const connected = (data?.accounts || []).filter((a) => a.status === 'connected');
  const openAcc = open ? accById.get(open.account_id) : undefined;

  async function send(media?: { kind: 'image' | 'video' | 'document'; url: string; mimetype?: string; filename?: string }) {
    const target = open;
    if (!target && !newChat) return;
    if (!media && !text.trim()) return;
    setBusy('send');
    try {
      if (target) {
        await api(API, { action: 'send', account: target.account_id, jid: target.jid, text, ...(media ? { media } : {}) });
        setText('');
        await loadThread(target);
      } else {
        const acc = account || connected[0]?.id;
        if (!acc) throw new Error('Link and connect a number first');
        const r = await api<{ jid: string }>(API, { action: 'send', account: acc, phone: newPhone, text, ...(media ? { media } : {}) });
        setText(''); setNewChat(false); setNewPhone('');
        await load();
        setOpen({ account_id: acc, jid: r.jid, phone: r.jid.split('@')[0], name: '', is_group: false, last_text: '', last_at: null, last_from_me: true, unread: 0, assigned_to: '' });
      }
      void load();
    } catch (e) { flash((e as Error).message, true); } finally { setBusy(''); }
  }

  async function attach(file: File) {
    const kind = file.type.startsWith('image/') && /jpe?g|png/.test(file.type) ? 'image' : file.type.startsWith('video/') && /mp4|3gpp/.test(file.type) ? 'video' : 'document';
    setBusy('upload');
    try {
      const url = await uploadFile(file, kind, () => undefined);
      setBusy('');
      await send({ kind, url, mimetype: file.type || undefined, filename: file.name });
    } catch (e) { flash((e as Error).message, true); setBusy(''); }
  }

  /** Asks the phone for older messages of the chat; they arrive a few seconds later. */
  async function older(c: Chat) {
    setBusy('older');
    try {
      await api(API, { action: 'older', account: c.account_id, jid: c.jid });
      flash('Asked the phone for older messages — they appear in a few seconds');
      await new Promise((r) => setTimeout(r, 6_000));
      await loadThread(c, true);
    } catch (e) { flash((e as Error).message, true); } finally { setBusy(''); }
  }

  async function assign(to: string) {
    if (!open) return;
    try { await api(API, { action: 'assign', account: open.account_id, jid: open.jid, to }); flash(to ? `Assigned to ${to}` : 'Unassigned'); setOpen({ ...open, assigned_to: to }); void load(); } catch (e) { flash((e as Error).message, true); }
  }

  if (error && !data) return <div className="wa-setup"><i className="fas fa-triangle-exclamation" /><div><b>Could not load the WhatsApp Inbox</b><span>{error}</span></div></div>;
  if (!data) return <p className="muted"><i className="fas fa-spinner fa-spin" /> Loading…</p>;

  const gw = data.gateway;
  const chats = data.chats;
  const current = open ? chats.find((c) => keyOf(c) === keyOf(open)) || open : null;

  return (
    <div className="wl-wrap">
      {!gw.configured ? (
        <div className="wa-setup"><i className="fas fa-server" /><div><b>The WhatsApp server is not set up yet</b><span>Deploy the gateway in <code>wa-gateway/</code> (see its README) and add <code>WA_GATEWAY_URL</code> and <code>WA_GATEWAY_SECRET</code> to the website&apos;s environment. Then numbers can be linked here.</span></div></div>
      ) : !gw.ok && (
        <div className="wa-setup"><i className="fas fa-plug-circle-xmark" /><div><b>The WhatsApp server is not answering</b><span>{gw.error} Chats already saved still show; sending and linking work again once it is back.</span></div></div>
      )}

      <div className="wl-bar">
        <div className="wa-filters" role="tablist" aria-label="WhatsApp number">
          <button type="button" role="tab" aria-selected={!account} className={!account ? 'on' : ''} onClick={() => { setAccount(''); setOpen(null); }}>All numbers</button>
          {data.accounts.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={account === a.id} className={account === a.id ? 'on' : ''} onClick={() => { setAccount(a.id); setOpen(null); }}>
              <span className={`wl-dot ${statusOf(a).tone}`} aria-label={statusOf(a).label} /> {accName(a)}{a.unread ? <span className="wa-unread">{a.unread}</span> : null}
            </button>
          ))}
        </div>
        <div className="wl-bar-actions">
          <button type="button" className={`adm-btn ${view === 'numbers' ? 'primary' : 'ghost'} sm`} onClick={() => setView(view === 'numbers' ? 'inbox' : 'numbers')}>
            <i className={`fas ${view === 'numbers' ? 'fa-inbox' : 'fa-mobile-screen'}`} /> {view === 'numbers' ? 'Back to chats' : `Numbers (${data.accounts.length})`}
          </button>
          <button type="button" className="adm-btn primary sm" onClick={() => setLinkOpen(true)} disabled={!gw.configured || !gw.ok}><i className="fas fa-qrcode" /> Link WhatsApp</button>
        </div>
      </div>

      {linkOpen && <LinkDialog flash={flash} onClose={() => setLinkOpen(false)} onCreated={(id) => { setLinkOpen(false); setLinking(id); setView('numbers'); void load(); }} />}

      {view === 'inbox' && gw.ok && data.accounts.filter((a) => (!account || a.id === account) && a.status !== 'connected').map((a) => (
        <NeedsLink key={a.id} a={a} reload={() => void load()} flash={flash} />
      ))}

      {view === 'numbers' || !data.accounts.length ? (
        !data.accounts.length ? (
          <div className="wa-placeholder wl-empty-state">
            <i className="fab fa-whatsapp" />
            <h3>No WhatsApp linked yet</h3>
            <p>Press <b>Link WhatsApp</b> and scan the QR with the phone (WhatsApp → Linked devices). Every linked number&apos;s chats then show here together. Only new messages and the recent chats the phone shares when linking come in — WhatsApp does not hand over full old history.</p>
          </div>
        ) : <NumbersView data={data} reload={() => void load()} flash={flash} linking={linking} />
      ) : (
        <div className={`wa-shell${current || newChat ? ' has-open' : ''}`}>
          <aside className="wa-list">
            <div className="wa-list-head">
              <div className="wl-search-row">
                <label className="acs-search">
                  <i className="fas fa-magnifying-glass" />
                  <input type="search" placeholder="Search name, number or message" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
                </label>
                <button type="button" className="adm-btn ghost sm" title="Message a new number" onClick={() => { setOpen(null); setNewChat(true); }} disabled={!connected.length}><i className="fas fa-pen-to-square" /></button>
              </div>
              <div className="wa-filters" role="tablist" aria-label="Filter chats">
                {([['all', 'All'], ['unread', 'Unread'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
            </div>
            <ul className="wa-items">
              {!chats.length ? <li className="wa-empty">{q || filter !== 'all' ? 'No chat matches.' : 'No chats yet. New messages to the linked numbers show up here.'}</li>
                : chats.map((c) => (
                  <li key={keyOf(c)}>
                    <button type="button" className={`wa-item${current && keyOf(current) === keyOf(c) ? ' on' : ''}`} onClick={() => { setNewChat(false); setOpen(c); }}>
                      <span className="wa-avatar" aria-hidden>{c.is_group ? <i className="fas fa-users" /> : initials(chatTitle(c).replace('+', ''))}</span>
                      <span className="wa-item-main">
                        <span className="wa-item-top"><b>{chatTitle(c)}</b><time className={c.unread ? 'unread' : ''}>{listTime(c.last_at)}</time></span>
                        <span className="wa-item-bottom">
                          <span className="wa-preview">{c.last_from_me && <i className="fas fa-reply" title="Sent by you" />} {c.last_text}</span>
                          {c.unread > 0 && <span className="wa-unread">{c.unread}</span>}
                        </span>
                        <span className="wa-item-tags">
                          {!account && <span className="wa-tag manual" title="WhatsApp number">{accName(accById.get(c.account_id))}</span>}
                          {c.assigned_to && <span className="wa-tag lead" title="Assigned to"><i className="fas fa-user-tag" /> {c.assigned_to.split('@')[0]}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </aside>

          <section className="wa-chat" aria-label="Conversation">
            {newChat ? (
              <>
                <header className="wa-chat-head">
                  <button type="button" className="wa-back" onClick={() => setNewChat(false)} aria-label="Back to chats"><i className="fas fa-arrow-left" /></button>
                  <div className="wa-chat-who"><b>New message</b><small>From {accName(accById.get(account) || connected[0])}{!account && connected.length > 1 ? ' — pick a number above to send from another' : ''}</small></div>
                </header>
                <div className="wa-thread"><div className="wl-new">
                  <label className="adm-field"><span>WhatsApp number (with country code)</span><input inputMode="tel" value={newPhone} placeholder="919876543210" onChange={(e) => setNewPhone(e.target.value)} /></label>
                  <p className="wa-note warn"><i className="fas fa-triangle-exclamation" /> Messaging people who never saved or contacted this number is the fastest way to get it banned. Prefer replying to people who wrote to you.</p>
                </div></div>
              </>
            ) : !current ? (
              <div className="wa-placeholder">
                <i className="fab fa-whatsapp" />
                <h3>WhatsApp Inbox</h3>
                <p>Chats of {data.accounts.length === 1 ? 'the linked number' : `all ${data.accounts.length} linked numbers`} in one place. Pick a chat to read and reply.</p>
              </div>
            ) : (
              <>
                <header className="wa-chat-head">
                  <button type="button" className="wa-back" onClick={() => setOpen(null)} aria-label="Back to chats"><i className="fas fa-arrow-left" /></button>
                  <span className="wa-avatar" aria-hidden>{current.is_group ? <i className="fas fa-users" /> : initials(chatTitle(current).replace('+', ''))}</span>
                  <div className="wa-chat-who">
                    <b>{chatTitle(current)}</b>
                    <small>{current.is_group ? 'Group' : fmtPhone(current.phone)} · on {accName(openAcc)}</small>
                  </div>
                  <div className="wa-chat-actions">
                    <select className="wl-assign" value={current.assigned_to} onChange={(e) => void assign(e.target.value)} aria-label="Assign this chat" title="Assign this chat to a teammate">
                      <option value="">Unassigned</option>
                      {data.team.map((t) => <option key={t.email} value={t.email}>{t.name || t.email}</option>)}
                      {current.assigned_to && !data.team.some((t) => t.email === current.assigned_to) && <option value={current.assigned_to}>{current.assigned_to}</option>}
                    </select>
                    {!current.is_group && current.phone && <a className="adm-btn ghost sm" href={`https://wa.me/${current.phone}`} target="_blank" rel="noreferrer" title="Open in WhatsApp"><i className="fab fa-whatsapp" /></a>}
                  </div>
                </header>
                <div className="wa-thread">
                  {thread && thread.key === keyOf(current) && thread.messages.length > 0 && (thread.more
                    ? <button type="button" className="adm-btn ghost sm wl-older" onClick={() => void loadThread(current, true)}>Load older messages</button>
                    : openAcc?.status === 'connected' && (
                      <button type="button" className="adm-btn ghost sm wl-older" disabled={busy === 'older'} onClick={() => void older(current)} title="Ask the phone for 50 older messages of this chat">
                        {busy === 'older' ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-clock-rotate-left" />} Load older messages from phone
                      </button>
                    ))}
                  {!thread || thread.key !== keyOf(current) ? <p className="wa-loading"><i className="fas fa-spinner fa-spin" /> Loading messages…</p>
                    : !thread.messages.length ? <p className="wa-loading">WhatsApp did not share the old messages of this chat when the number was linked. New messages will show here as they come.</p>
                      : thread.messages.map((m, i) => {
                        const prev = thread.messages[i - 1];
                        const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
                        const showSender = current.is_group && !m.from_me && m.sender && (!prev || prev.sender !== m.sender || prev.from_me);
                        const histStart = m.history && (!prev || !prev.history);
                        return (
                          <div key={m.id}>
                            {newDay && <div className="wa-day"><span>{dayLabel(m.ts)}</span></div>}
                            {histStart && <div className="wa-day"><span>Synced from the phone when it was linked</span></div>}
                            <div className={`wa-row ${m.from_me ? 'out' : 'in'}`}>
                              <div className={`wa-bubble ${m.from_me ? 'out' : 'in'}${m.status === 'failed' ? ' failed' : ''}`}>
                                {showSender && <span className="wa-who staff">{m.sender}</span>}
                                {m.from_me && m.sent_by && <span className="wa-who staff"><i className="fas fa-user-tie" /> {m.sent_by.split('@')[0]}</span>}
                                <MediaView m={m} account={current.account_id} />
                                {m.body && <p className="wa-text">{m.body}</p>}
                                <span className="wa-meta"><time title={fullTime(m.ts)}>{clock(m.ts)}</time><Ticks m={m} /></span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  <div ref={bottom} />
                </div>
              </>
            )}

            {(current || newChat) && (
              <footer className="wa-compose">
                {current && openAcc && openAcc.status !== 'connected' && <p className="wa-note warn"><i className="fas fa-plug-circle-xmark" /> {accName(openAcc)} is not connected ({statusOf(openAcc).label}) — messages can&apos;t be sent until it reconnects.</p>}
                <div className="wa-compose-row">
                  <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
                  <button type="button" className="wa-ai-btn" onClick={() => fileRef.current?.click()} disabled={!!busy || (newChat && !newPhone.trim())} title="Send a photo, video or document (the text below is sent as its caption)">
                    {busy === 'upload' ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-paperclip" />}
                  </button>
                  <textarea
                    rows={1} value={text} placeholder="Type a message" aria-label="Message"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  />
                  <button type="button" className="wa-send" onClick={() => void send()} disabled={!text.trim() || !!busy || (newChat && !newPhone.trim())} aria-label="Send">
                    {busy === 'send' ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-paper-plane" />}
                  </button>
                </div>
              </footer>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
