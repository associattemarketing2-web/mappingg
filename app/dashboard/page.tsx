import { redirect } from 'next/navigation';
import { getCurrentUser, homePathFor } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { homeForAccount } from '@/lib/verification';

export const dynamic = 'force-dynamic';

// Dispatcher: send a signed-in user to their canonical dashboard URL
//   staff → /s-admin ·  developer/agent/buyer → /dashboard/<role>
//   view-only developers → straight to the public live map (/map)
// The actual dashboards render in /dashboard/[role]; guests get the sign-in modal.
export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');
  let home = homePathFor(session.role);
  if (session.role === 'developer') {
    const db = await getDb();
    const doc = await db.collection('users').findOne({ id: session.id }, { projection: { role: 1, access: 1, verification: 1, verified: 1 } });
    home = homeForAccount(doc, home);
  }
  redirect(home);
}
