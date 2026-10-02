import { getCurrentUser } from '@/lib/auth';
import { getStaffByEmail } from '@/lib/staff';
import AdminApp, { type AdminUser } from '@/components/admin/AdminApp';

export const dynamic = 'force-dynamic';

// The entire super-admin lives on this one page as tabs. Access to each tab is
// decided by the signed-in user's role/permissions (owner sees everything).
export default async function AdminHome() {
  const session = await getCurrentUser();
  const staff = session ? await getStaffByEmail(session.email) : null;

  const user: AdminUser = {
    email: session?.email || '',
    name: staff?.name || '',
    role: staff?.role || session?.role || 'employee',
    permissions: staff?.permissions || [],
    avatar: staff?.avatar || '',
  };

  return <AdminApp user={user} />;
}
