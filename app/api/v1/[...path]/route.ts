import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

// Unknown /api/v1 paths get the API's JSON error shape instead of the HTML 404 page.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const requestId = randomUUID();
  return NextResponse.json(
    { success: false, error: { code: 'not_found', message: 'No such endpoint. See https://www.mappingg.com/developer-api for the list.', requestId } },
    { status: 404, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' } },
  );
}
