export const dynamic = "force-dynamic";
import bcrypt from "bcryptjs";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad, mappinggAccount } from "@/lib/hr/auth";
import { getDb } from "@/lib/mongodb";

const publicUser = {
  id: true, empCode: true, name: true, email: true, role: true, phone: true, designation: true,
  department: true, salaryType: true, salary: true, joinDate: true, active: true,
} as const;

export const GET = handler(async () => {
  const s = await requireUser();
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: s.id }, select: publicUser }),
    getSettings(),
  ]);
  return ok({ user, settings });
});

/** Change own password = the Mappingg sign-in password */
export const POST = handler(async (req: Request) => {
  const s = await requireUser();
  const { current, next } = await req.json();
  if (!next || String(next).length < 8) bad("New password must be at least 8 characters");
  const acc = await mappinggAccount(s.email);
  if (!acc) bad("Account not found");
  if (!(await bcrypt.compare(String(current || ""), String(acc.password_hash || "")))) bad("Current password is wrong");
  const db = await getDb();
  await db.collection("users").updateOne({ id: acc.id }, { $set: { password_hash: await bcrypt.hash(String(next), 12), updated_at: new Date().toISOString() } });
  if (s.role === "EMPLOYEE") await prisma.user.update({ where: { id: s.id }, data: { password: await bcrypt.hash(String(next), 10) } });
  return ok();
});
