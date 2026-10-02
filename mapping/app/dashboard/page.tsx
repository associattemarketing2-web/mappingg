import { redirect } from 'next/navigation';
import { getCurrentUser, homePathFor } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { getSeoProjects } from '@/lib/seo-data';
import RoleDashboard, { type DashboardAccount } from '@/components/dashboard/RoleDashboard';
import ReviewScreen from '@/components/dashboard/ReviewScreen';
import { verificationOf } from '@/lib/verification';

export const dynamic = 'force-dynamic';

// Dashboards for developers and channel partners; the account's role decides
// which one renders. Staff go to the super-admin, buyers to the live map only,
// guests to the sign-in modal.
export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');
  const home = homePathFor(session.role);
  if (home !== '/dashboard') redirect(home);

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: session.email.toLowerCase() });
  if (!doc) redirect('/?signin=1');

  const role = (['buyer', 'developer', 'agent'] as const).find((r) => r === doc.role) || 'buyer';

  // Developers and agents only get their dashboard once the super admin has
  // approved them; until then they see their submitted details and status.
  const status = verificationOf(doc);
  if (role !== 'buyer' && status !== 'approved') {
    return (
      <ReviewScreen
        account={{
          name: String(doc.name || ''), email: String(doc.email || ''), mobile: String(doc.mobile || ''),
          role, status, note: String(doc.verification_note || ''), created_at: String(doc.created_at || ''),
          profile: (doc.profile as Record<string, string>) || {},
        }}
      />
    );
  }

  const account: DashboardAccount = {
    name: String(doc.name || ''),
    email: String(doc.email || ''),
    mobile: String(doc.mobile || ''),
    role,
    verified: status === 'approved',
    created_at: String(doc.created_at || ''),
    profile: (doc.profile as Record<string, string>) || {},
  };

  const projects = await getSeoProjects();
  return <RoleDashboard account={account} projects={projects} />;
}
