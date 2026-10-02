import { NextRequest, NextResponse } from 'next/server';
import { getStaffUser } from '@/lib/auth';
import { runPartnersRpc, ADMIN_RPCS, PUBLIC_RPCS } from '@/lib/partners-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Partners RPC dispatcher. Admin RPCs require a session; link_* RPCs are public
// but gate themselves on a valid, active submission-link token inside the body.
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  const name = params.name;
  if (!ADMIN_RPCS.has(name) && !PUBLIC_RPCS.has(name)) {
    return NextResponse.json({ data: null, error: { message: 'Unknown function' } }, { status: 404 });
  }

  const user = await getStaffUser();
  if (ADMIN_RPCS.has(name) && name !== 'is_admin' && !user) {
    return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const result = await runPartnersRpc(name, body, { authed: !!user, userEmail: user?.email });
  return NextResponse.json({ data: result.data, error: result.error }, {
    status: result.status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
