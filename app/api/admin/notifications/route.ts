import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';
import { listActivity, type ActivityEvent } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Notification bell in the admin top bar — everything that happens on the site,
// the way the EzyLoan admin bell works:
//   project  → projects developers added / edited / asked to delete (built from
//              the pins themselves, so nothing is missed) + approvals, rejections
//              and deletions from the activity log
//   account  → new sign-ups (buyers, developers, channel partners), account
//              approvals / rejections, profile / password / role changes, closures
//   lead     → new contact-form messages and "Enquire" requests from the map
//   activity → routine things people do (sign-ins, favourites, compare list).
//              Shown, but never counted as unread and never pops up.
// Each section only appears for staff who can open it. "Unread" = newer than the
// time this staff member last opened the bell, stored on their own user record.
type Doc = { _id?: string; [k: string]: any };
type Category = 'project' | 'account' | 'lead' | 'activity';
interface Item {
  id: string; type: string; category: Category; user_id: string; name: string; role?: string;
  detail: string; at: string; actor?: string; project_id?: string; lead_id?: string; quiet?: boolean;
}

const ROLE_LABEL: Record<string, string> = { buyer: 'buyer / investor', developer: 'developer', agent: 'channel partner' };

/** Activity-log types the bell shows, with their section and a fallback line. */
const LOGGED: Record<string, { category: Category; text: string; quiet?: boolean }> = {
  project_deleted: { category: 'project', text: 'Deleted a project' },
  project_approved: { category: 'project', text: 'Project approved — live on the map' },
  project_rejected: { category: 'project', text: 'Project not approved' },
  project_delete_approved: { category: 'project', text: 'Delete request approved' },
  project_delete_rejected: { category: 'project', text: 'Delete request declined' },
  project_admin_edit: { category: 'project', text: 'Project details corrected by the team' },
  project_assigned: { category: 'project', text: 'Project assigned' },
  project_unassigned: { category: 'project', text: 'Project unassigned' },
  land_added: { category: 'project', text: 'Added land — waiting for approval' },
  land_edited: { category: 'project', text: 'Edited land — waiting for approval' },
  land_deleted: { category: 'project', text: 'Deleted a land listing' },
  land_approved: { category: 'project', text: 'Land approved — visible to developers' },
  land_rejected: { category: 'project', text: 'Land not approved' },
  land_access: { category: 'account', text: 'Land access changed' },
  approved: { category: 'account', text: 'Account verified' },
  rejected: { category: 'account', text: 'Application rejected' },
  reset: { category: 'account', text: 'Account moved back to pending' },
  access: { category: 'account', text: 'Access changed' },
  role_changed: { category: 'account', text: 'Account type changed' },
  profile_edited: { category: 'account', text: 'Updated account details' },
  password_reset: { category: 'account', text: 'Changed password' },
  deleted: { category: 'account', text: 'Account deleted' },
  login: { category: 'activity', text: 'Signed in', quiet: true },
  favorite: { category: 'activity', text: 'Updated favourites', quiet: true },
  compare: { category: 'activity', text: 'Updated compare list', quiet: true },
};

const LIMIT = 60;
const RECENT_LEADS = 30;

export async function GET() {
  const [canProjects, canAccounts, canLeads] = await Promise.all([
    hasPermission('intake'), hasPermission('accounts'), hasPermission('leads'),
  ]);
  if (!canProjects && !canAccounts && !canLeads) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const me = await getCurrentUser();
  const db = await getDb();
  const none = Promise.resolve([] as Doc[]);
  // Employees only see the leads assigned to them (same rule as the CRM).
  const leadScope = me?.role === 'admin' ? {} : { assigned_to: me?.id || '__nobody' };
  const leadFields = { projection: { id: 1, name: 1, email: 1, phone: 1, whatsapp: 1, subject: 1, source: 1, pin_id: 1, account_id: 1, created_at: 1 } };

  const [mine, pins, people, logged, contacts, enquiries] = await Promise.all([
    me ? db.collection('users').findOne({ id: me.id }, { projection: { notif_seen_at: 1 } }) : null,
    canProjects || canLeads
      ? db.collection<Doc>('pins').find({}, { projection: { id: 1, title: 1, location: 1, owner_user_id: 1, created_at: 1, updated_at: 1, pending_review: 1, rejected: 1, delete_requested_at: 1 } }).toArray()
      : none,
    db.collection<Doc>('users').find({ role: { $in: ['buyer', 'developer', 'agent'] } }, { projection: { id: 1, name: 1, email: 1, role: 1, created_at: 1 } }).toArray(),
    canProjects || canAccounts ? listActivity({ limit: 400 }) : Promise.resolve([] as ActivityEvent[]),
    canLeads ? db.collection<Doc>('contact_leads').find(leadScope, leadFields).sort({ created_at: -1 }).limit(RECENT_LEADS).toArray() : none,
    canLeads ? db.collection<Doc>('leads').find(leadScope, leadFields).sort({ created_at: -1 }).limit(RECENT_LEADS).toArray() : none,
  ]);
  const seen = String(mine?.notif_seen_at || '');
  const who = new Map(people.map((u) => [String(u.id), u]));
  const nameOf = (id: string, fallback = 'Someone') => { const u = who.get(id); return u ? String(u.name || u.email) : fallback; };
  const pinTitle = new Map(pins.map((p) => [String(p.id), String(p.title || 'a project')]));

  const items: Item[] = [];

  if (canProjects) {
    for (const p of pins) {
      if (!p.owner_user_id) continue; // only projects developers submitted themselves
      const uid = String(p.owner_user_id);
      const title = `“${String(p.title || 'Untitled project')}”${p.location ? ` in ${String(p.location)}` : ''}`;
      const edited = p.updated_at && p.created_at && String(p.updated_at) > String(p.created_at) && p.pending_review;
      const state = p.pending_review ? 'waiting for approval' : p.rejected ? 'not approved' : 'live on the map';
      items.push({
        id: `pin-${p.id}-${edited ? p.updated_at : p.created_at}`, type: edited ? 'project_edited' : 'project_added', category: 'project',
        user_id: uid, name: nameOf(uid, 'A developer'), role: 'developer', project_id: String(p.id),
        detail: `${edited ? 'Edited' : 'Added'} ${title} — ${state}`, at: String(edited ? p.updated_at : p.created_at || ''),
      });
      if (p.delete_requested_at) {
        items.push({
          id: `pin-${p.id}-delreq-${p.delete_requested_at}`, type: 'project_delete_requested', category: 'project',
          user_id: uid, name: nameOf(uid, 'A developer'), role: 'developer', project_id: String(p.id),
          detail: `Asked to delete ${title} — waiting for your approval`, at: String(p.delete_requested_at),
        });
      }
    }
  }

  if (canAccounts) {
    for (const u of people) {
      if (!u.created_at) continue;
      const waits = u.role === 'developer' || u.role === 'agent';
      items.push({
        id: `signup-${u.id}`, type: 'signup', category: 'account', user_id: String(u.id), name: String(u.name || u.email), role: String(u.role),
        detail: `New ${ROLE_LABEL[String(u.role)] || 'account'} account${waits ? ' — waiting for verification' : ''}`, at: String(u.created_at),
      });
    }
  }

  for (const e of logged) {
    const kind = LOGGED[e.type];
    if (!kind) continue;
    if ((kind.category === 'project' && !canProjects) || (kind.category !== 'project' && !canAccounts)) continue;
    items.push({
      id: e.id, type: e.type, category: kind.category, user_id: e.user_id, name: e.name || nameOf(e.user_id, e.email),
      role: e.role, detail: e.detail || kind.text, at: e.at, actor: e.actor, quiet: kind.quiet,
    });
  }

  for (const c of contacts) {
    const signup = c.source === 'Buyer sign-up';
    if (signup && canAccounts) continue; // already shown as a sign-up
    items.push({
      id: `contact-${c.id || c._id}`, type: signup ? 'signup' : 'contact', category: 'lead', lead_id: String(c.id || c._id),
      user_id: String(c.account_id || ''), name: String(c.name || c.email || c.phone || 'New lead'),
      detail: signup ? 'New buyer sign-up lead' : `New enquiry${c.source ? ` (${c.source})` : ''}: ${String(c.subject || 'General enquiry')}`,
      at: String(c.created_at || ''),
    });
  }
  for (const l of enquiries) {
    items.push({
      id: `enquiry-${l.id || l._id}`, type: 'enquiry', category: 'lead', lead_id: String(l.id || l._id),
      user_id: String(l.account_id || ''), name: String(l.name || l.email || l.whatsapp || 'New lead'),
      detail: `Enquired about ${pinTitle.get(String(l.pin_id)) ? `“${pinTitle.get(String(l.pin_id))}”` : 'a project'} on the map`,
      at: String(l.created_at || ''),
    });
  }

  const week = 7 * 86400000;
  const list = items.filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIMIT)
    .map((i) => ({ ...i, unread: !i.quiet && (seen ? i.at > seen : Date.now() - new Date(i.at).getTime() < week) }));
  // Waiting for the super admin: new/edited projects and delete requests.
  const pendingProjects = canProjects ? pins.filter((p) => p.owner_user_id && (p.pending_review || p.delete_requested_at)).length : 0;
  return NextResponse.json(
    {
      data: {
        pendingProjects, unread: list.filter((i) => i.unread).length, items: list,
        sections: { project: canProjects, account: canAccounts, lead: canLeads },
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/** Mark everything as read for the signed-in staff member. */
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const db = await getDb();
  await db.collection('users').updateOne({ id: me.id }, { $set: { notif_seen_at: new Date().toISOString() } });
  return NextResponse.json({ data: { ok: true } });
}
