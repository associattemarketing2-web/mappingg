import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import './admin.css';
import InstallPrompt from '@/components/InstallPrompt';
import { getCurrentUser, homePathFor, isStaffRole } from '@/lib/auth';

// The whole super-admin area is gated here: no valid session → the home page,
// which auto-opens the sign-in modal via ?admin=1. Never indexed.
//
// Installing Mappingg as an app is for the super admin only: the web-app
// manifest link, the iOS home-screen tags and the "Install app" button are all
// emitted here, and only when the signed-in user's role is "admin".
export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  const canInstall = user?.role === 'admin';
  return {
    title: 'Super Admin — Mappingg',
    robots: { index: false, follow: false, nocache: true },
    ...(canInstall && {
      manifest: '/manifest.webmanifest',
      appleWebApp: { capable: true, title: 'Mappingg', statusBarStyle: 'default' },
    }),
  };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/?admin=1');
  // Buyers, developers and agents have their own dashboard, not the super-admin.
  if (!isStaffRole(user.role)) redirect(homePathFor(user.role));

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      />
      {children}
      {user.role === 'admin' && <InstallPrompt />}
    </>
  );
}
