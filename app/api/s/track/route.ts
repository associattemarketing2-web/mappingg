import { NextRequest, NextResponse } from 'next/server';
import { getShareByCode, recordEvent } from '@/lib/wa-share';
import { prettyPhone } from '@/lib/wa-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public: the share page (/s/<code>/<token>) reports an open or a download here.
// Body (JSON, sent with sendBeacon): { c: code, t: token, e: 'open' | 'click', i: item id }.
// The first open of a number's link also pops up on the admins' devices.
export async function POST(req: NextRequest) {
  try {
    const b = JSON.parse((await req.text()).slice(0, 2000) || '{}');
    const code = String(b.c || '').slice(0, 20);
    const tok = String(b.t || '').slice(0, 20);
    const event = b.e === 'click' ? 'click' : 'open';
    const first = await recordEvent(code, tok, event, String(b.i || '').slice(0, 40), req.headers.get('user-agent') || '');
    if (first) {
      const share = await getShareByCode(code);
      void import('@/lib/push').then(({ pushToStaff }) => pushToStaff({
        title: `👀 ${first.name || prettyPhone(first.phone)} opened your link`,
        body: `${share?.title || 'Project link'} · ${prettyPhone(first.phone)}`,
        url: '/dashboard/s-admin?tab=whatsapp',
        tag: `share-${tok}`,
      }, 'whatsapp')).catch(() => {});
    }
  } catch { /* never fail the page */ }
  return new NextResponse(null, { status: 204 });
}
