import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { listEmployees, createEmployee, updateEmployee, deleteEmployee, GRANTABLE_PERMISSIONS } from '@/lib/staff';

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
  if (!(await requireOwner())) return forbidden();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return invalid('missing id');
  const ok = await deleteEmployee(id);
  if (!ok) return NextResponse.json({ error: { message: 'Employee not found' } }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
