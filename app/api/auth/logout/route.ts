import { NextResponse } from 'next/server';
import { PUBLIC_ROLES, clearSessionCookie, getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getCurrentUser().catch(() => null);
  if (user && (PUBLIC_ROLES as readonly string[]).includes(user.role)) {
    await logActivity({ user_id: user.id, email: user.email, role: user.role, type: 'logout', detail: 'Signed out' });
  }
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
