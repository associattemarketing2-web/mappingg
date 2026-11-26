import crypto from 'node:crypto';
import http from 'node:http';
import { migrate, pool, q } from './db.mjs';
import * as S from './sessions.mjs';

// Mappingg WhatsApp gateway — linked-device (QR scan) WhatsApp for the
// s-admin "WhatsApp Inbox". Only the website talks to it, with the shared
// secret WA_GATEWAY_SECRET in the x-gateway-secret header (never sent to
// browsers). Endpoints:
//   GET    /health                          (no secret) liveness
//   GET    /accounts                         live status + QR of each number
//   POST   /accounts            {label, owner_email}      new number → QR
//   POST   /accounts/:id/connect             fresh QR / reconnect
//   POST   /accounts/:id/pair   {phone}      8-character code instead of a QR
//   POST   /accounts/:id/logout
//   DELETE /accounts/:id                     log out + delete its chats
//   POST   /accounts/:id/send   {jid|phone, text, media?:{kind,url,mimetype,filename}, by}
//   POST   /accounts/:id/read   {jid}
//   POST   /accounts/:id/older  {jid}         ask the phone for 50 older messages of a chat
//   GET    /accounts/:id/media/:msgId        the file of a message
//
// Env: DATABASE_URL, WA_GATEWAY_SECRET, WA_GATEWAY_KEY, WA_GATEWAY_PORT (default 8099),
// WA_GATEWAY_HOST (default 127.0.0.1: only the site on the same server calls it), WA_GATEWAY_TAKEOVER=1 (optional)

const SECRET = process.env.WA_GATEWAY_SECRET || '';
if (SECRET.length < 24) throw new Error('WA_GATEWAY_SECRET is not set (use a long random string)');
const PORT = Number(process.env.WA_GATEWAY_PORT || 8099); // PORT belongs to the website
const HOST = process.env.WA_GATEWAY_HOST || '127.0.0.1';
const MAX_BODY = 64 * 1024;

const authorized = (req) => {
  const given = Buffer.from(String(req.headers['x-gateway-secret'] || ''));
  const want = Buffer.from(SECRET);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
};

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const sessionOr404 = (id) => {
  const s = S.get(id);
  if (!s) throw Object.assign(new Error('This WhatsApp is not running — press Reconnect / Show QR'), { status: 409 });
  return s;
};

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, running: S.views().length });
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
  if (!ready) return json(res, 503, { error: waiting
    ? 'Another copy of the WhatsApp server (on another computer or server, same database) is running, so this one is waiting. Stop the other copy, or point WA_GATEWAY_URL to it.'
    : 'The WhatsApp server is starting — try again in a minute' });

  if (parts[0] !== 'accounts') return json(res, 404, { error: 'not found' });
  const id = parts[1];
  if (id && !/^[0-9a-f-]{36}$/.test(id)) return json(res, 400, { error: 'bad id' });

  if (!id) {
    if (req.method === 'GET') return json(res, 200, { accounts: S.views() });
    if (req.method === 'POST') {
      const b = await readBody(req);
      const s = await S.createAccount({ label: b.label, owner_email: b.owner_email });
      return json(res, 200, { account: s.view() });
    }
  }
  const action = parts[2];
  if (req.method === 'DELETE' && !action) { await S.remove(id); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && action === 'connect') { const s = await S.connect(id); return json(res, 200, { account: s.view() }); }
  if (req.method === 'POST' && action === 'logout') { await S.logout(id); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && action === 'pair') {
    const b = await readBody(req);
    const phone = String(b.phone || '').replace(/\D/g, '');
    if (phone.length < 10) return json(res, 400, { error: 'Enter the WhatsApp number with country code' });
    const s = S.get(id) || await S.connect(id);
    return json(res, 200, { code: await s.pairingCode(phone) });
  }
  if (req.method === 'POST' && action === 'send') {
    const b = await readBody(req);
    return json(res, 200, await sessionOr404(id).send(b));
  }
  if (req.method === 'POST' && action === 'older') {
    const b = await readBody(req);
    return json(res, 200, await sessionOr404(id).requestOlder(String(b.jid || '')));
  }
  if (req.method === 'POST' && action === 'read') {
    const b = await readBody(req);
    await (S.get(id)?.markRead(String(b.jid || '')) ?? q('UPDATE wl_chats SET unread = 0 WHERE account_id = $1 AND jid = $2', [id, String(b.jid || '')]));
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && action === 'media' && parts[3]) {
    const s = S.get(id);
    if (!s) return json(res, 409, { error: 'This WhatsApp is not connected, so its files cannot be fetched' });
    const r = await q('SELECT media FROM wl_messages WHERE account_id = $1 AND id = $2', [id, parts[3]]);
    const buf = await s.media(parts[3]);
    const m = r.rows[0]?.media || {};
    res.writeHead(200, {
      'Content-Type': m.mimetype?.split(';')[0] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'private, max-age=3600',
    });
    return res.end(buf);
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    const status = e.status || 500;
    if (status >= 500) console.error('[gateway]', req.method, req.url, e);
    if (!res.headersSent) json(res, status, { error: e.message || 'Server error' });
    else res.end();
  });
});

/**
 * Only one gateway may hold the WhatsApp logins at a time: two copies (e.g. during a redeploy) would keep
 * kicking each other off ("connection replaced"). A lease row (works through connection poolers, unlike
 * advisory locks): taken when free or expired, renewed every 20 s, valid 60 s.
 */
const ME = crypto.randomUUID();
const takeLease = async () => (await q(
  `INSERT INTO wl_gateway_lease (id, holder, until) VALUES (1, $1, now() + interval '60 seconds')
   ON CONFLICT (id) DO UPDATE SET holder = $1, until = now() + interval '60 seconds'
   WHERE wl_gateway_lease.holder = $1 OR wl_gateway_lease.until < now()
   RETURNING holder`, [ME])).rows[0]?.holder === ME;

async function singleInstance() {
  await q('CREATE TABLE IF NOT EXISTS wl_gateway_lease (id int PRIMARY KEY, holder text NOT NULL, until timestamptz NOT NULL)');
  // WA_GATEWAY_TAKEOVER=1: take the lease right away; the copy holding it notices
  // on its next renewal (≤ 20 s) and stops itself.
  if (process.env.WA_GATEWAY_TAKEOVER === '1') {
    await q(`INSERT INTO wl_gateway_lease (id, holder, until) VALUES (1, $1, now() + interval '60 seconds')
             ON CONFLICT (id) DO UPDATE SET holder = $1, until = now() + interval '60 seconds'`, [ME]);
    console.log('[gateway] took over from any other running copy');
  }
  while (!(await takeLease())) {
    waiting = true;
    console.log('[gateway] another gateway is running — waiting for it to stop…');
    await new Promise((r) => setTimeout(r, 10_000));
  }
  waiting = false;
  setInterval(() => {
    takeLease().then((ok) => {
      if (!ok) { console.error('[gateway] another gateway took over — stopping'); process.exit(1); }
    }).catch((e) => console.error('[gateway] lease renew failed', e.message));
  }, 20_000).unref();
}

let ready = false;
let waiting = false; // another gateway holds the lease

async function main() {
  await migrate();
  server.listen(PORT, HOST, () => console.log(`[gateway] listening on ${HOST}:${PORT}`));
  await singleInstance();
  ready = true;
  await S.resumeAll();
  const bye = async () => {
    console.log('[gateway] shutting down');
    server.close();
    await S.stopAll();
    await q('DELETE FROM wl_gateway_lease WHERE id = 1 AND holder = $1', [ME]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}

main().catch((e) => { console.error('[gateway] failed to start', e); process.exit(1); });
