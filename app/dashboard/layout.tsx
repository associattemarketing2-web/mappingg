import type { Metadata } from 'next';
import './dashboard.css';

// Personal dashboards for public accounts (buyer / developer / channel partner).
// Access control lives in page.tsx, which needs the session anyway.
export const metadata: Metadata = {
  title: 'My Dashboard — Mappingg',
  robots: { index: false, follow: false, nocache: true },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      />
      {children}
    </>
  );
}
