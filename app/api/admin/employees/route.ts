import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, forgetAccount } from '@/lib/auth';
import { listEmployees, createEmployee, updateEmployee, deleteEmployee, GRANTABLE_PERMISSIONS } from '@/lib/staff';
import { getDb } from '@/lib/mongodb';
import { idsParam, moveToTrash } from '@/lib/trash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only the owner (role 'admin') can manage staff accounts.
async function requireOwner() {
  const user = await getCurrentUser();
  return user && user.role === 'admin' ? user : null;
}

const permsSchema = z.array(z.enum(GRANTABLE_PERMISSIONS)).max(10).optional();

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().max(80).optional(),
  password: z.string().min(8).max(200),
  permissions: permsSchema,
});

const updateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().max(80).optional(),
  password: z.string().min(8).max(200).optional().or(z.literal('')),
  permissions: permsSchema,
});

function forbidden() {
  return NextResponse.json({ error: { message: 'Only the owner can manage employees.' } }, { status: 403 });
}
function invalid(details?: unknown) {
  return NextResponse.json({ error: { message: 'Invalid request', details } }, { status: 400 });
}

export async function GET() {
  if (!(await requireOwner())) return forbidden();
  return NextResponse.json({ data: await listEmployees() });
}

export async function POST(req: NextRequest) {
  if (!(await requireOwner())) return forbidden();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error.flatten());
  const res = await createEmployee(parsed.data);
  if (!res.ok) return NextResponse.json({ error: { message: res.error } }, { status: 409 });
  return NextResponse.json({ data: res.staff }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  if (!(await requireOwner())) return forbidden();
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error.flatten());
  const { id, password, ...rest } = parsed.data;
  const staff = await updateEmployee(id, { ...rest, password: password || undefined });
  if (!staff) return NextResponse.json({ error: { message: 'Employee not found' } }, { status: 404 });
  return NextResponse.json({ data: staff });
}

export async function DELETE(req: NextRequest) {
  const me = await requireOwner();
  if (!me) return forbidden();
  const ids = idsParam(req.nextUrl.searchParams);
  if (!ids.length) return invalid('missing id');
  const db = await getDb();
  let deleted = 0;
  for (const id of ids) {
    const emp = await db.collection('users').findOne({ id, role: 'employee' });
    if (!emp) continue;
    // Kept in Backups → Recycle bin so it can be restored.
    await moveToTrash({ kind: 'employee', label: String(emp.name || emp.email), sub: String(emp.email), docs: [{ collection: 'users', doc: emp }], deletedBy: me.email });
    if (await deleteEmployee(id)) deleted++;
    forgetAccount(id); // their existing session stops working immediately
  }
  if (!deleted) return NextResponse.json({ error: { message: 'Employee not found' } }, { status: 404 });
  return NextResponse.json({ data: { ok: true, deleted } });
}
