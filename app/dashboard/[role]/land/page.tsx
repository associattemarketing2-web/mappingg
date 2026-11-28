import { redirect } from 'next/navigation';
import '@/app/dashboard/s-admin/admin.css';
import { getCurrentUser, homePathFor } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { verificationOf } from '@/lib/verification';
import AgentLands from '@/components/dashboard/AgentLands';

export const dynamic = 'force-dynamic';

// /dashboard/agent/land — a channel partner's own land listings (see lib/lands.ts).
// Developers see approved land inside their panel (Developer panel → Land).
export default async function LandPage({ params }: { params: { role: string } }) {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');
  const db = await getDb();
  const doc = await db.collection('users').findOne({ id: session.id });
  if (!doc) redirect('/?signin=1');
  const role = String(doc.role || '');
  if (role !== 'agent' || params.role !== 'agent') redirect(homePathFor(role));
  if (verificationOf(doc) !== 'approved') redirect('/dashboard/agent');
  return <AgentLands name={String(doc.name || '')} />;
}
