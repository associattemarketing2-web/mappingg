import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/pg';
import {
  accountFor, accountsFor, canManage, canUseChat, ensureTables, escapeLike, gateway, GatewayError, gatewayConfigured, team, viewer, waDigits,
} from '@/lib/wa-linked';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// s-admin → Communication → WhatsApp Inbox (numbers linked by QR scan).
//   GET  ?account=&q=&filter=all|unread|mine|unassigned&before=   numbers (+ live QR) and chats
//   POST {action: 'link'|'reconnect'|'pair'|'logout'|'delete'|'rename'|'members'|'assign'|'read'|'send', …}
// Needs the WhatsApp permission; each number / chat is checked against the viewer (lib/wa-linked.ts).

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });
const PAGE = 60;

export async function GET(req: NextRequest) {
  const v = await viewer();
  if (!v) return fail('Not authorized', 401);
  await ensureTables();
  const sp = req.nextUrl.searchParams;
  const accounts = await accountsFor(v);

  // Live state (QR codes, running or not) from the gateway; the database status is the fallback.
  let live: { id: string; status: string; qr: string }[] = [];
  let gatewayError = '';
  if (!gatewayConfigured()) gatewayError = 'not_configured';
  else {
    try { live = (await gateway('/accounts', { timeoutMs: 8_000 })).accounts || []; } catch (e) { gatewayError = (e as Error).message; }
  }
  const liveById = new Map(live.map((l) => [l.id, l]));

  const ids = accounts.map((a) => a.id);
  const accountId = sp.get('account') || '';
  const term = (sp.get('q') || '').trim().slice(0, 80);
  const filter = sp.get('filter') || 'all';
  const before = sp.get('before');

  // Chats: of numbers the viewer has, plus chats assigned to them on other numbers.
  const where: string[] = ['(c.account_id = ANY($1::text[]) OR c.assigned_to = $2)'];
  const params: unknown[] = [ids, v.email];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
  if (accountId) add('c.account_id = ?', accountId);
  if (filter === 'unread') where.push('c.unread > 0');
  if (filter === 'mine') add('c.assigned_to = ?', v.email);
  if (filter === 'unassigned') where.push(`c.assigned_to = ''`);
  if (before) add('c.last_at < ?', before);
  if (term) {
    params.push(`%${escapeLike(term)}%`);
    const a = `$${params.length}`;
    const ors = [`c.name ILIKE ${a}`, `c.last_text ILIKE ${a}`,
      `EXISTS (SELECT 1 FROM wl_messages m WHERE m.account_id = c.account_id AND m.jid = c.jid AND m.body ILIKE ${a})`];
    const num = waDigits(term);
    if (num.length >= 3) { params.push(`%${num}%`); ors.push(`c.phone LIKE $${params.length}`); }
    where.push(`(${ors.join(' OR ')})`);
  }
  const chats = (await query(
    `SELECT c.account_id, c.jid, c.phone, c.name, c.is_group, c.last_text, c.last_at, c.last_from_me, c.unread, c.assigned_to
     FROM wl_chats c WHERE ${where.join(' AND ')} ORDER BY c.last_at DESC NULLS LAST LIMIT ${PAGE}`,
    params,
  )).rows;

  const unread = (await query<{ account_id: string; n: string }>(
    'SELECT account_id, SUM(unread)::text AS n FROM wl_chats WHERE account_id = ANY($1::text[]) GROUP BY account_id', [ids],
  )).rows;
  const unreadBy = new Map(unread.map((u) => [u.account_id, Number(u.n) || 0]));

  return NextResponse.json({
    data: {
      me: v.email,
      admin: v.admin,
      gateway: { configured: gatewayConfigured(), ok: !gatewayError, error: gatewayError },
      accounts: accounts.map((a) => {
        const l = liveById.get(a.id);
        return {
          id: a.id, label: a.label, phone: a.phone, wa_name: a.wa_name, last_error: a.last_error,
          status: l?.status || a.status, running: Boolean(l), qr: l?.qr || '',
          owner_email: a.owner_email, members: a.members, connected_at: a.connected_at, last_seen_at: a.last_seen_at,
          manage: canManage(v, a), unread: unreadBy.get(a.id) || 0,
        };
      }),
      chats,
      more: chats.length === PAGE,
      team: await team(),
    },
  });
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), label: z.string().max(80).default('') }),
  z.object({ action: z.literal('reconnect'), account: z.string().uuid() }),
  z.object({ action: z.literal('pair'), account: z.string().uuid(), phone: z.string().min(10).max(20) }),
  z.object({ action: z.literal('logout'), account: z.string().uuid() }),
  z.object({ action: z.literal('delete'), account: z.string().uuid() }),
  z.object({ action: z.literal('rename'), account: z.string().uuid(), label: z.string().max(80) }),
  z.object({ action: z.literal('members'), account: z.string().uuid(), members: z.array(z.string().email().max(200)).max(50) }),
  z.object({ action: z.literal('assign'), account: z.string().uuid(), jid: z.string().max(120), to: z.string().max(200) }),
  z.object({ action: z.literal('read'), account: z.string().uuid(), jid: z.string().max(120) }),
  z.object({ action: z.literal('older'), account: z.string().uuid(), jid: z.string().max(120) }),
  z.object({
    action: z.literal('send'), account: z.string().uuid(),
    jid: z.string().max(120).optional(), phone: z.string().max(20).optional(),
    text: z.string().max(4096).default(''),
    media: z.object({
      kind: z.enum(['image', 'video', 'audio', 'document']), url: z.string().url().max(1000),
      mimetype: z.string().max(120).optional(), filename: z.string().max(200).optional(),
    }).optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const v = await viewer();
  if (!v) return fail('Not authorized', 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request');
  const d = parsed.data;
  await ensureTables();

  try {
    if (d.action === 'link') {
      const r = await gateway('/accounts', { body: { label: d.label.trim(), owner_email: v.email } });
      return NextResponse.json({ data: { account: r.account } });
    }

    // Chat-level actions: full access to the number, or the chat is assigned to the viewer.
    if (d.action === 'read' || d.action === 'send' || d.action === 'assign' || d.action === 'older') {
      const jid = d.action === 'send' && !d.jid ? '' : String(d.jid);
      if (jid ? !(await canUseChat(v, d.account, jid)) : !(await accountFor(v, d.account))) return fail('Not authorized for this chat', 403);
      if (d.action === 'read') {
        await gateway(`/accounts/${d.account}/read`, { body: { jid } }).catch(() => query('UPDATE wl_chats SET unread = 0 WHERE account_id = $1 AND jid = $2', [d.account, jid]));
        return NextResponse.json({ data: { ok: true } });
      }
      if (d.action === 'older') {
        return NextResponse.json({ data: await gateway(`/accounts/${d.account}/older`, { body: { jid } }) });
      }
      if (d.action === 'assign') {
        const to = d.to.trim().toLowerCase();
        if (to && !(await team()).some((t) => t.email === to)) return fail('Pick a teammate who has WhatsApp access');
        await query('UPDATE wl_chats SET assigned_to = $3 WHERE account_id = $1 AND jid = $2', [d.account, jid, to]);
        return NextResponse.json({ data: { ok: true } });
      }
      if (!jid && !waDigits(d.phone || '')) return fail('Enter a number');
      if (!d.text.trim() && !d.media) return fail('Type a message');
      const r = await gateway(`/accounts/${d.account}/send`, {
        body: { ...(jid ? { jid } : { phone: waDigits(d.phone || '') }), text: d.text, media: d.media, by: v.email }, timeoutMs: 45_000,
      });
      return NextResponse.json({ data: r });
    }

    const acc = await accountFor(v, d.account);
    if (!acc) return fail('Number not found', 404);
    if (d.action === 'reconnect') return NextResponse.json({ data: (await gateway(`/accounts/${acc.id}/connect`, { body: {} })) });
    if (d.action === 'pair') return NextResponse.json({ data: (await gateway(`/accounts/${acc.id}/pair`, { body: { phone: waDigits(d.phone) } })) });
    if (!canManage(v, acc)) return fail('Only the person who linked this number (or the super admin) can do that', 403);
    if (d.action === 'logout') { await gateway(`/accounts/${acc.id}/logout`, { body: {} }); return NextResponse.json({ data: { ok: true } }); }
    if (d.action === 'delete') { await gateway(`/accounts/${acc.id}`, { method: 'DELETE' }); return NextResponse.json({ data: { ok: true } }); }
    if (d.action === 'rename') {
      await query('UPDATE wl_accounts SET label = $2, updated_at = now() WHERE id = $1', [acc.id, d.label.trim()]);
      return NextResponse.json({ data: { ok: true } });
    }
    const allowed = new Set((await team()).map((t) => t.email));
    const members = [...new Set(d.members.map((m) => m.toLowerCase()))].filter((m) => allowed.has(m) && m !== acc.owner_email);
    await query('UPDATE wl_accounts SET members = $2, updated_at = now() WHERE id = $1', [acc.id, members]);
    return NextResponse.json({ data: { ok: true, members } });
  } catch (e) {
    if (e instanceof GatewayError) return fail(e.message, e.status);
    console.error('[wa-linked]', d.action, e);
    return fail('Something went wrong');
  }
}
