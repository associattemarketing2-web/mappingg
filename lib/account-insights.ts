import { getDb } from './mongodb';
import { listActivity, lastActivityByUser, type ActivityEvent } from './activity';

// Per-account activity for the super admin's Accounts page. Combines the live
// activity log (lib/activity.ts) with events rebuilt from data the site already
// stores — sign-up and verification dates on the account, map enquiries and
// contact-form messages matched by email / WhatsApp number, and a developer's
// projects — so accounts created before the log existed still have a history.

type AnyDoc = { _id: string; [key: string]: any };
export interface AccountLite { id: string; email: string; name?: string; role: string; mobile?: string; created_at?: string; verification?: string; verified_at?: string | null; verified_by?: string | null; verification_note?: string; last_login_at?: string; login_count?: number; compare_pins?: unknown[] }
export interface AccountStats { enquiries: number; contacts: number; projects: number; logins: number; compare: number; lastActive: string | null }

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

async function sources() {
  const db = await getDb();
  const [leads, contacts, pins, pinTitles] = await Promise.all([
    db.collection<AnyDoc>('leads').find({}, { projection: { email: 1, whatsapp: 1, name: 1, pin_id: 1, created_at: 1 } }).toArray(),
    db.collection<AnyDoc>('contact_leads').find({}, { projection: { email: 1, phone: 1, subject: 1, created_at: 1 } }).toArray(),
    db.collection<AnyDoc>('pins').find({ owner_user_id: { $exists: true } }, { projection: { owner_user_id: 1, title: 1, created_at: 1, pending_review: 1, hidden: 1, rejected: 1 } }).toArray(),
    db.collection<AnyDoc>('pins').find({}, { projection: { id: 1, title: 1 } }).toArray(),
  ]);
  const titles = new Map(pinTitles.map((p) => [String(p.id), String(p.title || 'a project')]));
  return { leads, contacts, pins, titles };
}

function belongs(a: AccountLite) {
  const email = lower(a.email);
  const phone = digits(a.mobile);
  return (e: unknown, p: unknown) => (!!email && lower(e) === email) || (phone.length === 10 && digits(p) === phone);
}

/** Small per-account numbers for the accounts list. */
export async function accountStats(accounts: AccountLite[]): Promise<Map<string, AccountStats>> {
  const [{ leads, contacts, pins }, last] = await Promise.all([sources(), lastActivityByUser()]);
  const out = new Map<string, AccountStats>();
  for (const a of accounts) {
    const mine = belongs(a);
    const times = [last.get(a.id), a.last_login_at, a.created_at].filter(Boolean) as string[];
    const myLeads = leads.filter((l) => mine(l.email, l.whatsapp));
    const myContacts = contacts.filter((c) => mine(c.email, c.phone));
    times.push(...myLeads.map((l) => l.created_at), ...myContacts.map((c) => c.created_at));
    out.set(a.id, {
      enquiries: myLeads.length,
      contacts: myContacts.length,
      projects: pins.filter((p) => String(p.owner_user_id) === a.id).length,
      logins: Number(a.login_count) || 0,
      compare: Array.isArray(a.compare_pins) ? a.compare_pins.length : 0,
      lastActive: times.filter(Boolean).sort().pop() || null,
    });
  }
  return out;
}

/** Events rebuilt from stored data for one account (de-duplicated against the live log). */
function derivedFor(a: AccountLite, logged: ActivityEvent[], src: Awaited<ReturnType<typeof sources>>): ActivityEvent[] {
  const base = { user_id: a.id, email: a.email, name: a.name, role: a.role, derived: true };
  const has = (type: string) => logged.some((e) => e.type === type);
  const mine = belongs(a);
  const out: ActivityEvent[] = [];
  if (a.created_at && !has('signup')) {
    out.push({ ...base, id: `d-signup-${a.id}`, type: 'signup', at: a.created_at, detail: 'Account created' });
  }
  if (a.verified_at && (a.verification === 'approved' || a.verification === 'rejected') && !has(a.verification)) {
    out.push({
      ...base, id: `d-verify-${a.id}`, type: a.verification as 'approved' | 'rejected', at: a.verified_at, actor: a.verified_by || undefined,
      detail: a.verification === 'approved' ? 'Account verified — dashboard unlocked' : `Application rejected${a.verification_note ? `: ${a.verification_note}` : ''}`,
    });
  }
  if (a.last_login_at && !has('login')) {
    out.push({ ...base, id: `d-login-${a.id}`, type: 'login', at: a.last_login_at, detail: 'Last sign-in' });
  }
  for (const l of src.leads) {
    if (!l.created_at || !mine(l.email, l.whatsapp)) continue;
    out.push({ ...base, id: `d-lead-${l._id}`, type: 'enquiry', at: l.created_at, detail: `Enquired about ${src.titles.get(String(l.pin_id)) || 'a project'} on the map` });
  }
  for (const c of src.contacts) {
    if (!c.created_at || !mine(c.email, c.phone)) continue;
    out.push({ ...base, id: `d-contact-${c._id}`, type: 'contact', at: c.created_at, detail: `Contact form: ${c.subject || 'General enquiry'}` });
  }
  if (!has('project_added')) {
    for (const p of src.pins) {
      if (String(p.owner_user_id) !== a.id || !p.created_at) continue;
      out.push({ ...base, id: `d-pin-${p._id}`, type: 'project_added', at: p.created_at, detail: `Added “${p.title || 'Untitled project'}”` });
    }
  }
  return out;
}

const byNewest = (x: ActivityEvent, y: ActivityEvent) => String(y.at).localeCompare(String(x.at));

/** Full timeline for one account. */
export async function accountTimeline(a: AccountLite): Promise<ActivityEvent[]> {
  const [logged, src] = await Promise.all([listActivity({ userId: a.id, limit: 500 }), sources()]);
  return [...logged, ...derivedFor(a, logged, src)].sort(byNewest);
}

/** Recent activity across all accounts, for the activity feed. */
export async function activityFeed(accounts: AccountLite[], limit = 80): Promise<ActivityEvent[]> {
  const [logged, src] = await Promise.all([listActivity({ limit: 400 }), sources()]);
  const byUser = new Map<string, ActivityEvent[]>();
  for (const e of logged) byUser.set(e.user_id, [...(byUser.get(e.user_id) || []), e]);
  const known = new Map(accounts.map((a) => [a.id, a]));
  // Fill in the current name/role for logged events.
  const enriched = logged.map((e) => {
    const a = known.get(e.user_id);
    return a ? { ...e, name: a.name || e.name, role: a.role || e.role } : e;
  });
  const derived = accounts.flatMap((a) => derivedFor(a, byUser.get(a.id) || [], src));
  return [...enriched, ...derived].sort(byNewest).slice(0, limit);
}
