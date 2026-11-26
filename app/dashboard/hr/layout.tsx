import type { Metadata, Viewport } from 'next';
import './hr.css';
import { ToastHost } from '@/components/hr/ui';

// HR & Attendance (the employee-management system) inside Mappingg. Sign-in is
// Mappingg's own: the owner is the HR admin, staff employees use the employee app.
// Who may open which half is checked in admin/layout.tsx and employee/layout.tsx.
export const metadata: Metadata = {
  title: 'HR & Attendance — Mappingg',
  description: 'Attendance, selfie check-in, tasks, leaves and payroll',
  robots: { index: false, follow: false, nocache: true },
  // Employees can install it on their phone for daily check-in.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Mappingg', statusBarStyle: 'default' },
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = { themeColor: '#0f5c47', width: 'device-width', initialScale: 1, maximumScale: 1 };

export default function HrLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ems">
      {children}
      <ToastHost />
    </div>
  );
}
