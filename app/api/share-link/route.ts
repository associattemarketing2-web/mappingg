import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { SHARE_FREE_VIEWS, pinFromShareToken } from '@/lib/share-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/share-link?t=<token> — checks a super-admin share link (lib/share-link.ts)
// for the live map: which project it opens and how many free views a guest gets.
export async function GET(req: NextRequest) {
  const pinId = pinFromShareToken(req.nextUrl.searchParams.get('t'));
  if (!pinId) return NextResponse.json({ error: { message: 'This link is not valid.' } }, { status: 400 });
  const pin = await (await getDb()).collection('pins').findOne({ id: pinId, hidden: { $ne: true } }, { projection: { id: 1, title: 1 } });
  if (!pin) return NextResponse.json({ error: { message: 'This project is no longer on the map.' } }, { status: 404 });
  return NextResponse.json({ data: { pin_id: String(pin.id), title: String(pin.title || ''), free_views: SHARE_FREE_VIEWS } });
}
