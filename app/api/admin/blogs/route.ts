import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { hasPermission } from '@/lib/staff';
import { listAll, getById, createPost, updatePost, deletePost } from '@/lib/blog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Refresh the public, cached surfaces so a publish/edit/delete shows up at once.
function revalidateBlog(slug?: string) {
  try {
    revalidatePath('/blog');
    revalidatePath('/sitemap.xml');
    if (slug) revalidatePath(`/blog/${slug}`);
  } catch {
    /* revalidation is best-effort */
  }
}

// A single collection endpoint (no dynamic [id] segment — that combination has a
// known build issue on Next 14 + Windows). The post id travels in the query
// string (?id=) for GET-one/DELETE and in the body for PUT.
const inputSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().max(120).optional(),
  excerpt: z.string().max(500).optional(),
  content: z.string().max(500_000).optional(),
  cover_image: z.string().max(3_000_000).optional(), // allows a data: URL
  tags: z.array(z.string().max(40)).max(20).optional(),
  author: z.string().max(80).optional(),
  status: z.enum(['draft', 'published']).optional(),
  seo_title: z.string().max(200).optional(),
  seo_description: z.string().max(400).optional(),
});

const putSchema = inputSchema.extend({ id: z.string().min(1).max(80) });

function unauthorized() {
  return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
}
function invalid(details?: unknown) {
  return NextResponse.json({ error: { message: 'Invalid post', details } }, { status: 400 });
}

// GET /api/admin/blogs         → list all posts (drafts included)
// GET /api/admin/blogs?id=xxx  → one post
export async function GET(req: NextRequest) {
  if (!(await hasPermission('blogs'))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const post = await getById(id);
    if (!post) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });
    return NextResponse.json({ data: post });
  }
  return NextResponse.json({ data: await listAll() });
}

// POST → create
export async function POST(req: NextRequest) {
  if (!(await hasPermission('blogs'))) return unauthorized();
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error.flatten());
  const post = await createPost(parsed.data);
  revalidateBlog(post.slug);
  return NextResponse.json({ data: post }, { status: 201 });
}

// PUT → update (id in body)
export async function PUT(req: NextRequest) {
  if (!(await hasPermission('blogs'))) return unauthorized();
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error.flatten());
  const { id, ...input } = parsed.data;
  const post = await updatePost(id, input);
  if (!post) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });
  revalidateBlog(post.slug);
  return NextResponse.json({ data: post });
}

// DELETE /api/admin/blogs?id=xxx
export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('blogs'))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return invalid('missing id');
  const existing = await getById(id);
  const ok = await deletePost(id);
  if (!ok) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });
  revalidateBlog(existing?.slug);
  return NextResponse.json({ data: { ok: true } });
}
