import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg';
import { canUseChat, ensureTables, viewer } from '@/lib/wa-linked';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Messages of one chat of a linked WhatsApp number, newest page first (?before= for older).
const PAGE = 60;

export async function GET(req: NextRequest) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  await ensureTables();
  const sp = req.nextUrl.searchParams;
  const account = sp.get('account') || '';
  const jid = sp.get('jid') || '';
  if (!account || !jid || !(await canUseChat(v, account, jid))) return NextResponse.json({ error: { message: 'Not authorized for this chat' } }, { status: 403 });
  const before = sp.get('before');
  const r = await query(
    `SELECT id, from_me, sender, kind, body, media, status, ts, history, sent_by
     FROM wl_messages WHERE account_id = $1 AND jid = $2 ${before ? 'AND ts < $3' : ''} ORDER BY ts DESC LIMIT ${PAGE}`,
    before ? [account, jid, before] : [account, jid],
  );
  return NextResponse.json({ data: { messages: r.rows.reverse(), more: r.rows.length === PAGE } });
}
