import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { hasPermission } from '@/lib/staff';
import { listAll, getById, createPost, updatePost, deletePost } from '@/lib/blog';
import { getCurrentUser } from '@/lib/auth';
import { idsParam, moveToTrash } from '@/lib/trash';
import { blogViews } from '@/lib/site-analytics';

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
// Limits leave room for pasted-in articles; anything over one is refused with a
// message naming the field (see invalid()), never a bare "Save failed".
const inputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  slug: z.string().max(120).optional(),
  excerpt: z.string().max(1000).optional(),
  content: z.string().max(500_000).optional(),
  cover_image: z.string().max(3_000_000).optional(), // allows a data: URL
  tags: z.array(z.string().max(80)).max(30).optional(),
  author: z.string().max(80).optional(),
  status: z.enum(['draft', 'published']).optional(),
  seo_title: z.string().max(300).optional(),
  seo_description: z.string().max(600).optional(),
});

const FIELD_NAMES: Record<string, string> = {
  title: 'Title', slug: 'Slug', excerpt: 'Excerpt', content: 'Content', cover_image: 'Cover image',
  tags: 'Tags', author: 'Author', status: 'Status', seo_title: 'SEO title', seo_description: 'Meta description',
};

/** "Excerpt is too long — max 1000 characters (yours: 1240)." from a zod error. */
function explain(error: z.ZodError, body: unknown): string {
  return error.issues.slice(0, 3).map((i) => {
    const [field, index] = i.path;
    const name = FIELD_NAMES[String(field)] || String(field);
    const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[String(field)] : undefined;
    if (i.code === 'too_big' && field === 'tags' && index === undefined) return `Too many tags — max ${i.maximum}.`;
    if (i.code === 'too_big' && field === 'tags') {
      const tag = Array.isArray(value) ? String(value[Number(index)]) : '';
      return `Tag “${tag.slice(0, 40)}${tag.length > 40 ? '…' : ''}” is too long — max ${i.maximum} characters per tag.`;
    }
    if (i.code === 'too_big' && field === 'cover_image') return 'Cover image is too large — upload a smaller picture or paste an image URL.';
    if (i.code === 'too_big') return `${name} is too long — max ${i.maximum} characters${typeof value === 'string' ? ` (yours: ${value.length})` : ''}.`;
    if (i.code === 'too_small') return `${name} is required.`;
    return `${name}: ${i.message}`;
  }).join(' ');
}

const putSchema = inputSchema.extend({ id: z.string().min(1).max(80) });

function unauthorized() {
  return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
}
function invalid(details?: unknown, message = 'Invalid post') {
  return NextResponse.json({ error: { message, details } }, { status: 400 });
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
  // Views per post come from the site's own page-view log; a failed read just leaves them blank.
  const [data, views] = await Promise.all([listAll(), blogViews().catch(() => null)]);
  return NextResponse.json({ data, views });
}

// POST → create
export async function POST(req: NextRequest) {
  if (!(await hasPermission('blogs'))) return unauthorized();
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error.flatten(), explain(parsed.error, body));
  const post = await createPost(parsed.data);
  revalidateBlog(post.slug);
  return NextResponse.json({ data: post }, { status: 201 });
}

// PUT → update (id in body)
export async function PUT(req: NextRequest) {
  if (!(await hasPermission('blogs'))) return unauthorized();
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error.flatten(), explain(parsed.error, body));
  const { id, ...input } = parsed.data;
  const post = await updatePost(id, input);
  if (!post) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });
  revalidateBlog(post.slug);
  return NextResponse.json({ data: post });
}

// DELETE /api/admin/blogs?id=xxx
export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('blogs'))) return unauthorized();
  const ids = idsParam(req.nextUrl.searchParams);
  if (!ids.length) return invalid('missing id');
  const actor = (await getCurrentUser())?.email;
  let deleted = 0;
  for (const id of ids) {
    const existing = await getById(id);
    if (!existing) continue;
    // Kept in Backups → Recycle bin so it can be restored.
    await moveToTrash({ kind: 'blog', label: existing.title, sub: `/blog/${existing.slug} · ${existing.status}`, docs: [{ collection: 'posts', doc: { ...existing } }], deletedBy: actor });
    if (await deletePost(id)) deleted++;
    revalidateBlog(existing.slug);
  }
  if (!deleted) return NextResponse.json({ error: { message: 'Not found' } }, { status: 404 });
  return NextResponse.json({ data: { ok: true, deleted } });
}
