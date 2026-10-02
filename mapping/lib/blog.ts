import { randomUUID } from 'crypto';
import { getDb, type Db } from './mongodb';

// Blog / articles backend. Posts live in the `posts` collection and power both
// the public, SEO-friendly /blog pages and the super-admin blog manager.

export interface BlogPost {
  id: string;
  _id?: string;
  slug: string;
  title: string;
  excerpt?: string;
  content?: string; // trusted HTML authored by the super-admin
  cover_image?: string; // URL or data: URL
  tags?: string[];
  author?: string;
  status: 'draft' | 'published';
  seo_title?: string;
  seo_description?: string;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
}

let indexed = false;
async function coll(db: Db) {
  const c = db.collection<BlogPost>('posts');
  if (!indexed) {
    indexed = true;
    await c.createIndex({ slug: 1 }, { unique: true }).catch(() => {});
    await c.createIndex({ status: 1, published_at: -1 }).catch(() => {});
  }
  return c;
}

export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || `post-${Date.now()}`;
}

function clean(doc: BlogPost | null): BlogPost | null {
  if (!doc) return null;
  const { _id, ...rest } = doc as BlogPost & { _id?: string };
  return rest as BlogPost;
}

export function readingTime(html?: string): number {
  const words = (html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Published posts, newest first — for the public blog and sitemap. */
export async function listPublished(): Promise<BlogPost[]> {
  try {
    const db = await getDb();
    const rows = await (await coll(db))
      .find({ status: 'published' })
      .sort({ published_at: -1, created_at: -1 })
      .toArray();
    return rows.map((r) => clean(r) as BlogPost);
  } catch {
    return [];
  }
}

/** Every post (drafts included) — admin only. */
export async function listAll(): Promise<BlogPost[]> {
  const db = await getDb();
  const rows = await (await coll(db)).find({}).sort({ updated_at: -1, created_at: -1 }).toArray();
  return rows.map((r) => clean(r) as BlogPost);
}

export async function getBySlug(slug: string): Promise<BlogPost | null> {
  try {
    const db = await getDb();
    return clean(await (await coll(db)).findOne({ slug, status: 'published' }));
  } catch {
    return null;
  }
}

export async function getById(id: string): Promise<BlogPost | null> {
  const db = await getDb();
  return clean(await (await coll(db)).findOne({ id }));
}

async function uniqueSlug(db: Db, base: string, ignoreId?: string): Promise<string> {
  const c = await coll(db);
  let slug = base;
  let i = 2;
  // Ensure the slug is unique (append -2, -3, … on collision).
  while (await c.findOne({ slug, ...(ignoreId ? { id: { $ne: ignoreId } } : {}) })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

export interface BlogInput {
  title: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  cover_image?: string;
  tags?: string[];
  author?: string;
  status?: 'draft' | 'published';
  seo_title?: string;
  seo_description?: string;
}

export async function createPost(input: BlogInput): Promise<BlogPost> {
  const db = await getDb();
  const c = await coll(db);
  const now = new Date().toISOString();
  const id = randomUUID();
  const status = input.status === 'published' ? 'published' : 'draft';
  const slug = await uniqueSlug(db, slugify(input.slug || input.title));
  const doc: BlogPost = {
    _id: id,
    id,
    slug,
    title: input.title.trim(),
    excerpt: input.excerpt?.trim() || '',
    content: input.content || '',
    cover_image: input.cover_image || '',
    tags: input.tags || [],
    author: input.author || 'Mappingg Team',
    status,
    seo_title: input.seo_title?.trim() || '',
    seo_description: input.seo_description?.trim() || '',
    created_at: now,
    updated_at: now,
    published_at: status === 'published' ? now : null,
  };
  await c.insertOne(doc);
  return clean(doc) as BlogPost;
}

export async function updatePost(id: string, input: BlogInput): Promise<BlogPost | null> {
  const db = await getDb();
  const c = await coll(db);
  const existing = await c.findOne({ id });
  if (!existing) return null;
  const now = new Date().toISOString();
  const status = input.status === 'published' ? 'published' : 'draft';
  const patch: Partial<BlogPost> = {
    title: input.title.trim(),
    excerpt: input.excerpt?.trim() || '',
    content: input.content || '',
    cover_image: input.cover_image || '',
    tags: input.tags || [],
    author: input.author || existing.author || 'Mappingg Team',
    status,
    seo_title: input.seo_title?.trim() || '',
    seo_description: input.seo_description?.trim() || '',
    updated_at: now,
  };
  if (input.slug && input.slug !== existing.slug) {
    patch.slug = await uniqueSlug(db, slugify(input.slug), id);
  }
  // Stamp published_at the first time a post goes live.
  if (status === 'published' && !existing.published_at) patch.published_at = now;
  if (status === 'draft') patch.published_at = null;
  await c.updateOne({ id }, { $set: patch });
  return clean(await c.findOne({ id }));
}

export async function deletePost(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await (await coll(db)).deleteOne({ id });
  return res.deletedCount > 0;
}

export async function countPosts(): Promise<{ total: number; published: number; draft: number }> {
  try {
    const db = await getDb();
    const c = await coll(db);
    const [total, published] = await Promise.all([
      c.countDocuments({}),
      c.countDocuments({ status: 'published' }),
    ]);
    return { total, published, draft: total - published };
  } catch {
    return { total: 0, published: 0, draft: 0 };
  }
}
