import { redirect } from 'next/navigation';

// Clean role aliases — /dashboard/developer, /dashboard/buyer, /dashboard/agent —
// all resolve to the single adaptive dashboard, which renders the right view
// from the signed-in account's actual role (the source of truth for access).
export const dynamic = 'force-dynamic';

export default function DashboardRoleAlias() {
  redirect('/dashboard');
}
