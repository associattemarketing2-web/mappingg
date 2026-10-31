'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatTile } from './SeoCharts';

// s-admin → WhatsApp. Four views:
//   Chats        WhatsApp-style inbox: every conversation, AI auto-reply switch
//                per chat, manual replies, AI-drafted replies, edit / delete.
//   OTP          every verification code sent (codes themselves are never stored).
//   Automations  buyer welcome template, AI replies, and how each is doing.
//   Bulk send    upload a file of numbers, pick an approved template, shoot it to all.
// Data: /api/admin/whatsapp. Polls while the tab is visible.

type Author = 'customer' | 'ai' | 'staff' | 'system';
interface Msg {
  id: string; phone: string; direction: 'in' | 'out'; author: Author; by?: string; kind: string; body: string;
  template?: string; purpose?: string; status: string; error?: string; edited_at?: string; deleted?: boolean; derived?: boolean; created_at: string;
  phone_display?: string;
}
interface Chat {
  phone: string; phone_display: string; name: string; wa_name: string; auto_reply: boolean; last_text: string;
  last_author: Author | null; last_at: string | null; last_in_at: string | null; unread: number; has_chat: boolean;
  lead: { id: string; status: string; name: string } | null;
}
interface Overview {
  chats: Chat[];
  stats: { chats: number; numbers: number; unread: number; active_today: number; otp_total: number; ai_replies: number; leads: number };
  config: { whatsapp: boolean; ai: boolean; webhook: boolean };
}
interface LogView {
  rows: Msg[]; total: number; today: number; last7: number;
  by_purpose: Record<string, number>; by_status: Record<string, number>; days: Record<string, number>;
}

type Flash = (m: string, e?: boolean) => void;
const API = '/api/admin/whatsapp';

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data as T;
}

/** Runs `fn` now and every `ms` while the browser tab is visible. */
function usePoll(fn: () => void, ms: number, deps: unknown[]) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const t = setInterval(() => { if (document.visibilityState === 'visible') ref.current(); }, ms);
    return () => clearInterval(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

const IST = { timeZone: 'Asia/Kolkata' } as const;
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', IST);
function listTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (dayKey(iso) === dayKey(new Date().toISOString())) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', ...IST });
  if (Date.now() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString('en-IN', { weekday: 'short', ...IST });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...IST });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', ...IST });
function dayLabel(iso: string) {
  const k = dayKey(iso);
  if (k === dayKey(new Date().toISOString())) return 'Today';
  if (k === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', ...IST });
}
const fullTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...IST });

const initials = (s: string) => (s.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '#').toUpperCase();
const within24h = (iso: string | null) => Boolean(iso && Date.now() - Date.parse(iso) < 24 * 3_600_000);

const LEAD_LABEL: Record<string, string> = {
  new: 'New lead', contacted: 'Contacted', not_answered: 'Not answered', call_back: 'Call back', site_visit: 'Site visit',
  negotiation: 'Negotiation', won: 'Booked', lost: 'Lost', spam: 'Spam',
};
const PURPOSE_LABEL: Record<string, string> = {
  signup: 'Sign-up', login: 'WhatsApp sign-in', reset: 'Password reset', buyer_welcome: 'Buyer welcome', ai_reply: 'AI replies', bulk: 'Bulk send',
};

function Ticks({ m }: { m: Msg }) {
  if (m.direction !== 'out') return null;
  if (m.status === 'failed') return <i className="fas fa-circle-exclamation wa-tick fail" title={m.error ? `Not delivered: ${m.error}` : 'Not delivered'} />;
  if (m.status === 'read') return <i className="fas fa-check-double wa-tick read" title="Read" />;
  if (m.status === 'delivered') return <i className="fas fa-check-double wa-tick" title="Delivered" />;
  return <i className="fas fa-check wa-tick" title="Sent" />;
}

function authorLabel(m: Msg) {
  if (m.author === 'ai') return { text: 'AI assistant', icon: 'fa-robot', cls: 'ai' };
  if (m.author === 'staff') return { text: m.by ? m.by.split('@')[0] : 'Team', icon: 'fa-user-tie', cls: 'staff' };
  if (m.author === 'system') return { text: m.kind === 'otp' ? 'OTP' : 'Automation', icon: m.kind === 'otp' ? 'fa-key' : 'fa-bolt', cls: 'sys' };
  return null;
}

/* --------------------------------- Chats --------------------------------- */

function ChatsView({ data, reload, flash, onOpenLead }: { data: Overview | null; reload: () => void; flash: Flash; onOpenLead?: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'conv' | 'unread' | 'ai' | 'manual' | 'leads'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<{ chat: Chat; messages: Msg[] } | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Msg | null>(null);
  const [busy, setBusy] = useState<'' | 'send' | 'draft' | 'toggle'>('');
  const [menu, setMenu] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(0);

  const loadThread = useCallback(async (phone: string) => {
    try {
      const t = await api<{ chat: Chat; messages: Msg[] }>(`${API}?phone=${phone}`);
      setThread((prev) => (prev && prev.chat.phone !== phone ? prev : t));
    } catch (e) { flash((e as Error).message, true); }
  }, [flash]);
  usePoll(() => { if (open) void loadThread(open); }, 5000, [open]);
  useEffect(() => { setThread(null); setText(''); setEditing(null); lastCount.current = 0; }, [open]);
  // Scroll to the newest message when the chat opens or a message arrives.
  useEffect(() => {
    const n = thread?.messages.length || 0;
    if (n !== lastCount.current) { bottom.current?.scrollIntoView({ block: 'end' }); lastCount.current = n; }
  }, [thread]);

  const chats = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return (data?.chats || []).filter((c) => {
      if (filter === 'conv' && !c.has_chat) return false;
      if (filter === 'unread' && !c.unread) return false;
      if (filter === 'ai' && !c.auto_reply) return false;
      if (filter === 'manual' && c.auto_reply) return false;
      if (filter === 'leads' && !c.lead) return false;
      if (!term) return true;
      return c.name.toLowerCase().includes(term) || c.last_text.toLowerCase().includes(term) || (digits.length >= 3 && c.phone.includes(digits));
    });
  }, [data, q, filter]);

  const chat = thread?.chat || data?.chats.find((c) => c.phone === open) || null;
  const canText = within24h(chat?.last_in_at || null);

  async function toggleAuto() {
    if (!chat) return;
    setBusy('toggle');
    try {
      await api(API, { action: 'auto_reply', phone: chat.phone, on: !chat.auto_reply });
      setThread((t) => (t ? { ...t, chat: { ...t.chat, auto_reply: !chat.auto_reply } } : t));
      flash(!chat.auto_reply ? 'AI auto-reply is on for this chat' : 'AI auto-reply is off — reply by hand');
      reload();
    } catch (e) { flash((e as Error).message, true); } finally { setBusy(''); }
  }

  async function send() {
    const body = text.trim();
    if (!chat || !body) return;
    setBusy('send');
    try {
      if (editing) {
        const r = await api<{ message: Msg }>(API, { action: 'edit', id: editing.id, text: body });
        setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (m.id === editing.id ? r.message : m)) } : t));
        setEditing(null);
      } else {
        const r = await api<{ message: Msg }>(API, { action: 'send', phone: chat.phone, text: body });
        setThread((t) => (t ? { ...t, messages: [...t.messages, r.message] } : t));
      }
      setText('');
      reload();
    } catch (e) {
      flash((e as Error).message, true);
      void loadThread(chat.phone);
    } finally { setBusy(''); }
  }

  async function draft() {
    if (!chat) return;
    setBusy('draft');
    try {
      const r = await api<{ text: string }>(API, { action: 'draft', phone: chat.phone });
      if (r.text) { setText(r.text); setEditing(null); box.current?.focus(); } else flash('Nothing to reply to — the last message is already answered.');
    } catch (e) { flash((e as Error).message, true); } finally { setBusy(''); }
  }

  async function remove(m: Msg) {
    setMenu(null);
    if (!window.confirm('Delete this message from the Mappingg chat record? (WhatsApp cannot remove it from the customer\'s phone.)')) return;
    try {
      const r = await api<{ message: Msg }>(API, { action: 'delete', id: m.id });
      setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === m.id ? r.message : x)) } : t));
    } catch (e) { flash((e as Error).message, true); }
  }

  const editable = (m: Msg) => m.direction === 'out' && (m.author === 'ai' || m.author === 'staff') && !m.deleted;

  return (
    <div className={`wa-shell${open ? ' has-open' : ''}`}>
      <aside className="wa-list">
        <div className="wa-list-head">
          <label className="acs-search">
            <i className="fas fa-magnifying-glass" />
            <input type="search" placeholder="Search name, number or message" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
          </label>
          <div className="wa-filters" role="tablist" aria-label="Filter chats">
            {([['all', 'All'], ['conv', 'Conversations'], ['unread', 'Unread'], ['ai', 'AI on'], ['manual', 'Manual'], ['leads', 'Leads']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        <ul className="wa-items">
          {!data ? <li className="wa-empty"><i className="fas fa-spinner fa-spin" /> Loading chats…</li>
            : !chats.length ? <li className="wa-empty">{data.chats.length ? 'No chat matches.' : 'No WhatsApp chats yet. When someone messages your WhatsApp number, the chat shows up here.'}</li>
              : chats.map((c) => (
                <li key={c.phone}>
                  <button type="button" className={`wa-item${open === c.phone ? ' on' : ''}`} onClick={() => setOpen(c.phone)}>
                    <span className="wa-avatar" aria-hidden>{initials(c.name || c.phone_display.replace('+', ''))}</span>
                    <span className="wa-item-main">
                      <span className="wa-item-top">
                        <b>{c.name || c.phone_display}</b>
                        <time className={c.unread ? 'unread' : ''}>{listTime(c.last_at)}</time>
                      </span>
                      <span className="wa-item-bottom">
                        <span className="wa-preview">
                          {c.last_author === 'ai' && <i className="fas fa-robot" title="AI" />}
                          {c.last_author === 'staff' && <i className="fas fa-user-tie" title="Team" />}
                          {c.last_text}
                        </span>
                        {c.unread > 0 && <span className="wa-unread">{c.unread}</span>}
                      </span>
                      <span className="wa-item-tags">
                        {c.has_chat ? <span className={`wa-tag ${c.auto_reply ? 'ai' : 'manual'}`}>{c.auto_reply ? 'AI on' : 'Manual'}</span> : <span className="wa-tag manual">OTP / automation only</span>}
                        {c.lead && <span className="wa-tag lead">{LEAD_LABEL[c.lead.status] || 'Lead'}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
        </ul>
      </aside>

      <section className="wa-chat" aria-label="Conversation">
        {!chat ? (
          <div className="wa-placeholder">
            <i className="fab fa-whatsapp" />
            <h3>Mappingg WhatsApp</h3>
            <p>Pick a chat to read the full conversation and reply. With <b>AI on</b>, the assistant answers project and real-estate questions by itself and saves the customer as a lead.</p>
          </div>
        ) : (<>
          <header className="wa-chat-head">
            <button type="button" className="wa-back" onClick={() => setOpen(null)} aria-label="Back to chats"><i className="fas fa-arrow-left" /></button>
            <span className="wa-avatar" aria-hidden>{initials(chat.name || chat.phone_display.replace('+', ''))}</span>
            <div className="wa-chat-who">
              <b>{chat.name || chat.phone_display}</b>
              <small>
                {chat.phone_display}
                {chat.wa_name && chat.wa_name !== chat.name ? ` · WhatsApp: ${chat.wa_name}` : ''}
                {chat.last_in_at ? ` · last message ${fullTime(chat.last_in_at)}` : ''}
              </small>
            </div>
            <div className="wa-chat-actions">
              {chat.lead && (
                <button type="button" className="adm-btn ghost sm" onClick={() => onOpenLead?.(chat.lead!.id)} disabled={!onOpenLead} title="Open this lead in Leads → Contact form">
                  <i className="fas fa-address-book" /> {LEAD_LABEL[chat.lead.status] || 'Lead'}
                </button>
              )}
              <a className="adm-btn ghost sm" href={`https://wa.me/${chat.phone}`} target="_blank" rel="noreferrer" title="Open in WhatsApp"><i className="fab fa-whatsapp" /></a>
              <button
                type="button" role="switch" aria-checked={chat.auto_reply} disabled={busy === 'toggle'}
                className={`wa-switch${chat.auto_reply ? ' on' : ''}`} onClick={toggleAuto}
                title={chat.auto_reply ? 'The AI replies automatically. Click to switch off and reply by hand.' : 'Only the team replies. Click to let the AI reply automatically.'}
              >
                <span className="knob" /> <span className="lbl"><i className="fas fa-robot" /> Auto reply {chat.auto_reply ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </header>

          <div className="wa-thread" onClick={() => setMenu(null)}>
            {!thread ? <p className="wa-loading"><i className="fas fa-spinner fa-spin" /> Loading messages…</p>
              : thread.messages.map((m, i) => {
                const prev = thread.messages[i - 1];
                const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                const who = authorLabel(m);
                const showWho = who && (!prev || prev.author !== m.author || prev.by !== m.by || newDay);
                return (
                  <div key={m.id}>
                    {newDay && <div className="wa-day"><span>{dayLabel(m.created_at)}</span></div>}
                    <div className={`wa-row ${m.direction}`}>
                      <div className={`wa-bubble ${m.direction}${who ? ` ${who.cls}` : ''}${m.deleted ? ' deleted' : ''}${m.status === 'failed' ? ' failed' : ''}`}>
                        {showWho && <span className={`wa-who ${who!.cls}`}><i className={`fas ${who!.icon}`} /> {who!.text}{m.template ? ` · ${m.template}` : ''}</span>}
                        {m.deleted
                          ? <p className="wa-text"><i className="fas fa-ban" /> This message was deleted</p>
                          : <p className="wa-text">{m.body}</p>}
                        <span className="wa-meta">
                          {m.edited_at && !m.deleted && <span>Edited</span>}
                          <time title={fullTime(m.created_at)}>{clock(m.created_at)}</time>
                          <Ticks m={m} />
                        </span>
                        {editable(m) && (
                          <>
                            <button type="button" className="wa-more" aria-label="Message options" onClick={(e) => { e.stopPropagation(); setMenu(menu === m.id ? null : m.id); }}><i className="fas fa-chevron-down" /></button>
                            {menu === m.id && (
                              <div className="wa-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                                <button type="button" role="menuitem" onClick={() => { setEditing(m); setText(m.body); setMenu(null); box.current?.focus(); }}><i className="fas fa-pen" /> Edit</button>
                                <button type="button" role="menuitem" onClick={() => { void navigator.clipboard?.writeText(m.body); setMenu(null); flash('Copied'); }}><i className="fas fa-copy" /> Copy</button>
                                <button type="button" role="menuitem" className="danger" onClick={() => remove(m)}><i className="fas fa-trash" /> Delete</button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            <div ref={bottom} />
          </div>

          <footer className="wa-compose">
            {!canText && (
              <p className="wa-note warn"><i className="fas fa-clock" /> More than 24 hours since this customer last wrote. WhatsApp only delivers free-text replies within 24 hours — the reply may not reach them until they message again.</p>
            )}
            {chat.auto_reply && canText && !editing && (
              <p className="wa-note"><i className="fas fa-robot" /> AI is answering this chat automatically. Anything you send goes out as well — switch Auto reply off to take over.</p>
            )}
            {editing && (
              <p className="wa-note edit">
                <i className="fas fa-pen" /> Editing a sent message — this only changes Mappingg&apos;s record; WhatsApp can&apos;t edit what the customer already received.
                <button type="button" onClick={() => { setEditing(null); setText(''); }}>Cancel</button>
              </p>
            )}
            <div className="wa-compose-row">
              <button type="button" className="wa-ai-btn" onClick={draft} disabled={!!busy || !data?.config.ai} title={data?.config.ai ? 'Let the AI write a reply for you to check and send' : 'Set ANTHROPIC_API_KEY to enable AI'}>
                {busy === 'draft' ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-wand-magic-sparkles" />}<span> AI draft</span>
              </button>
              <textarea
                ref={box} rows={1} value={text} placeholder={editing ? 'Edit message' : 'Type a reply'} aria-label="Reply"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } if (e.key === 'Escape' && editing) { setEditing(null); setText(''); } }}
              />
              <button type="button" className="wa-send" onClick={send} disabled={!text.trim() || !!busy} aria-label={editing ? 'Save edit' : 'Send'}>
                {busy === 'send' ? <i className="fas fa-spinner fa-spin" /> : <i className={`fas ${editing ? 'fa-check' : 'fa-paper-plane'}`} />}
              </button>
            </div>
          </footer>
        </>)}
      </section>
    </div>
  );
}

/* ------------------------------ OTP / Automations ------------------------------ */

function Days({ days }: { days: Record<string, number> }) {
  const entries = Object.entries(days);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="wa-days" role="img" aria-label="Messages per day, last 14 days">
      {entries.map(([d, v]) => (
        <div key={d} className="wa-day-col" title={`${new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${v}`}>
          <span className="v">{v || ''}</span>
          <span className="bar" style={{ height: `${Math.max(v ? 6 : 2, (v / max) * 100)}%` }} />
          <span className="d">{new Date(d + 'T00:00:00').getDate()}</span>
        </div>
      ))}
    </div>
  );
}

function LogTable({ rows, kind }: { rows: Msg[]; kind: 'otp' | 'auto' }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const digits = q.replace(/\D/g, '');
  const list = rows.filter((m) => (!digits || m.phone.includes(digits)) && (!status || (status === 'failed' ? m.status === 'failed' : status === 'ok' ? m.status !== 'failed' : true)));
  const st = (m: Msg) => (m.derived ? { t: 'Sent (from records)', c: 'muted' } : m.status === 'failed' ? { t: 'Failed', c: 'bad' } : m.status === 'read' ? { t: 'Read', c: 'ok' } : m.status === 'delivered' ? { t: 'Delivered', c: 'ok' } : { t: 'Sent', c: 'muted' });
  return (
    <>
      <div className="wa-log-tools">
        <label className="acs-search"><i className="fas fa-magnifying-glass" /><input type="search" placeholder="Search number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search number" /></label>
        <select className="crm-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option><option value="ok">Sent / delivered</option><option value="failed">Failed</option>
        </select>
      </div>
      <div className="wa-table-wrap">
        <table className="wa-table">
          <thead><tr><th>When</th><th>Number</th><th>{kind === 'otp' ? 'Purpose' : 'Automation'}</th>{kind === 'auto' && <th>Message</th>}<th>Status</th></tr></thead>
          <tbody>
            {!list.length ? <tr><td colSpan={kind === 'auto' ? 5 : 4} className="muted">Nothing here yet.</td></tr> : list.slice(0, 300).map((m) => {
              const s = st(m);
              return (
                <tr key={m.id}>
                  <td>{fullTime(m.created_at)}</td>
                  <td className="mono">{m.phone_display}</td>
                  <td>{kind === 'otp' ? PURPOSE_LABEL[m.purpose || 'signup'] : m.author === 'ai' ? 'AI reply' : PURPOSE_LABEL[m.purpose || ''] || m.template}</td>
                  {kind === 'auto' && <td className="wa-cell-text">{m.deleted ? <i className="muted">Deleted</i> : m.body}</td>}
                  <td><span className={`adm-badge ${s.c === 'bad' ? 'wa-bad' : s.c}`} title={m.derived ? 'Sent before message logging started — rebuilt from the account record; delivery status unknown' : m.error || ''}>{s.t}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LogView({ kind, config }: { kind: 'otp' | 'auto'; config?: Overview['config'] }) {
  const [d, setD] = useState<LogView | null>(null);
  const [err, setErr] = useState('');
  usePoll(() => { api<LogView>(`${API}?view=${kind}`).then(setD, (e) => setErr((e as Error).message)); }, 20_000, [kind]);
  if (err && !d) return <div className="adm-panel"><p className="muted"><i className="fas fa-triangle-exclamation" /> {err}</p></div>;
  if (!d) return <div className="adm-panel"><p className="muted"><i className="fas fa-spinner fa-spin" /> Loading…</p></div>;
  const failed = d.by_status.failed || 0;
  const delivered = (d.by_status.delivered || 0) + (d.by_status.read || 0);
  const purposes = kind === 'otp' ? ['signup', 'login', 'reset'] : Object.keys(d.by_purpose);
  return (
    <>
      <div className="viz-tiles">
        <StatTile label={kind === 'otp' ? 'OTPs sent (all time)' : 'Automated messages'} value={d.total.toLocaleString('en-IN')} />
        <StatTile label="Today" value={d.today.toLocaleString('en-IN')} />
        <StatTile label="Last 7 days" value={d.last7.toLocaleString('en-IN')} />
        <StatTile label="Failed" value={failed.toLocaleString('en-IN')} note={d.total ? `${Math.round((delivered / d.total) * 100)}% confirmed delivered` : undefined} />
      </div>

      <div className="wa-two">
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>{kind === 'otp' ? 'OTPs by purpose' : 'By automation'}</h3></div>
          <ul className="wa-split">
            {purposes.map((p) => {
              const v = d.by_purpose[p] || 0;
              return (
                <li key={p}>
                  <span>{PURPOSE_LABEL[p] || p}</span>
                  <span className="bar"><span style={{ width: `${d.total ? (v / d.total) * 100 : 0}%` }} /></span>
                  <b>{v.toLocaleString('en-IN')}</b>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Last 14 days</h3></div>
          <Days days={d.days} />
        </div>
      </div>

      {kind === 'auto' && config && (
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Automations</h3></div>
          <div className="wa-autos">
            <div className="wa-auto">
              <i className="fas fa-key" /><div><b>OTP verification</b><span>Template <code>mapping_mobile_verification</code> — sign-up, WhatsApp sign-in, password reset.</span></div>
              <span className={`adm-badge ${config.whatsapp ? 'ok' : 'wa-bad'}`}>{config.whatsapp ? 'Active' : 'Not set up'}</span>
            </div>
            <div className="wa-auto">
              <i className="fas fa-user-check" /><div><b>Buyer welcome</b><span>Template <code>byres_account_created</code> — sent the moment a buyer account is created.</span></div>
              <span className={`adm-badge ${config.whatsapp ? 'ok' : 'wa-bad'}`}>{config.whatsapp ? 'Active' : 'Not set up'}</span>
            </div>
            <div className="wa-auto">
              <i className="fas fa-robot" /><div><b>AI auto-reply</b><span>Answers incoming messages from your project data, asks for name &amp; requirement, saves the lead in Leads → Contact form. Switch it off per chat.</span></div>
              <span className={`adm-badge ${config.ai && config.webhook ? 'ok' : 'wa-bad'}`}>{config.ai && config.webhook ? 'Active' : !config.webhook ? 'Webhook not set up' : 'AI key missing'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>{kind === 'otp' ? 'Every OTP sent' : 'Recent automated messages'}</h3><span className="muted">{kind === 'otp' ? 'The codes themselves are never stored or shown.' : ''}</span></div>
        <LogTable rows={d.rows} kind={kind} />
      </div>
    </>
  );
}

/* --------------------------------- Bulk send --------------------------------- */

interface Recipient { phone: string; phone_display: string; name: string }
interface Extracted { file_name: string; recipients: Recipient[]; duplicates: number; invalid: string[]; format: string }
interface Campaign { id: string; template: string; text: string; by: string; started: string; total: number; failed: number; delivered: number; read: number }
type SendState = { ok: boolean; error?: string };

const BULK_API = `${API}/bulk`;
const BATCH = 25;

/** Shoots the buyer welcome template (the one sent when a buyer signs up), or a typed message, to every uploaded number. */
function BulkView({ flash, configured }: { flash: Flash; configured: boolean }) {
  const [template, setTemplate] = useState('');
  const [mode, setMode] = useState<'template' | 'text'>('template');
  const [message, setMessage] = useState('');
  const [list, setList] = useState<Recipient[]>([]);
  const [info, setInfo] = useState<{ files: string[]; duplicates: number; invalid: string[] }>({ files: [], duplicates: 0, invalid: [] });
  const [paste, setPaste] = useState('');
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [q, setQ] = useState('');
  const [state, setState] = useState<Record<string, SendState>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const stop = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef(list);
  listRef.current = list;

  const loadCampaigns = useCallback(() => {
    api<{ template: string; campaigns: Campaign[] }>(BULK_API).then((d) => { setTemplate(d.template); setCampaigns(d.campaigns); }, () => setCampaigns([]));
  }, []);
  usePoll(loadCampaigns, 30_000, []);

  const sending = progress !== null && progress.done < progress.total;

  /** Adds numbers read from a file or pasted text, skipping ones already in the list. */
  async function read(form: FormData, label: string) {
    setReading(true);
    try {
      const r = await fetch(BULK_API, { method: 'POST', credentials: 'same-origin', body: form });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.error) throw new Error(b?.error?.message || `Request failed (${r.status})`);
      const d = b.data as Extracted;
      // listRef, not a state updater: several files can be read at once, and the counts are needed right here.
      const have = new Set(listRef.current.map((x) => x.phone));
      const fresh = d.recipients.filter((x) => { if (have.has(x.phone)) return false; have.add(x.phone); return true; });
      const added = fresh.length;
      const dup = d.duplicates + d.recipients.length - added;
      listRef.current = [...listRef.current, ...fresh];
      setList(listRef.current);
      setInfo((i) => ({ files: [...i.files, label || d.file_name || d.format], duplicates: i.duplicates + dup, invalid: [...i.invalid, ...d.invalid].slice(0, 300) }));
      flash(`${d.format}: ${d.recipients.length} number${d.recipients.length === 1 ? '' : 's'} found${added < d.recipients.length ? ` (${d.recipients.length - added} already in the list)` : ''}`);
    } catch (e) { flash((e as Error).message, true); } finally { setReading(false); }
  }
  function onFiles(files: FileList | null) {
    for (const f of Array.from(files || [])) { const fd = new FormData(); fd.append('file', f); void read(fd, f.name); }
    if (fileInput.current) fileInput.current.value = '';
  }
  function addPasted() {
    if (!paste.trim()) return;
    const fd = new FormData(); fd.append('text', paste);
    void read(fd, 'Pasted list').then(() => setPaste(''));
  }
  function clearAll() {
    if (sending) return;
    setList([]); setInfo({ files: [], duplicates: 0, invalid: [] }); setState({}); setProgress(null);
  }

  async function shoot(only?: Recipient[]) {
    const targets = only || list;
    if (!targets.length) { flash('Upload a file with numbers first', true); return; }
    const text = message.trim();
    if (mode === 'text' && !text) { flash('Type the message first', true); return; }
    const what = mode === 'text' ? `this message:\n\n"${text.slice(0, 300)}${text.length > 300 ? '…' : ''}"\n\n` : `template "${template || 'buyer welcome'}" `;
    if (!window.confirm(`Send WhatsApp ${what}to ${targets.length.toLocaleString('en-IN')} number${targets.length === 1 ? '' : 's'} now?\n\nThis cannot be undone.`)) return;
    const campaign = `bulk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    stop.current = false;
    setState((s) => { const n = { ...s }; targets.forEach((t) => delete n[t.phone]); return n; });
    setProgress({ done: 0, total: targets.length });
    let ok = 0, failed = 0;
    for (let i = 0; i < targets.length && !stop.current; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      try {
        const r = await api<{ results: { phone: string; ok: boolean; error?: string }[] }>(BULK_API, {
          action: 'send', campaign, mode, ...(mode === 'text' ? { text } : {}),
          recipients: batch.map(({ phone, name }) => ({ phone, name })),
        });
        setState((s) => { const n = { ...s }; r.results.forEach((x) => { n[x.phone] = { ok: x.ok, error: x.error }; }); return n; });
        r.results.forEach((x) => (x.ok ? ok++ : failed++));
        // Every number in the batch failed for the same reason (e.g. "Account Deactivated") — the rest would too.
        const reasons = new Set(r.results.map((x) => (x.ok ? '' : x.error)));
        if (r.results.length && !r.results.some((x) => x.ok) && reasons.size === 1) {
          flash(`Stopped — ${[...reasons][0]}`, true);
          stop.current = true;
        }
      } catch (e) {
        // The whole batch was refused (e.g. WhatsApp not set up) — mark it and stop; the rest would fail the same way.
        const error = (e as Error).message;
        setState((s) => { const n = { ...s }; batch.forEach((x) => { n[x.phone] = { ok: false, error }; }); return n; });
        failed += batch.length;
        flash(error, true);
        stop.current = true;
      }
      setProgress({ done: Math.min(targets.length, i + batch.length), total: targets.length });
    }
    setProgress((p) => (p ? { ...p, total: p.done } : p));
    flash(`${stop.current && ok + failed < targets.length ? 'Stopped. ' : ''}${ok} sent${failed ? `, ${failed} failed` : ''}`, failed > 0 && !ok);
    loadCampaigns();
  }

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return list.filter((r) => !term || r.name.toLowerCase().includes(term) || (digits.length >= 3 && r.phone.includes(digits)));
  }, [list, q]);
  const position = useMemo(() => new Map(list.map((r, i) => [r.phone, i + 1])), [list]);
  const sentCount = Object.values(state).filter((s) => s.ok).length;
  const failedList = list.filter((r) => state[r.phone] && !state[r.phone].ok);

  return (
    <>
      {!configured && <div className="wa-setup"><i className="fas fa-plug-circle-exclamation" /> <div><b>Sending is not set up</b><span>Add WHATSAPP_API_URL and WHATSAPP_API_KEY on the server before shooting.</span></div></div>}

      <div className="adm-panel">
        <div className="adm-panel-head"><h3><i className="fas fa-message" /> What to send</h3></div>
        <div className="wa-filters wa-bulk-mode" role="tablist" aria-label="What to send">
          <button type="button" role="tab" aria-selected={mode === 'template'} className={mode === 'template' ? 'on' : ''} onClick={() => setMode('template')} disabled={sending}>
            <i className="fas fa-user-check" /> Template
          </button>
          <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')} disabled={sending}>
            <i className="fas fa-keyboard" /> Type a message
          </button>
        </div>
        {mode === 'template' ? (
          <p className="wa-bulk-desc"><b>Template: <code>{template || 'buyers_account_created'}</code></b> — the same congratulations message a buyer gets on sign-up.</p>
        ) : (
          <div className="adm-field wa-bulk-msg">
            <label>Message <small>— type <code>{'{name}'}</code> to put each person&apos;s name</small></label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} placeholder={'Hi {name}, new projects are live on Mappingg…'} disabled={sending} />
            <small className="muted">{message.length} / 4000</small>
            <p className="wa-note warn"><i className="fas fa-clock" /> WhatsApp only delivers a typed message to people who messaged you in the last 24 hours. For everyone else, use the Template.</p>
          </div>
        )}
      </div>

        <div className="adm-panel">
          <div className="adm-panel-head"><h3><i className="fas fa-upload" /> Numbers</h3>{list.length > 0 && <button type="button" className="adm-btn ghost sm" onClick={clearAll} disabled={sending}><i className="fas fa-trash" /> Clear</button>}</div>
          <label
            className={`wa-drop${drag ? ' on' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
          >
            <input ref={fileInput} type="file" multiple accept=".csv,.txt,.xlsx,.xls,.pdf,.docx,.vcf,text/*" onChange={(e) => onFiles(e.target.files)} disabled={sending} hidden />
            {reading ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-cloud-arrow-up" />}
            <b>{reading ? 'Reading file…' : 'Drop a file here or click to upload'}</b>
            <span>CSV, Excel (.xlsx), PDF, Word (.docx), contacts (.vcf) or text. A &quot;name&quot; column is picked up too.</span>
          </label>
          <div className="adm-field wa-bulk-paste">
            <label>Or paste numbers <small>(one per line, or comma separated)</small></label>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'9876543210\n+91 98765 43211, Rahul'} disabled={sending} />
            <button type="button" className="adm-btn ghost sm" onClick={addPasted} disabled={!paste.trim() || reading || sending}><i className="fas fa-plus" /> Add to list</button>
          </div>
          {info.files.length > 0 && (
            <p className="muted wa-bulk-info">
              From: {info.files.join(', ')} · {info.duplicates} duplicate{info.duplicates === 1 ? '' : 's'} removed
              {info.invalid.length > 0 && <> · <span title={info.invalid.join('\n')}>{info.invalid.length} invalid skipped</span></>}
            </p>
          )}
        </div>

      <div className="adm-panel">
        <div className="wa-bulk-bar">
          <div>
            <b>{list.length.toLocaleString('en-IN')} number{list.length === 1 ? '' : 's'}</b>
            {Object.keys(state).length > 0 && <span className="muted"> · {sentCount} sent{failedList.length ? ` · ${failedList.length} failed` : ''}</span>}
          </div>
          {progress && (
            <div className="wa-bulk-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              <small>{progress.done} / {progress.total}</small>
            </div>
          )}
          <div className="wa-bulk-actions">
            {sending
              ? <button type="button" className="adm-btn danger" onClick={() => { stop.current = true; }}><i className="fas fa-stop" /> Stop</button>
              : <>
                {failedList.length > 0 && <button type="button" className="adm-btn ghost" onClick={() => shoot(failedList)}><i className="fas fa-rotate-right" /> Retry {failedList.length} failed</button>}
                <button type="button" className="adm-btn primary wa-shoot" onClick={() => shoot()} disabled={!list.length || !configured || (mode === 'text' && !message.trim())}>
                  <i className="fas fa-paper-plane" /> Shoot to {list.length.toLocaleString('en-IN')}
                </button>
              </>}
          </div>
        </div>
        {list.length > 0 && (
          <>
            <div className="wa-log-tools"><label className="acs-search"><i className="fas fa-magnifying-glass" /><input type="search" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search numbers" /></label></div>
            <div className="wa-table-wrap wa-bulk-table">
              <table className="wa-table">
                <thead><tr><th>#</th><th>Number</th><th>Name</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {shown.slice(0, 1000).map((r) => {
                    const s = state[r.phone];
                    return (
                      <tr key={r.phone}>
                        <td className="muted">{position.get(r.phone)}</td>
                        <td className="mono">{r.phone_display}</td>
                        <td>{r.name || <span className="muted">—</span>}</td>
                        <td>{!s ? <span className="adm-badge muted">Ready</span> : s.ok ? <span className="adm-badge ok">Sent</span> : <span className="adm-badge wa-bad" title={s.error}>Failed</span>}{s?.error && <small className="wa-bulk-err">{s.error}</small>}</td>
                        <td><button type="button" className="adm-btn ghost sm" onClick={() => setList((l) => l.filter((x) => x.phone !== r.phone))} disabled={sending} aria-label="Remove number"><i className="fas fa-xmark" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length > 1000 && <p className="muted">Showing the first 1,000 — all {shown.length.toLocaleString('en-IN')} will be sent.</p>}
            </div>
          </>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>Past bulk sends</h3><span className="muted">Delivered / read update as WhatsApp reports them.</span></div>
        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead><tr><th>When</th><th>Sent</th><th>By</th><th>Numbers</th><th>Delivered</th><th>Read</th><th>Failed</th></tr></thead>
            <tbody>
              {!campaigns ? <tr><td colSpan={7} className="muted"><i className="fas fa-spinner fa-spin" /> Loading…</td></tr>
                : !campaigns.length ? <tr><td colSpan={7} className="muted">No bulk sends yet.</td></tr>
                  : campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>{fullTime(c.started)}</td><td className="wa-cell-text">{c.text ? <><i className="fas fa-keyboard muted" /> {c.text}</> : <code>{c.template}</code>}</td><td>{c.by ? c.by.split('@')[0] : '—'}</td>
                      <td>{c.total.toLocaleString('en-IN')}</td><td>{c.delivered.toLocaleString('en-IN')}</td><td>{c.read.toLocaleString('en-IN')}</td>
                      <td>{c.failed ? <span className="adm-badge wa-bad">{c.failed.toLocaleString('en-IN')}</span> : 0}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* --------------------------------- Shell --------------------------------- */

export default function WhatsAppPanel({ flash, onOpenLead }: { flash: Flash; onOpenLead?: (id: string) => void }) {
  const [view, setView] = useState<'chats' | 'otp' | 'auto' | 'bulk'>('chats');
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api<Overview>(API).then((d) => { setData(d); setErr(''); }, (e) => setErr((e as Error).message)); }, []);
  usePoll(load, 15_000, []);
  const s = data?.stats;
  const missing = data ? [
    !data.config.whatsapp && 'WHATSAPP_API_URL / WHATSAPP_API_KEY (sending)',
    !data.config.webhook && 'WHATSAPP_WEBHOOK_SECRET + the webhook URL in GABS (incoming messages)',
    !data.config.ai && 'ANTHROPIC_API_KEY (AI replies)',
  ].filter(Boolean) : [];

  return (
    <div className="wa-panel">
      {missing.length > 0 && (
        <div className="wa-setup"><i className="fas fa-plug-circle-exclamation" /> <div><b>Finish the WhatsApp setup</b><span>Missing on the server: {missing.join(' · ')}</span></div></div>
      )}
      {err && !data && <p className="muted"><i className="fas fa-triangle-exclamation" /> {err}</p>}

      <div className="viz-tiles wa-tiles">
        <StatTile label="Conversations" value={s ? s.chats.toLocaleString('en-IN') : '—'} note={s ? `${s.numbers.toLocaleString('en-IN')} numbers messaged · ${s.active_today} active today` : undefined} />
        <StatTile label="Unread" value={s ? String(s.unread) : '—'} />
        <StatTile label="AI replies sent" value={s ? s.ai_replies.toLocaleString('en-IN') : '—'} />
        <StatTile label="WhatsApp leads" value={s ? s.leads.toLocaleString('en-IN') : '—'} note={s ? `${s.otp_total.toLocaleString('en-IN')} OTPs sent` : undefined} />
      </div>

      <div className="lead-src" role="tablist" aria-label="WhatsApp view">
        <button role="tab" aria-selected={view === 'chats'} className={view === 'chats' ? 'on' : ''} onClick={() => setView('chats')}>
          <i className="fas fa-comments" /> Chats {s?.unread ? <span className="n">{s.unread}</span> : null}
        </button>
        <button role="tab" aria-selected={view === 'otp'} className={view === 'otp' ? 'on' : ''} onClick={() => setView('otp')}>
          <i className="fas fa-key" /> OTP <span className="n">{s?.otp_total ?? 0}</span>
        </button>
        <button role="tab" aria-selected={view === 'auto'} className={view === 'auto' ? 'on' : ''} onClick={() => setView('auto')}>
          <i className="fas fa-bolt" /> Automations
        </button>
        <button role="tab" aria-selected={view === 'bulk'} className={view === 'bulk' ? 'on' : ''} onClick={() => setView('bulk')}>
          <i className="fas fa-paper-plane" /> Bulk send
        </button>
      </div>

      {view === 'chats' && <ChatsView data={data} reload={load} flash={flash} onOpenLead={onOpenLead} />}
      {view === 'otp' && <LogView kind="otp" />}
      {view === 'auto' && <LogView kind="auto" config={data?.config} />}
      {view === 'bulk' && <BulkView flash={flash} configured={data?.config.whatsapp ?? true} />}
    </div>
  );
}
