import { redirect } from 'next/navigation';
import '@/app/dashboard/s-admin/admin.css';
import { getCurrentUser, homePathFor, isStaffRole } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { getSeoProjects } from '@/lib/seo-data';
import RoleDashboard, { type DashboardAccount } from '@/components/dashboard/RoleDashboard';
import DeveloperApp from '@/components/dashboard/DeveloperApp';
import ReviewScreen from '@/components/dashboard/ReviewScreen';
import { accessOf, verificationOf } from '@/lib/verification';

export const dynamic = 'force-dynamic';

// Per-role dashboards at a consistent URL:
//   /dashboard/developer · /dashboard/agent · /dashboard/buyer
// The super-admin is the static sibling route /dashboard/s-admin; staff who hit a
// per-role URL are sent there. The account's actual role is the source of truth:
// if the URL role doesn't match, we redirect to theirs.
export default async function DashboardRolePage({ params }: { params: { role: string } }) {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');

  // Staff never use the per-role URLs; send them to the super-admin.
  if (isStaffRole(session.role)) redirect('/dashboard/s-admin');

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: session.email.toLowerCase() });
  if (!doc) redirect('/?signin=1');

  const role = (['buyer', 'developer', 'agent'] as const).find((r) => r === doc.role) || 'buyer';
  // Canonical URL is /dashboard/<actual role>. Anything else (wrong role in the
  // URL, or /dashboard/s-admin for a non-staff account) goes to the right one.
  if (params.role !== role) redirect(homePathFor(doc.role as string));

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

  // Developers approved as "Viewer" have no dashboard — they go straight to the
  // public live map (the same one every visitor sees).
  if (role === 'developer' && accessOf(doc) === 'viewer') redirect('/map');

  // Approved developers get the full s-admin-style control panel (Dashboard,
  // Map Editor, Projects Intake) — scoped to their own projects.
  if (role === 'developer') {
    return <DeveloperApp user={{ email: String(doc.email || ''), name: String(doc.name || '') }} />;
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
