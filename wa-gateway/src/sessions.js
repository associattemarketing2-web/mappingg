import crypto from 'node:crypto';
import makeWASocket, {
  Browsers, DisconnectReason, downloadMediaMessage, isJidBroadcast, isJidGroup, isJidNewsletter, isJidStatusBroadcast,
  isLidUser, isPnUser, jidNormalizedUser, makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { clearAuth, usePgAuthState } from './auth-state.js';
import { decrypt, encrypt, q } from './db.js';
import { ackStatus, laterStatus, MEDIA_KINDS, parseMessage, preview } from './parse.js';

// One linked WhatsApp = one Session (a Baileys socket). The manager keeps
// them connected, turns WhatsApp events into rows the website reads, and
// sends for the website. Statuses (wl_accounts.status):
//   qr          waiting for the QR to be scanned (live QR in memory)
//   connecting  linked, connecting / reconnecting
//   connected   online
//   qr_expired  nobody scanned in time — "Show new QR" starts again
//   logged_out  logged out (from the phone or the website); scan again to relink
//   replaced    the same login was opened somewhere else — paused, reconnect by hand
//   failed      WhatsApp refused the login (e.g. the number was banned)

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const SEND_GAP_MS = 1_500; // at most ~1 message / 1.5 s per number (keeps the pattern human)
const QR_TTL_MS = 60_000;
const HISTORY_DAYS = Number(process.env.WA_HISTORY_DAYS || 180);

const sessions = new Map();

const digits = (s) => String(s || '').replace(/\D/g, '');
const now = () => new Date();
const tsOf = (m) => new Date(Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp ?? 0) * 1000 || Date.now());

async function setAccount(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await q(`UPDATE wl_accounts SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
}

class Session {
  constructor(id) {
    this.id = id;
    this.sock = null;
    this.qr = '';
    this.qrAt = 0;
    this.status = 'connecting';
    this.retries = 0;
    this.stopped = false;
    this.timer = null;
    this.sendChain = Promise.resolve();
    this.lastSend = 0;
    this.pairing = null; // phone number awaiting a pairing code
  }

  async start() {
    this.stopped = false;
    clearTimeout(this.timer);
    const { state, saveCreds } = await usePgAuthState(this.id);
    this.linked = Boolean(state.creds.registered || state.creds.me);
    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      // Ask the phone for the full chat sync (it sends history once, right after linking).
      // Do NOT use browser 'Desktop' together with syncFullHistory: WhatsApp now closes that login (428) and no QR
      // ever appears (tested 26 Nov 2026, Baileys 7.0.0-rc14).
      browser: Browsers.windows('Mappingg CRM'),
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      markOnlineOnConnect: false, // the phone keeps getting notifications
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => this.loadProto(key.id),
      shouldIgnoreJid: (jid) => Boolean(isJidBroadcast(jid) || isJidNewsletter(jid)), // status updates, broadcast lists, channels
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => this.onConnection(u, sock).catch((e) => console.error(`[${this.id}] connection.update`, e)));
    sock.ev.on('messages.upsert', ({ messages, type }) => this.saveMessages(messages, { notify: type === 'notify' }).catch((e) => console.error(`[${this.id}] upsert`, e)));
    sock.ev.on('messages.update', (list) => this.onUpdates(list).catch((e) => console.error(`[${this.id}] update`, e)));
    sock.ev.on('messaging-history.set', (h) => this.onHistory(h).catch((e) => console.error(`[${this.id}] history`, e)));
    sock.ev.on('contacts.upsert', (list) => this.onContacts(list).catch(() => undefined));
    sock.ev.on('contacts.update', (list) => this.onContacts(list).catch(() => undefined));
    sock.ev.on('chats.upsert', (list) => this.onChats(list, { create: true }).catch((e) => console.error(`[${this.id}] chats`, e.message)));
    sock.ev.on('chats.update', (list) => this.onChats(list).catch(() => undefined));
  }

  async onConnection(u, sock) {
    if (sock !== this.sock) return; // an old socket
    if (u.qr) {
      if (this.pairing) return; // linking by code instead
      this.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 });
      this.qrAt = Date.now();
      this.status = 'qr';
      await setAccount(this.id, { status: 'qr', last_error: '' });
    }
    if (u.connection === 'open') {
      this.qr = ''; this.retries = 0; this.status = 'connected'; this.pairing = null;
      const me = sock.user || {};
      await setAccount(this.id, {
        status: 'connected', last_error: '', phone: digits(jidNormalizedUser(me.id || '').split('@')[0]), wa_name: String(me.name || me.verifiedName || ''),
        connected_at: now(), last_seen_at: now(),
      });
      console.log(`[${this.id}] connected as +${digits(me.id?.split(':')[0])}`);
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const why = u.lastDisconnect?.error?.message || '';
      this.qr = '';
      if (this.stopped) return;
      if (code === DisconnectReason.loggedOut) {
        this.status = 'logged_out';
        await clearAuth(this.id);
        await setAccount(this.id, { status: 'logged_out', last_error: 'Logged out from the phone (Linked devices). Scan again to reconnect.' });
        sessions.delete(this.id);
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        this.status = 'replaced';
        await setAccount(this.id, { status: 'replaced', last_error: 'This login was opened somewhere else. Press Reconnect.' });
        return;
      }
      if (code === DisconnectReason.forbidden) {
        this.status = 'failed';
        await setAccount(this.id, { status: 'failed', last_error: `WhatsApp refused the login (${why || code}). The number may be restricted.` });
        return;
      }
      // Not linked yet and the QR ran out: stop until someone asks for a new one.
      const linkedNow = Boolean(sock.authState?.creds?.registered || sock.authState?.creds?.me);
      if (!linkedNow && code !== DisconnectReason.restartRequired) {
        this.status = 'qr_expired'; this.pairing = null;
        await setAccount(this.id, { status: 'qr_expired', last_error: '' });
        sessions.delete(this.id);
        return;
      }
      // restartRequired (right after scanning), network drops, server restarts: reconnect with back-off.
      this.status = 'connecting';
      const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2_000 * 2 ** Math.min(this.retries++, 5));
      await setAccount(this.id, { status: 'connecting', last_error: why ? `Reconnecting: ${why}`.slice(0, 300) : '' });
      this.timer = setTimeout(() => this.start().catch((e) => console.error(`[${this.id}] restart`, e)), wait);
    }
  }

  /** The chat id we file a message under: the phone-number id when WhatsApp gave a private id (LID). */
  async chatJid(key) {
    let jid = key.remoteJid || '';
    if (isLidUser(jid)) {
      if (key.remoteJidAlt && isPnUser(key.remoteJidAlt)) jid = key.remoteJidAlt;
      else {
        const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
        if (pn) jid = pn;
      }
    }
    return jidNormalizedUser(jid);
  }

  /** Stores messages (new, sent from the phone, or synced history) and updates their chats. */
  async saveMessages(list, { notify = false, history = false, sentBy = '' } = {}) {
    for (const m of list) {
      if (!m?.key?.id || !m.message) continue;
      const jid = await this.chatJid(m.key);
      if (!jid || isJidStatusBroadcast(jid) || isJidNewsletter(jid) || jid.endsWith('@broadcast')) continue;
      const p = parseMessage(m.message);
      if (!p) continue;
      const fromMe = Boolean(m.key.fromMe);
      const ts = tsOf(m);
      const group = Boolean(isJidGroup(jid));
      const sender = group && !fromMe ? String(m.pushName || digits((m.key.participantAlt || m.key.participant || '').split('@')[0])) : '';
      const status = fromMe ? (ackStatus(m.status) || 'sent') : '';
      // Media keys are needed to download the file later; they stay encrypted.
      const raw = MEDIA_KINDS.has(p.kind) ? encrypt(JSON.stringify({ key: m.key, message: m.message })) : null;
      const ins = await q(
        `INSERT INTO wl_messages (account_id, id, jid, from_me, sender, kind, body, media, status, ts, history, sent_by, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (account_id, id) DO UPDATE SET sent_by = CASE WHEN wl_messages.sent_by = '' THEN EXCLUDED.sent_by ELSE wl_messages.sent_by END
         RETURNING (xmax = 0) AS inserted`,
        [this.id, m.key.id, jid, fromMe, sender.slice(0, 80), p.kind, p.body.slice(0, 8000), p.media ? JSON.stringify(p.media) : null, status, ts, history, sentBy, raw],
      );
      const inserted = ins.rows[0]?.inserted;
      if (!inserted) continue; // already stored: no double counting
      const name = !fromMe && !group && m.pushName ? String(m.pushName).slice(0, 80) : '';
      await q(
        `INSERT INTO wl_chats (account_id, jid, phone, name, is_group, last_text, last_at, last_from_me, unread)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (account_id, jid) DO UPDATE SET
           name = CASE WHEN wl_chats.name = '' THEN EXCLUDED.name ELSE wl_chats.name END,
           last_text = CASE WHEN wl_chats.last_at IS NULL OR EXCLUDED.last_at >= wl_chats.last_at THEN EXCLUDED.last_text ELSE wl_chats.last_text END,
           last_from_me = CASE WHEN wl_chats.last_at IS NULL OR EXCLUDED.last_at >= wl_chats.last_at THEN EXCLUDED.last_from_me ELSE wl_chats.last_from_me END,
           last_at = GREATEST(wl_chats.last_at, EXCLUDED.last_at),
           unread = CASE WHEN $10 THEN 0 ELSE wl_chats.unread + EXCLUDED.unread END`,
        [this.id, jid, group ? '' : digits(jid.split('@')[0]), name, group, preview(p), ts, fromMe, notify && !fromMe ? 1 : 0, fromMe && !history],
      );
      if (group && notify) this.groupName(jid);
    }
    if (list.length) await setAccount(this.id, { last_seen_at: now() }).catch(() => undefined);
  }

  /** Delivered / read ticks for messages we sent. */
  async onUpdates(list) {
    for (const { key, update } of list) {
      if (!key?.id || update?.status == null || !key.fromMe) continue;
      const st = ackStatus(update.status);
      if (!st) continue;
      const r = await q('SELECT status FROM wl_messages WHERE account_id = $1 AND id = $2', [this.id, key.id]);
      if (!r.rows[0]) continue;
      const next = laterStatus(r.rows[0].status, st);
      if (next !== r.rows[0].status) await q('UPDATE wl_messages SET status = $3 WHERE account_id = $1 AND id = $2', [this.id, key.id, next]);
    }
  }

  /** Recent chats the phone shares when it links (WhatsApp decides how much). Stored as history. */
  async onHistory({ chats = [], contacts = [], messages = [], syncType, progress }) {
    // Keep the last HISTORY_DAYS (default 180) of old messages; older ones are not stored —
    // except messages someone asked for with "Load older messages" (ON_DEMAND = 6).
    const since = Date.now() - HISTORY_DAYS * 86_400_000;
    const keep = syncType === 6 ? messages : messages.filter((m) => tsOf(m).getTime() >= since);
    console.log(`[${this.id}] history chunk (type ${syncType}, ${progress ?? '?'}%): ${chats.length} chats, ${messages.length} messages, keeping ${keep.length}`);
    // Messages first (they create the chats), then names and unread counts.
    const started = Date.now();
    const saved = await this.saveHistory(keep);
    console.log(`[${this.id}] history saved: ${saved.messages} messages in ${saved.chats} chats (${Math.round((Date.now() - started) / 1000)} s)`);
    // Every chat in the phone's list shows, even when the phone sent no messages for it.
    await this.onChats(chats, { create: true });
    await this.onContacts(contacts);
  }

  /**
   * Bulk save of synced history: 200 messages per INSERT, then one upsert per chat with its newest message.
   * (Saving one by one over a remote database managed ~10 messages a second.) Already-stored messages are kept.
   */
  async saveHistory(list) {
    const jidCache = new Map();
    const rows = [];
    const chats = new Map();
    for (const m of list) {
      if (!m?.key?.id || !m.message) continue;
      const rj = m.key.remoteJid || '';
      if (!jidCache.has(rj)) jidCache.set(rj, await this.chatJid(m.key));
      const jid = jidCache.get(rj);
      if (!jid || isJidStatusBroadcast(jid) || isJidNewsletter(jid) || jid.endsWith('@broadcast')) continue;
      const p = parseMessage(m.message);
      if (!p) continue;
      const fromMe = Boolean(m.key.fromMe);
      const ts = tsOf(m);
      const group = Boolean(isJidGroup(jid));
      const sender = group && !fromMe ? String(m.pushName || digits((m.key.participantAlt || m.key.participant || '').split('@')[0])) : '';
      const raw = MEDIA_KINDS.has(p.kind) ? encrypt(JSON.stringify({ key: m.key, message: m.message })) : null;
      rows.push([this.id, m.key.id, jid, fromMe, sender.slice(0, 80), p.kind, p.body.slice(0, 8000), p.media ? JSON.stringify(p.media) : null, fromMe ? (ackStatus(m.status) || 'sent') : '', ts, true, '', raw]);
      const c = chats.get(jid) || { jid, group, name: '', last: null };
      if (!c.name && !fromMe && !group && m.pushName) c.name = String(m.pushName).slice(0, 80);
      if (!c.last || ts >= c.last.ts) c.last = { ts, text: preview(p), fromMe };
      chats.set(jid, c);
    }
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = chunk.map((_, r) => `(${Array.from({ length: 13 }, (__, c) => `$${r * 13 + c + 1}`).join(',')})`).join(',');
      const res = await q(
        `INSERT INTO wl_messages (account_id, id, jid, from_me, sender, kind, body, media, status, ts, history, sent_by, raw)
         VALUES ${values} ON CONFLICT (account_id, id) DO NOTHING`,
        chunk.flat(),
      );
      inserted += res.rowCount || 0;
    }
    for (const c of chats.values()) {
      await q(
        `INSERT INTO wl_chats (account_id, jid, phone, name, is_group, last_text, last_at, last_from_me, unread)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)
         ON CONFLICT (account_id, jid) DO UPDATE SET
           name = CASE WHEN wl_chats.name = '' THEN EXCLUDED.name ELSE wl_chats.name END,
           last_text = CASE WHEN wl_chats.last_at IS NULL OR EXCLUDED.last_at >= wl_chats.last_at THEN EXCLUDED.last_text ELSE wl_chats.last_text END,
           last_from_me = CASE WHEN wl_chats.last_at IS NULL OR EXCLUDED.last_at >= wl_chats.last_at THEN EXCLUDED.last_from_me ELSE wl_chats.last_from_me END,
           last_at = GREATEST(wl_chats.last_at, EXCLUDED.last_at)`,
        [this.id, c.jid, c.group ? '' : digits(c.jid.split('@')[0]), c.name, c.group, c.last.text, c.last.ts, c.last.fromMe],
      );
    }
    if (rows.length) await setAccount(this.id, { last_seen_at: now() }).catch(() => undefined);
    return { messages: inserted, chats: chats.size };
  }

  /** Names: a contact's saved name, else the name they set on WhatsApp. Only fills chats we already have. */
  async onContacts(list) {
    for (const c of list || []) {
      const name = String(c.name || c.notify || c.verifiedName || '').trim().slice(0, 80);
      if (!c.id || !name) continue;
      const ids = [c.id, c.phoneNumber].filter(Boolean).map((x) => jidNormalizedUser(x));
      await q('UPDATE wl_chats SET name = $3 WHERE account_id = $1 AND jid = ANY($2::text[]) AND (name = \'\' OR $4)', [this.id, ids, name, Boolean(c.name)]);
    }
  }

  /**
   * Chat list entries from WhatsApp. `create` (history sync / new chat): add the chat with its name, last time
   * and unread count even if no message of it is stored. Otherwise only names are updated.
   */
  async onChats(list, { create = false } = {}) {
    for (const c of list || []) {
      if (!c?.id || isJidBroadcast(c.id) || isJidNewsletter(c.id)) continue;
      let jid;
      if (isLidUser(c.id)) jid = c.phoneNumber && isPnUser(c.phoneNumber) ? jidNormalizedUser(c.phoneNumber) : await this.chatJid({ remoteJid: c.id });
      else jid = jidNormalizedUser(c.id);
      if (!jid) continue;
      const name = String(c.name || '').trim().slice(0, 80);
      if (!create) {
        if (name) await q('UPDATE wl_chats SET name = $3 WHERE account_id = $1 AND jid = $2', [this.id, jid, name]);
        continue;
      }
      const secs = Number(c.conversationTimestamp?.toNumber?.() ?? c.conversationTimestamp ?? c.lastMessageRecvTimestamp ?? 0) || 0;
      const group = Boolean(isJidGroup(jid));
      await q(
        `INSERT INTO wl_chats (account_id, jid, phone, name, is_group, last_at, unread)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (account_id, jid) DO UPDATE SET
           name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE wl_chats.name END,
           last_at = GREATEST(wl_chats.last_at, EXCLUDED.last_at),
           unread = COALESCE($8::int, wl_chats.unread)`,
        [this.id, jid, group ? '' : digits(jid.split('@')[0]), name, group, secs ? new Date(secs * 1000) : null, Math.max(0, Number(c.unreadCount) || 0),
          c.unreadCount == null ? null : Math.max(0, Number(c.unreadCount) || 0)],
      );
    }
  }

  /** Asks the phone for older messages of a chat (they arrive a few seconds later as history). */
  async requestOlder(jid) {
    this.requireOnline();
    const r = await q('SELECT id, from_me, ts FROM wl_messages WHERE account_id = $1 AND jid = $2 ORDER BY ts ASC LIMIT 1', [this.id, jid]);
    const oldest = r.rows[0];
    if (!oldest) throw Object.assign(new Error('WhatsApp did not share any message of this chat to start from. New messages will show here as they come.'), { status: 409 });
    // The chat may be known to WhatsApp by its private id (LID); ask under that when we have it.
    const lid = isPnUser(jid) ? await this.sock.signalRepository?.lidMapping?.getLIDForPN(jid).catch(() => null) : null;
    await this.sock.fetchMessageHistory(50, { remoteJid: lid || jid, id: oldest.id, fromMe: oldest.from_me }, new Date(oldest.ts).getTime());
    return { ok: true };
  }

  groupName(jid) {
    this.sock?.groupMetadata(jid).then((g) => g?.subject && q('UPDATE wl_chats SET name = $3 WHERE account_id = $1 AND jid = $2', [this.id, jid, String(g.subject).slice(0, 80)])).catch(() => undefined);
  }

  /** The stored WhatsApp message (for media download / message retries). */
  async loadRaw(msgId) {
    const r = await q('SELECT raw FROM wl_messages WHERE account_id = $1 AND id = $2', [this.id, msgId]);
    if (!r.rows[0]?.raw) return null;
    try { return JSON.parse(decrypt(r.rows[0].raw)); } catch { return null; }
  }

  async loadProto(msgId) {
    return (await this.loadRaw(msgId))?.message || undefined;
  }

  requireOnline() {
    if (this.status !== 'connected' || !this.sock) throw Object.assign(new Error('This WhatsApp is not connected right now'), { status: 409 });
  }

  /** Sends one message (queued per number so sends are spaced out). Resolves the stored message id. */
  send(input) {
    const run = async () => {
      this.requireOnline();
      const wait = this.lastSend + SEND_GAP_MS + Math.floor(Math.random() * 700) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      let jid = String(input.jid || '');
      if (!jid) {
        const num = digits(input.phone);
        if (num.length < 10) throw Object.assign(new Error('Enter a valid number with country code'), { status: 400 });
        const [hit] = await this.sock.onWhatsApp(num);
        if (!hit?.exists) throw Object.assign(new Error(`+${num} is not on WhatsApp`), { status: 400 });
        jid = jidNormalizedUser(hit.jid);
      }
      const caption = String(input.text || '').slice(0, 4096);
      let content;
      if (!input.media) {
        if (!caption.trim()) throw Object.assign(new Error('Type a message'), { status: 400 });
        content = { text: caption };
      } else {
        const { kind, url, mimetype, filename } = input.media;
        if (!/^https:\/\//i.test(url || '')) throw Object.assign(new Error('File link must be https'), { status: 400 });
        if (kind === 'image') content = { image: { url }, caption };
        else if (kind === 'video') content = { video: { url }, caption, mimetype: mimetype || 'video/mp4' };
        else if (kind === 'audio') content = { audio: { url }, mimetype: mimetype || 'audio/mp4' };
        else content = { document: { url }, mimetype: mimetype || 'application/octet-stream', fileName: filename || 'file', caption };
      }
      const sent = await this.sock.sendMessage(jid, content);
      this.lastSend = Date.now();
      if (sent) await this.saveMessages([sent], { sentBy: String(input.by || '').slice(0, 120) });
      return { id: sent?.key?.id || '', jid };
    };
    const p = this.sendChain.then(run, run);
    this.sendChain = p.catch(() => undefined);
    return p;
  }

  /** Blue ticks for the customer + unread 0. */
  async markRead(jid) {
    await q('UPDATE wl_chats SET unread = 0 WHERE account_id = $1 AND jid = $2', [this.id, jid]);
    if (this.status !== 'connected') return;
    const r = await q('SELECT id FROM wl_messages WHERE account_id = $1 AND jid = $2 AND NOT from_me AND NOT history ORDER BY ts DESC LIMIT 20', [this.id, jid]);
    const keys = r.rows.map((row) => ({ remoteJid: jid, id: row.id, fromMe: false }));
    if (keys.length) await this.sock.readMessages(keys).catch(() => undefined);
  }

  /** A stored photo / video / audio / document, downloaded from WhatsApp (re-requested from the phone if old). */
  async media(msgId) {
    const msg = await this.loadRaw(msgId);
    if (!msg) throw Object.assign(new Error('File not found'), { status: 404 });
    const ctx = this.sock && this.status === 'connected' ? { logger, reuploadRequest: this.sock.updateMediaMessage } : { logger, reuploadRequest: async (m) => m };
    return downloadMediaMessage(msg, 'buffer', {}, ctx);
  }

  async pairingCode(phone) {
    if (this.linked) throw Object.assign(new Error('Already linked'), { status: 409 });
    this.pairing = digits(phone);
    // The socket must be up (it has shown its first QR) before a code can be asked for.
    for (let i = 0; i < 20 && !this.qrAt && this.status !== 'qr'; i++) await new Promise((r) => setTimeout(r, 500));
    return this.sock.requestPairingCode(this.pairing);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    try { this.sock?.end(undefined); } catch { /* closed */ }
    this.sock = null;
  }

  async logout() {
    this.stopped = true;
    clearTimeout(this.timer);
    try { await this.sock?.logout(); } catch { /* already gone */ }
    try { this.sock?.end(undefined); } catch { /* closed */ }
    await clearAuth(this.id);
    this.status = 'logged_out';
    await setAccount(this.id, { status: 'logged_out', last_error: '' });
  }

  view() {
    const fresh = this.qr && Date.now() - this.qrAt < QR_TTL_MS;
    return { id: this.id, live: true, status: this.status, qr: this.status === 'qr' && fresh ? this.qr : '' };
  }
}

/* ------------------------------- manager ------------------------------- */

export function get(id) {
  return sessions.get(id);
}

/** Starts (or restarts) a session: shows a fresh QR when not linked yet. */
export async function connect(id) {
  const r = await q('SELECT id FROM wl_accounts WHERE id = $1', [id]);
  if (!r.rows[0]) throw Object.assign(new Error('Account not found'), { status: 404 });
  const old = sessions.get(id);
  if (old) await old.stop();
  const s = new Session(id);
  sessions.set(id, s);
  await setAccount(id, { status: 'connecting', last_error: '' });
  await s.start();
  return s;
}

export async function createAccount({ label, owner_email }) {
  const id = crypto.randomUUID();
  await q('INSERT INTO wl_accounts (id, label, owner_email, status) VALUES ($1, $2, $3, $4)', [id, String(label || '').slice(0, 80), String(owner_email || '').toLowerCase().slice(0, 200), 'new']);
  return connect(id);
}

export async function logout(id) {
  const s = sessions.get(id);
  if (s) { await s.logout(); sessions.delete(id); return; }
  await clearAuth(id);
  await setAccount(id, { status: 'logged_out', last_error: '' });
}

/** Removes a linked WhatsApp and everything stored for it. */
export async function remove(id) {
  await logout(id).catch(() => undefined);
  await q('DELETE FROM wl_messages WHERE account_id = $1', [id]);
  await q('DELETE FROM wl_chats WHERE account_id = $1', [id]);
  await q('DELETE FROM wl_auth WHERE account_id = $1', [id]);
  await q('DELETE FROM wl_accounts WHERE id = $1', [id]);
}

export function views() {
  return [...sessions.values()].map((s) => s.view());
}

/** On boot: reconnect every number that was linked. Unfinished QR links are marked expired. */
export async function resumeAll() {
  // A QR left on screen when the server stopped was never scanned (a scanned one is 'connecting' / 'connected').
  await q(`UPDATE wl_accounts SET status = 'qr_expired' WHERE status IN ('new', 'qr')`);
  const r = await q(`SELECT id FROM wl_accounts WHERE status IN ('connected', 'connecting')`);
  for (const { id } of r.rows) {
    await connect(id).catch((e) => console.error(`[${id}] resume failed`, e.message));
  }
  console.log(`[gateway] resumed ${r.rows.length} WhatsApp number(s)`);
}

export async function stopAll() {
  await Promise.all([...sessions.values()].map((s) => s.stop()));
}
