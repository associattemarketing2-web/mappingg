import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES } from '@/lib/auth';
import { hasPermission } from '@/lib/staff';
import { accountTimeline, activityFeed, type AccountLite } from '@/lib/account-insights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Account activity for the Accounts page (needs the 'accounts' permission):
//   GET ?id=<account id>  → that account's full timeline
//   GET                   → recent activity across all accounts
const FIELDS = {
  id: 1, email: 1, name: 1, role: 1, mobile: 1, created_at: 1, verification: 1, verified: 1,
  verified_at: 1, verified_by: 1, verification_note: 1, last_login_at: 1, login_count: 1, compare_pins: 1,
};

export async function GET(req: NextRequest) {
  if (!(await hasPermission('accounts'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const db = await getDb();
  const users = db.collection<{ _id: string; [key: string]: any }>('users');
  const id = req.nextUrl.searchParams.get('id');

  if (id) {
    const account = await users.findOne({ id, role: { $in: [...PUBLIC_ROLES] } }, { projection: FIELDS });
    if (!account) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });
    const data = await accountTimeline(account as unknown as AccountLite);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 80, 300);
  const accounts = await users.find({ role: { $in: [...PUBLIC_ROLES] } }, { projection: FIELDS }).toArray();
  const data = await activityFeed(accounts as unknown as AccountLite[], limit);
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
