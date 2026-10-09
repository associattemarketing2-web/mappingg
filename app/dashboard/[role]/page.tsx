import { redirect } from 'next/navigation';
import '@/app/dashboard/s-admin/admin.css';
import { getCurrentUser, homePathFor, isStaffRole } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { getSeoProjects } from '@/lib/seo-data';
import AgentProfile, { type AgentAccount } from '@/components/dashboard/AgentProfile';
import DeveloperApp from '@/components/dashboard/DeveloperApp';
import BuyerProfile from '@/components/dashboard/BuyerProfile';
import ReviewScreen from '@/components/dashboard/ReviewScreen';
import { ADD_MOBILE_PATH, accessOf, needsMobile, verificationOf } from '@/lib/verification';

export const dynamic = 'force-dynamic';

// Per-role pages at a consistent URL:
//   /dashboard/developer (dashboard) · /dashboard/agent and /dashboard/buyer
//   (profile pages only — the live map is their home)
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

  // No mobile number yet (e.g. signed up with Google) → ask for it first.
  if (needsMobile(doc)) redirect(ADD_MOBILE_PATH);

  // Buyers: no dashboard, just their profile (the live map is their home).
  if (role === 'buyer') return <BuyerProfile />;

  // Developers and agents only get their page once the super admin has
  // approved them; until then they see their submitted details and status.
  const status = verificationOf(doc);
  if (status !== 'approved') {
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

  // Approved agents / channel partners: no dashboard — the live map is their
  // home (like buyers). This is their profile page, with the projects they
  // enquired about while signed in.
  const enquiries = await db.collection('leads')
    .find({ account_id: String(doc.id) }, { projection: { pin_id: 1, created_at: 1, last_enquired_at: 1, enquiry_clicks: 1 } })
    .sort({ created_at: -1 }).limit(100).toArray();
  const account: AgentAccount = {
    name: String(doc.name || ''),
    email: String(doc.email || ''),
    mobile: String(doc.mobile || ''),
    created_at: String(doc.created_at || ''),
    profile: (doc.profile as Record<string, string>) || {},
    enquiries: enquiries.map((r) => ({
      pin_id: String(r.pin_id || ''),
      at: String(r.last_enquired_at || r.created_at || ''),
      times: Number(r.enquiry_clicks) || 1,
    })).filter((e) => e.pin_id),
    last_login_at: String(doc.last_login_at || ''),
    login_count: Number(doc.login_count || 0),
  };

  const projects = await getSeoProjects();
  return <AgentProfile account={account} projects={projects} />;
}
