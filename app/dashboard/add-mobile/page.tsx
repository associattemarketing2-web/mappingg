import { redirect } from 'next/navigation';
import { getCurrentUser, homePathFor, isStaffRole } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { homeForAccount, needsMobile } from '@/lib/verification';
import AddMobileForm from '@/components/dashboard/AddMobileForm';

export const dynamic = 'force-dynamic';

// "Add your mobile number" — the one extra step after Google sign-in (Google
// gives us no phone) and for any older account saved without one. Accounts that
// already have a valid number go straight on to their home.
export default async function AddMobilePage() {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');
  if (isStaffRole(session.role)) redirect('/dashboard/s-admin');

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: session.email.toLowerCase() });
  if (!doc) redirect('/?signin=1');
  if (!needsMobile(doc)) redirect(homeForAccount(doc, homePathFor(String(doc.role || 'buyer'))));

  return <AddMobileForm name={String(doc.name || '')} email={String(doc.email || '')} google={doc.provider === 'google'} />;
}
