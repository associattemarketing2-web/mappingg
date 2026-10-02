import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The signed-in user's own profile (name + circular avatar). Email/role/permissions
// are read-only here (role & access are managed from the Employees tab).

// Avatar is stored inline as a data: URL. Cap it so a huge upload can't bloat the
// user document (a ~1 MB image becomes ~1.37 MB base64).
const MAX_AVATAR = 1_500_000;

const schema = z.object({
  name: z.string().max(80).optional(),
  avatar: z.string().max(MAX_AVATAR).optional(),
});

export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const db = await getDb();
  const user = await db.collection('users').findOne({ email: session.email.toLowerCase() });
  if (!user) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });

  return NextResponse.json({
    data: {
      name: (user.name as string) || '',
      email: String(user.email || ''),
      role: String(user.role || 'employee'),
      permissions: Array.isArray(user.permissions) ? user.permissions : [],
      avatar: (user.avatar as string) || '',
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Image is too large (max ~1 MB) — use a smaller one.' } }, { status: 400 });
  }
  const { name, avatar } = parsed.data;

  // An avatar, if provided, must be an inline image data URL (or blank to clear it).
  if (avatar && avatar !== '' && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(avatar)) {
    return NextResponse.json({ error: { message: 'Please choose a JPG, PNG, WebP or GIF image.' } }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof name === 'string') patch.name = name.trim();
  if (typeof avatar === 'string') patch.avatar = avatar;

  const db = await getDb();
  await db.collection('users').updateOne({ email: session.email.toLowerCase() }, { $set: patch });

  const user = await db.collection('users').findOne({ email: session.email.toLowerCase() });
  return NextResponse.json({
    data: {
      name: (user?.name as string) || '',
      email: String(user?.email || ''),
      role: String(user?.role || 'employee'),
      permissions: Array.isArray(user?.permissions) ? user!.permissions : [],
      avatar: (user?.avatar as string) || '',
    },
  });
}
