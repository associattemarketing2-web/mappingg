import { query } from './pg';
import { getDb, getMongoDb, usingMongo } from './mongodb';
import { PUBLIC_ROLES } from './auth';
import { ANONYMISED_ACTIVITY, anonymisedLeadPatch } from './account-deletion-rules';

// Self-service account deletion (Google Play and App Store both require it).
// Used by POST /api/my/account/delete, from the mobile app and /delete-account.
//
// What happens to the person's data (decided by the owner, 2 Nov 2026):
//  - the account row is deleted for good. No recycle-bin copy is kept;
//  - their enquiries (`leads`) and buyer sign-up lead (`contact_leads`) stay for
//    statistics, but name, email, phone, notes and message are wiped;
//  - a developer's projects stay on the map, unlinked from the account;
//  - their account activity log entries lose email, name, IP and device.
// Keep the /delete-account page and the Privacy Policy in step with this list.

const isMissingTable = (e: unknown) => (e as { code?: string })?.code === '42P01';

/** Unlinks a developer's projects from the account. They stay on the map. Returns how many. */
async function unlinkProjects(userId: string): Promise<number> {
  if (usingMongo()) {
    const r = await (await getMongoDb()).collection('pins').updateMany({ owner_user_id: userId }, { $unset: { owner_user_id: '' } });
    return r.modifiedCount;
  }
  // The Mongo-compatible layer has no $unset, so remove the key in SQL.
  const r = await query(`UPDATE "pins" SET doc = doc - 'owner_user_id' WHERE doc->>'owner_user_id' = $1`, [userId]);
  return r.rowCount ?? 0;
}

/** Wipes personal details from every activity entry of the account. Safe to run more than once. */
export async function anonymiseActivity(userId: string): Promise<void> {
  try {
    if (usingMongo()) {
      await (await getMongoDb()).collection('account_activity').updateMany({ user_id: userId }, { $set: { ...ANONYMISED_ACTIVITY } });
      return;
    }
    await query(`UPDATE "account_activity" SET doc = doc || $2::jsonb WHERE doc->>'user_id' = $1`, [userId, JSON.stringify(ANONYMISED_ACTIVITY)]);
  } catch (e) {
    if (!isMissingTable(e)) throw e; // no activity table yet = nothing to wipe
  }
}

export interface DeletionSummary {
  leads: number;
  signupLeads: number;
  projects: number;
}

/**
 * Deletes a public (buyer / developer / agent) account and anonymises what
 * points at it. The account row goes last, so if anything fails halfway the
 * account still exists and the person can simply try again; every step is
 * safe to repeat. Never touches staff accounts.
 */
export async function deleteAccountData(userId: string): Promise<DeletionSummary> {
  const db = await getDb();
  const patch = anonymisedLeadPatch(new Date().toISOString());
  const leads = (await db.collection('leads').updateMany({ account_id: userId }, { $set: patch })).modifiedCount;
  const signupLeads = (await db.collection('contact_leads').updateMany({ account_id: userId }, { $set: patch })).modifiedCount;
  const projects = await unlinkProjects(userId);
  await anonymiseActivity(userId);
  await db.collection('users').deleteOne({ id: userId, role: { $in: [...PUBLIC_ROLES] } });
  return { leads, signupLeads, projects };
}
