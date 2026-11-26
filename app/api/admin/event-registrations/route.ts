import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';
import { getCurrentUser } from '@/lib/auth';
import { EVENT_SOURCE } from '@/lib/event-registration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin → CRM & Leads → Event registrations. Everyone who registered on the
// Mappingg Events landing site (see app/api/event-registration). Needs the
// 'leads' permission; like the CRM, an employee sees only the registrations
// transferred to them. Follow-up (status, notes, assignment) happens in the CRM.

export async function GET() {
  if (!(await hasPermission('leads'))) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const me = await getCurrentUser();
  const scope = me?.role === 'admin' ? {} : { assigned_to: me?.id || '__nobody' };
  const db = await getDb();
  const rows = await db.collection('contact_leads')
    .find({ source: EVENT_SOURCE, ...scope }, { projection: { _id: 0, id: 1, name: 1, email: 1, phone: 1, attendee_type: 1, city: 1, event: 1, status: 1, consent: 1, created_at: 1 } })
    .sort({ created_at: -1 })
    .limit(5000)
    .toArray();
  return NextResponse.json({ data: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
