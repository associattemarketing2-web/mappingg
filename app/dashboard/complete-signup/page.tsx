import { redirect } from 'next/navigation';
import { getCurrentUser, homePathFor } from '@/lib/auth';
import { getPendingGoogleSignup } from '@/lib/google-signup';
import GoogleSignupForm from '@/components/dashboard/GoogleSignupForm';

export const dynamic = 'force-dynamic';

// "Complete your sign-up" — the full sign-up form for a first-time Google
// sign-in. No account exists yet; it is created when this form is submitted.
export default async function CompleteSignupPage({ searchParams }: { searchParams: { role?: string } }) {
  const pending = await getPendingGoogleSignup();
  if (!pending) {
    const session = await getCurrentUser();
    redirect(session ? homePathFor(session.role) : '/?signin=1');
  }
  const role = ['buyer', 'developer', 'agent'].includes(String(searchParams.role)) ? (searchParams.role as 'buyer' | 'developer' | 'agent') : 'buyer';
  return <GoogleSignupForm name={pending.name} email={pending.email} initialRole={role} />;
}
