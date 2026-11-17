import type { Metadata } from 'next';
import AccountShell from '@/components/subscriptions/AccountShell';
import SubscriptionCenter from '@/components/subscriptions/SubscriptionCenter';
import { requireAccountPage } from '@/lib/subscriptions/page-auth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My subscription — Mappingg', robots: { index: false, follow: false, nocache: true } };

// /dashboard/<developer|agent|buyer>/subscription — plan, usage, checkout,
// payments and invoices for the signed-in account (data loads client-side
// from /api/subscriptions/*, all scoped to the session on the server).
export default async function SubscriptionPage({ params, searchParams }: { params: { role: string }; searchParams: { plan?: string } }) {
  const { user, signupPlan } = await requireAccountPage(params.role, ['developer', 'agent', 'buyer']);
  const plan = typeof searchParams.plan === 'string' ? searchParams.plan.slice(0, 40) : null;
  return (
    <AccountShell role={user.role} active={`/dashboard/${user.role}/subscription`} title="My subscription" intro="Your plan, usage, payments and invoices.">
      <SubscriptionCenter email={user.email} initialPlan={plan} signupPlan={signupPlan} />
    </AccountShell>
  );
}
