import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStaffUser } from '@/lib/auth';
import { restorePinFromHistory } from '@/lib/db-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ p_history_id: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: 'p_history_id is required' } }, { status: 400 });
  }
  const user = await getStaffUser();
  const result = await restorePinFromHistory(parsed.data.p_history_id, !!user);
  return NextResponse.json({ data: result.data, error: result.error }, { status: result.status });
}
