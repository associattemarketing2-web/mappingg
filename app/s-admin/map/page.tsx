import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';

// The full map & pin editor (original team editor). Embedded inside the admin
// "Map Editor" tab via an iframe. Auth is enforced by the parent admin layout;
// every write is also enforced server-side by the authenticated API.
export const dynamic = 'force-dynamic';

export default function AdminMapEditor() {
  return (
    <>
      <LegacyPreloads slug="team-editor" />
      <LegacyApp slug="team-editor" />
    </>
  );
}
