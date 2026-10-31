import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStaffUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { shareToken } from '@/lib/share-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/share-link { pin_id } — a project link the super admin sends
// to someone: opens the live map without signing in, showing only this project
// (see lib/share-link.ts).
const schema = z.object({ pin_id: z.string().trim().min(1).max(100) });

export async function POST(req: NextRequest) {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Choose a project.' } }, { status: 400 });
  const pin = await (await getDb()).collection('pins').findOne({ id: parsed.data.pin_id }, { projection: { id: 1, hidden: 1, title: 1 } });
  if (!pin) return NextResponse.json({ error: { message: 'Project not found.' } }, { status: 404 });
  if (pin.hidden === true) return NextResponse.json({ error: { message: 'This project is hidden on the map — publish it first.' } }, { status: 400 });
  const url = `${req.nextUrl.origin}/map?share=${shareToken(String(pin.id))}`;
  return NextResponse.json({ data: { url, title: String(pin.title || '') } });
}
