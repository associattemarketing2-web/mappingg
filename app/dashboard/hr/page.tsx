import { redirect } from 'next/navigation';
import { getHrAccess } from '@/lib/hr/auth';
import HrNotice from '@/components/hr/HrNotice';

export const dynamic = 'force-dynamic';

export default async function HrHome() {
  const a = await getHrAccess();
  if (a.kind === 'signed-out') redirect('/?signin=1');
  if (a.kind === 'not-staff') redirect('/map');
  if (a.kind !== 'ok') return <HrNotice kind={a.kind} />;
  redirect(a.session.role === 'ADMIN' ? '/dashboard/hr/admin' : '/dashboard/hr/employee');
}
