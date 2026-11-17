import type { Metadata } from 'next';
import AccountShell from '@/components/subscriptions/AccountShell';
import CpCrm from '@/components/subscriptions/CpCrm';
import { requireAccountPage } from '@/lib/subscriptions/page-auth';
import { getSeoProjects } from '@/lib/seo-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leads & CRM — Mappingg', robots: { index: false, follow: false, nocache: true } };

// /dashboard/agent/crm — a channel partner's private client leads and CRM.
export default async function CrmPage({ params }: { params: { role: string } }) {
  await requireAccountPage(params.role, ['agent']);
  const projects = (await getSeoProjects().catch(() => [])).map((p) => ({ id: p.id, title: p.title || `Project #${p.number ?? ''}`, location: p.location || '' }));
  return (
    <AccountShell role="agent" active="/dashboard/agent/crm" title="Leads & CRM" intro="Your own client leads — private to you. Nothing here is shared with other partners or developers.">
      <CpCrm projects={projects} />
    </AccountShell>
  );
}
