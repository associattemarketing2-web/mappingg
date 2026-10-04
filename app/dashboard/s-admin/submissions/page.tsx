import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Developer project reviews now live in the super admin's "Developer projects"
// tab. Old links and bookmarks to this page land there.
export default function SubmissionsPage() {
  redirect('/dashboard/s-admin?tab=projects');
}
