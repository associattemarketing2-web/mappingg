import { randomUUID } from 'node:crypto';
import { getDb } from './mongodb';

// Every buyer who creates an account also becomes a lead in the super admin's
// Leads / CRM (the "Contact" list, `contact_leads`), with what they're looking
// for from the sign-up form — so the sales team can follow up like any other
// enquiry. One lead per account (keyed by account_id), never duplicated.

type Profile = Record<string, string | undefined>;
export interface SignupAccount {
  id: string; name?: string; email: string; mobile?: string; profile?: Profile;
  provider?: 'password' | 'google'; created_at?: string;
}

/** "Looking for: 3 BHK · Budget 75L - 1.5 Cr · Area: Kharadi · …" from the buyer sign-up fields. */
export function buyerNeeds(profile: Profile = {}, provider?: string): string {
  const parts = [
    profile.configuration && `Looking for: ${profile.configuration}`,
    profile.budget && `Budget: ${profile.budget}`,
    profile.area && `Preferred area: ${profile.area}`,
    profile.timeline && `Planning to buy: ${profile.timeline}`,
    profile.purpose && `Buying for: ${profile.purpose}`,
  ].filter(Boolean) as string[];
  const how = provider === 'google' ? 'Signed up with Google' : 'Created a buyer account on Mappingg';
  return parts.length ? `${how}. ${parts.join(' · ')}` : `${how} — no preferences given yet.`;
}

/** Adds the lead for a new buyer account. Never throws (sign-up must not fail because of it). */
export async function addBuyerSignupLead(a: SignupAccount): Promise<void> {
  try {
    const db = await getDb();
    const leads = db.collection<{ _id: string; [k: string]: unknown }>('contact_leads');
    if (await leads.findOne({ account_id: a.id }, { projection: { id: 1 } })) return;
    const id = randomUUID();
    const now = a.created_at || new Date().toISOString();
    await leads.insertOne({
      _id: id, id,
      name: a.name || a.email.split('@')[0],
      email: a.email,
      phone: a.mobile || '',
      subject: 'New buyer account',
      message: buyerNeeds(a.profile, a.provider),
      source: 'Buyer sign-up',
      account_id: a.id,
      status: 'new', notes: '',
      created_at: now, updated_at: now,
    });
  } catch (e) {
    console.warn('[signup-leads] could not add lead:', e instanceof Error ? e.message : e);
  }
}

/** A buyer signed in: make sure they have a lead and stamp it with the login, so
 *  the Leads section shows who is active. Never throws. */
export async function touchBuyerLead(userId: string): Promise<void> {
  try {
    const db = await getDb();
    const u = await db.collection('users').findOne({ id: userId }, { projection: { id: 1, role: 1, name: 1, email: 1, mobile: 1, profile: 1, provider: 1, created_at: 1, last_login_at: 1, login_count: 1 } });
    if (!u || u.role !== 'buyer') return;
    await addBuyerSignupLead({
      id: String(u.id), name: u.name as string | undefined, email: String(u.email), mobile: u.mobile as string | undefined,
      profile: u.profile as Profile | undefined, provider: u.provider === 'google' ? 'google' : 'password', created_at: u.created_at as string | undefined,
    });
    const now = new Date().toISOString();
    await db.collection('contact_leads').updateOne(
      { account_id: String(u.id) },
      { $set: { last_login_at: (u.last_login_at as string) || now, login_count: Number(u.login_count) || 1, updated_at: now } },
    );
  } catch (e) {
    console.warn('[signup-leads] could not update lead on login:', e instanceof Error ? e.message : e);
  }
}
