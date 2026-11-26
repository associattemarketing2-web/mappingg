// Who is using the HR module. There is no separate HR login: the signed-in
// Mappingg staff account decides it.
//   - Mappingg owner (role 'admin')     → HR super admin
//   - Mappingg employee (role 'employee') → HR employee, matched by email to the
//     employee record in the HR database (created by the admin in HR → Employees).
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { getCurrentUser, isStaffRole } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { prisma, HttpLikeError } from './db';

export type Session = { id: string; role: 'ADMIN' | 'EMPLOYEE'; name: string; email: string };

export type HrAccess =
  | { kind: 'ok'; session: Session }
  | { kind: 'signed-out' }
  | { kind: 'not-staff'; role: string }
  | { kind: 'no-profile'; email: string }
  | { kind: 'disabled'; email: string };

/** The HR admin record for the Mappingg owner (created on first use). */
async function adminRecord(email: string, name: string) {
  const own = await prisma.user.findFirst({ where: { email, role: 'ADMIN' } });
  if (own) return own;
  const any = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (any) return any;
  const emailFree = !(await prisma.user.findFirst({ where: { email } }));
  let empCode = 'ADMIN';
  while (await prisma.user.findFirst({ where: { empCode } })) empCode = `ADMIN${Math.floor(Math.random() * 900 + 100)}`;
  return prisma.user.create({
    data: {
      empCode,
      name: name || 'Super Admin',
      email: emailFree ? email : `admin-${randomUUID().slice(0, 8)}@hr.local`,
      // Never used to sign in (sign-in is Mappingg's), but the column is required.
      password: await bcrypt.hash(randomUUID(), 10),
      role: 'ADMIN',
      designation: 'Super Admin',
    },
  });
}

export async function getHrAccess(): Promise<HrAccess> {
  const mg = await getCurrentUser();
  if (!mg) return { kind: 'signed-out' };
  if (!isStaffRole(mg.role)) return { kind: 'not-staff', role: mg.role };
  const email = mg.email.toLowerCase();

  if (mg.role === 'admin') {
    const staff = await getDb().then((db) => db.collection('users').findOne({ email })).catch(() => null);
    const u = await adminRecord(email, String(staff?.name || ''));
    return { kind: 'ok', session: { id: u.id, role: 'ADMIN', name: u.name, email } };
  }

  const u = await prisma.user.findFirst({ where: { email, role: 'EMPLOYEE' } });
  if (!u) return { kind: 'no-profile', email };
  if (!u.active) return { kind: 'disabled', email };
  return { kind: 'ok', session: { id: u.id, role: 'EMPLOYEE', name: u.name, email } };
}

export async function getSession(): Promise<Session | null> {
  const a = await getHrAccess();
  return a.kind === 'ok' ? a.session : null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(role?: 'ADMIN' | 'EMPLOYEE') {
  const a = await getHrAccess();
  if (a.kind === 'signed-out') throw new HttpError(401, 'Please login again');
  if (a.kind === 'no-profile') throw new HttpError(403, 'Your HR profile is not set up yet. Ask the admin to add you in HR → Employees.');
  if (a.kind === 'disabled') throw new HttpError(403, 'Your HR access is disabled. Contact admin.');
  if (a.kind !== 'ok') throw new HttpError(403, 'Not allowed');
  if (role && a.session.role !== role) throw new HttpError(403, 'Not allowed');
  return a.session;
}

/** Wrap a route handler: converts thrown errors into JSON responses */
export function handler<A extends any[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError || e instanceof HttpLikeError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error('[hr]', e);
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}

export const ok = (data: unknown = { ok: true }) => NextResponse.json(data);
export function bad(msg: string): never {
  throw new HttpError(400, msg);
}

/* ------------------------------------------------ Mappingg login accounts */

/**
 * Makes sure an HR employee can sign in to Mappingg: creates a Mappingg staff
 * account (role 'employee', no admin tabs) when the email has none. `passwordHash`
 * is a bcrypt hash (copied from the HR record) used when no plain password is given.
 * Returns an error message when the email belongs to a public (buyer/developer/agent) account.
 */
export async function ensureMappinggLogin(input: { email: string; name: string; phone?: string | null; password?: string; passwordHash?: string }): Promise<string | null> {
  const db = await getDb();
  const users = db.collection('users');
  const email = input.email.toLowerCase().trim();
  const existing = await users.findOne({ email });
  if (existing) {
    if (!isStaffRole(String(existing.role))) return 'This email is already used by a Mappingg buyer / developer / agent account. Use another email.';
    if (input.password && existing.role === 'employee')
      await users.updateOne({ id: existing.id }, { $set: { password_hash: await bcrypt.hash(input.password, 12), updated_at: new Date().toISOString() } });
    return null;
  }
  const hash = input.password ? await bcrypt.hash(input.password, 12) : input.passwordHash;
  if (!hash) return 'Set a password for this employee (they need it to sign in).';
  const id = randomUUID();
  const now = new Date().toISOString();
  await users.insertOne({
    _id: id, id, email,
    name: input.name.trim(),
    password_hash: hash,
    role: 'employee',
    permissions: [],
    mobile: '',
    created_at: now, updated_at: now,
  });
  return null;
}

/** Mappingg account for an email, or null. */
export async function mappinggAccount(email: string) {
  const db = await getDb();
  return db.collection('users').findOne({ email: email.toLowerCase().trim() });
}

/** Moves the Mappingg employee login to a new email (when the admin changes it in HR). */
export async function renameMappinggLogin(oldEmail: string, newEmail: string): Promise<string | null> {
  if (oldEmail === newEmail) return null;
  const db = await getDb();
  const users = db.collection('users');
  const acc = await users.findOne({ email: oldEmail });
  if (!acc || acc.role !== 'employee') return null;
  if (await users.findOne({ email: newEmail })) return 'A Mappingg account with this email already exists.';
  await users.updateOne({ id: acc.id }, { $set: { email: newEmail, updated_at: new Date().toISOString() } });
  return null;
}
