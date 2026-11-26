export const dynamic = "force-dynamic";
import bcrypt from "bcryptjs";
import { prisma, employeeSelect } from "@/lib/hr/db";
import { handler, requireUser, ok, bad, ensureMappinggLogin, renameMappinggLogin } from "@/lib/hr/auth";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser("ADMIN");
  const { id } = await params;
  const u = await prisma.user.findUnique({ where: { id }, select: employeeSelect });
  if (!u) bad("Employee not found");
  return ok(u);
});

export const PUT = handler(async (req: Request, { params }: Ctx) => {
  await requireUser("ADMIN");
  const { id } = await params;
  const b = await req.json();
  const current = await prisma.user.findUnique({ where: { id }, select: { email: true, name: true } });
  if (!current) bad("Employee not found");
  const data: Record<string, unknown> = {};
  for (const k of ["name", "phone", "designation", "department"] as const) if (b[k] !== undefined) data[k] = b[k] || null;
  if (b.bankName !== undefined) data.bankName = String(b.bankName || "").trim().slice(0, 100) || null;
  if (b.bankAccount !== undefined) data.bankAccount = String(b.bankAccount || "").replace(/\s+/g, "").slice(0, 34) || null;
  if (b.name !== undefined && !String(b.name).trim()) bad("Name is required");
  if (b.email !== undefined) {
    const email = String(b.email).toLowerCase().trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) bad("Valid email is required");
    const clash = await prisma.user.findFirst({ where: { email, NOT: { id } } });
    if (clash) bad("This email is already used");
    const err = await renameMappinggLogin(current.email, email);
    if (err) bad(err);
    data.email = email;
  }
  if (b.empCode !== undefined) {
    const empCode = String(b.empCode).trim().toUpperCase();
    if (!empCode) bad("Employee ID is required");
    const clash = await prisma.user.findFirst({ where: { empCode, NOT: { id } } });
    if (clash) bad("This employee ID is already used");
    data.empCode = empCode;
  }
  if (b.salaryType !== undefined) data.salaryType = b.salaryType === "HOURLY" ? "HOURLY" : "MONTHLY";
  if (b.salary !== undefined) data.salary = Number(b.salary) || 0;
  if (b.joinDate) data.joinDate = new Date(`${b.joinDate}T00:00:00Z`);
  if (b.active !== undefined) data.active = !!b.active;
  if (b.password) {
    if (String(b.password).length < 8) bad("Password must be at least 8 characters");
    // The password is the employee's Mappingg sign-in password.
    const err = await ensureMappinggLogin({ email: String(data.email || current.email), name: String(data.name || current.name), password: String(b.password) });
    if (err) bad(err);
    data.password = await bcrypt.hash(String(b.password), 10);
  }
  const u = await prisma.user.update({ where: { id }, data, select: employeeSelect });
  return ok(u);
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser("ADMIN");
  const { id } = await params;
  if (id === s.id) bad("You cannot delete yourself");
  await prisma.user.delete({ where: { id } });
  return ok();
});
