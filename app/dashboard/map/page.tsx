import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { verificationOf } from '@/lib/verification';
import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';

export const dynamic = 'force-dynamic';

// Developer Map Editor — the SAME legacy editor the super-admin uses. Every pin
// read/write is owner-scoped server-side (see /api/db + lib/db-engine), so a
// developer only ever sees and edits their own projects, and each new/edited pin
// is held for super-admin review before it goes live. Embedded as the "Map
// Editor" tab inside the developer panel. Gated to approved developers only.
export default async function DeveloperMapEditor() {
  const user = await getCurrentUser();
  if (!user) redirect('/?signin=1');
  if (user.role !== 'developer') redirect('/dashboard');

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: user.email.toLowerCase() });
  if (!doc || verificationOf(doc) !== 'approved') redirect('/dashboard');

  return (
    <>
      {/* Tell db-shim.js this is the developer's own editor, so a developer
          session counts as signed-in here (writes stay owner-scoped + held for
          review server-side). Must run before the legacy bundle boots. */}
      <script dangerouslySetInnerHTML={{ __html: 'window.MAPPINGG_DEV_EDIT=true;' }} />
      <LegacyPreloads slug="team-editor" />
      <LegacyApp slug="team-editor" />
    </>
  );
}
