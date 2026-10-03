import { redirect } from 'next/navigation';
import { getCurrentUser, homePathFor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Dispatcher: send a signed-in user to their canonical dashboard URL
//   staff → /s-admin ·  developer/agent/buyer → /dashboard/<role>
// The actual dashboards render in /dashboard/[role]; guests get the sign-in modal.
export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');
  redirect(homePathFor(session.role));
}
