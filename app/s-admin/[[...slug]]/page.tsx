import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The super-admin moved to /dashboard/s-admin. Old /s-admin (and any sub-path
// like /s-admin/map, /s-admin/submissions) permanently redirects there so
// existing bookmarks, the installed-app lock and shared links keep working.
export default function LegacySAdminRedirect({ params }: { params: { slug?: string[] } }) {
  const rest = params.slug?.length ? `/${params.slug.join('/')}` : '';
  redirect(`/dashboard/s-admin${rest}`);
}
