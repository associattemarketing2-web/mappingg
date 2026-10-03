import { NextRequest, NextResponse } from 'next/server';
import { buildAuthRequest, googleConfigured } from '@/lib/google-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/google/start — kicks off Google sign-in by redirecting the
// browser to Google's consent screen. State + PKCE cookies are set here.
export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL('/?signin=1&error=google_not_configured', req.nextUrl.origin));
  }
  return NextResponse.redirect(buildAuthRequest(req));
}
