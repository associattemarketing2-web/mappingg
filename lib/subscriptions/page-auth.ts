import { redirect } from 'next/navigation';
import { getCurrentUser, homePathFor, isStaffRole } from '../auth';
import { getDb } from '../mongodb';
import { verificationOf } from '../verification';

// Shared access check for the account pages under /dashboard/<role>/… that the
// subscription system adds. Same rules as /dashboard/<role>: the URL role must
// be the account's real role, staff go to the super-admin, and developers /
// channel partners must be approved first.
export async function requireAccountPage(urlRole: string, allowed: ('developer' | 'agent' | 'buyer')[]) {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');
  if (isStaffRole(session.role)) redirect('/dashboard/s-admin');
  const doc = await (await getDb()).collection('users').findOne({ id: session.id }, { projection: { id: 1, role: 1, email: 1, name: 1, verification: 1, verified: 1, profile: 1 } });
  if (!doc) redirect('/?signin=1');
  const role = String(doc.role || 'buyer') as 'developer' | 'agent' | 'buyer';
  if (urlRole !== role || !allowed.includes(role)) redirect(homePathFor(role));
  if (role !== 'buyer' && verificationOf(doc) !== 'approved') redirect(`/dashboard/${role}`);
  // The plan picked on the sign-up form (lib/signup-profile.ts), if any.
  const signupPlan = typeof doc.profile?.plan === 'string' && doc.profile.plan ? String(doc.profile.plan).slice(0, 40) : null;
  return { user: { id: session.id, email: session.email, role }, name: String(doc.name || ''), signupPlan };
}
