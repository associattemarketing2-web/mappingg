import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from './mongodb';
import { getCurrentUser } from './auth';
// NOTE: `Db` type no longer imported from the mongodb driver; the collection
// shim is structurally typed, so the untyped getDb() return is fine here.

// Our docs use string uuid _id values, so type the collection loosely to keep
// the driver's strict ObjectId _id typing out of the way (mirrors db-engine).
type AnyDoc = { _id: string;[key: string]: any };

// Staff accounts live in the same `users` collection. The seeded owner has
// role 'admin' (full access); everyone added from the Employees tab has role
// 'employee' plus a list of tab permissions.

export const GRANTABLE_PERMISSIONS = ['map', 'intake', 'leads', 'accounts', 'blogs', 'seo', 'settings'] as const;
export type Permission = (typeof GRANTABLE_PERMISSIONS)[number];

export interface StaffMember {
  id: string;
  email: string;
  name?: string;
  role: string;
  permissions: string[];
  avatar?: string;
  created_at?: string;
  updated_at?: string;
}

function clean(doc: Record<string, unknown> | null): StaffMember | null {
  if (!doc) return null;
  return {
    id: String(doc.id || doc._id),
    email: String(doc.email || ''),
    name: (doc.name as string) || '',
    role: String(doc.role || 'employee'),
    permissions: Array.isArray(doc.permissions) ? (doc.permissions as string[]) : [],
    avatar: (doc.avatar as string) || '',
    created_at: doc.created_at as string,
    updated_at: doc.updated_at as string,
  };
}

/**
 * True if the signed-in user may use a given tab/permission. The owner (role
 * 'admin') can do everything; employees are limited to their granted permissions.
 * Used to enforce access at the API level, not just hide UI tabs.
 */
export async function hasPermission(perm: Permission): Promise<boolean> {
  const session = await getCurrentUser();
  if (!session) return false;
  if (session.role === 'admin') return true;
  const staff = await getStaffByEmail(session.email);
  return !!staff && staff.role === 'employee' && staff.permissions.includes(perm);
}

/** The current user's full record (role + permissions), looked up by email. */
export async function getStaffByEmail(email: string): Promise<StaffMember | null> {
  try {
    const db = await getDb();
    return clean(await db.collection<AnyDoc>('users').findOne({ email: email.toLowerCase() }));
  } catch {
    return null;
  }
}

/** Employees only (never the owner/admin) — for the Employees tab. */
export async function listEmployees(): Promise<StaffMember[]> {
  const db = await getDb();
  const rows = await db.collection<AnyDoc>('users').find({ role: 'employee' }).sort({ created_at: -1 }).toArray();
  return rows.map((r) => clean(r as Record<string, unknown>) as StaffMember);
}

function sanitizePerms(perms?: string[]): string[] {
  if (!Array.isArray(perms)) return [];
  return perms.filter((p) => (GRANTABLE_PERMISSIONS as readonly string[]).includes(p));
}

export async function createEmployee(input: {
  email: string; name?: string; password: string; permissions?: string[];
}): Promise<{ ok: true; staff: StaffMember } | { ok: false; error: string }> {
  const db = await getDb();
  const users = db.collection<AnyDoc>('users');
  const email = input.email.toLowerCase().trim();
  if (await users.findOne({ email })) return { ok: false, error: 'An account with this email already exists.' };
  const id = randomUUID();
  const now = new Date().toISOString();
  const doc = {
    _id: id, id, email,
    name: (input.name || '').trim(),
    password_hash: await bcrypt.hash(input.password, 12),
    role: 'employee',
    permissions: sanitizePerms(input.permissions),
    created_at: now, updated_at: now,
  };
  await users.insertOne(doc);
  return { ok: true, staff: clean(doc) as StaffMember };
}

export async function updateEmployee(id: string, input: {
  name?: string; password?: string; permissions?: string[];
}): Promise<StaffMember | null> {
  const db = await getDb();
  const users = db.collection<AnyDoc>('users');
  const existing = await users.findOne({ id, role: 'employee' });
  if (!existing) return null;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.name === 'string') patch.name = input.name.trim();
  if (Array.isArray(input.permissions)) patch.permissions = sanitizePerms(input.permissions);
  if (input.password) patch.password_hash = await bcrypt.hash(input.password, 12);
  await users.updateOne({ id, role: 'employee' }, { $set: patch });
  return clean(await users.findOne({ id }));
}

export async function deleteEmployee(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.collection<AnyDoc>('users').deleteOne({ id, role: 'employee' });
  return res.deletedCount > 0;
}
