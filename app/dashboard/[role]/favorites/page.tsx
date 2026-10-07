import { redirect } from 'next/navigation';
import '@/app/dashboard/s-admin/admin.css';
import { getCurrentUser, homePathFor } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { withMediaUrls } from '@/lib/pin-media';
import { slugForProject } from '@/lib/seo/entities';
import { verificationOf } from '@/lib/verification';
import type { Pin } from '@/models';
import FavoriteCollection, { type FavCard } from '@/components/dashboard/FavoriteCollection';

export const dynamic = 'force-dynamic';

// /dashboard/agent/favorites — an agent / channel partner's favourite projects
// (the pins they hearted on the live map), as a collection of project cards.
// Opened from the ❤ Favourites button on the map's toolbar.

// Card details, each with the field_visibility id the admin uses to hide it on
// the public project card (the live map follows the same rule).
const FIELDS: { key: keyof Pin | 'rera_number'; vis: string }[] = [
  { key: 'developer', vis: 'developer' },
  { key: 'location', vis: 'location' },
  { key: 'status', vis: 'status' },
  { key: 'type', vis: 'type' },
  { key: 'rera_number', vis: 'rera' },
  { key: 'configuration', vis: 'configuration' },
  { key: 'sqft', vis: 'configuration' },
  { key: 'price', vis: 'price' },
  { key: 'possession_timeline', vis: 'possession' },
  { key: 'launch_date', vis: 'possession' },
];

export default async function FavoritesPage({ params }: { params: { role: string } }) {
  const session = await getCurrentUser();
  if (!session) redirect('/?signin=1');

  const db = await getDb();
  const doc = await db.collection('users').findOne({ id: session.id });
  if (!doc) redirect('/?signin=1');
  // Only approved agents have favourites; everyone else goes to their own home.
  if (doc.role !== 'agent' || params.role !== 'agent') redirect(homePathFor(String(doc.role || '')));
  if (verificationOf(doc) !== 'approved') redirect('/dashboard/agent');

  const ids: string[] = Array.isArray(doc.favorite_pins) ? doc.favorite_pins.map(String) : [];
  const projection: Record<string, 1> = { id: 1, number: 1, title: 1, field_visibility: 1, image: 1, image_meta: 1, key_usp: 1 };
  FIELDS.forEach((f) => { projection[f.key] = 1; });
  const rows = ids.length
    ? (await db.collection('pins').find({ id: { $in: ids }, hidden: { $ne: true } }, { projection }).toArray()) as unknown as Record<string, unknown>[]
    : [];
  const withImages = withMediaUrls('pins', rows, { width: 480 }) as Record<string, unknown>[];
  const byId = new Map(withImages.map((r) => [String(r.id), r]));

  // Keep the order they were saved in (newest first on the map's list).
  const cards: FavCard[] = ids.map((id) => byId.get(id)).filter(Boolean).map((r) => {
    const row = r as Record<string, unknown>;
    const vis = (row.field_visibility || {}) as Record<string, unknown>;
    const val = (k: string, v: string) => (vis[v] === false ? '' : String(row[k] || ''));
    const image = typeof row.image === 'string' && /^(https?:|\/api\/)/.test(row.image) ? row.image : '';
    return {
      id: String(row.id),
      number: typeof row.number === 'number' ? row.number : null,
      title: String(row.title || ''),
      slug: slugForProject(row as unknown as Parameters<typeof slugForProject>[0]),
      image,
      developer: val('developer', 'developer'),
      location: val('location', 'location'),
      status: val('status', 'status'),
      type: val('type', 'type'),
      rera: val('rera_number', 'rera'),
      configuration: val('configuration', 'configuration'),
      sqft: val('sqft', 'configuration'),
      price: val('price', 'price'),
      possession: row.status === 'upcoming'
        ? (val('launch_date', 'possession') ? `Launching ${val('launch_date', 'possession')}` : '')
        : val('possession_timeline', 'possession'),
    };
  });

  return <FavoriteCollection name={String(doc.name || '')} initial={cards} />;
}
