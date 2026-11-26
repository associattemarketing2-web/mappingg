import bcrypt from "bcryptjs";
import { prisma, employeeSelect } from "@/lib/hr/db";
import { handler, requireUser, ok, bad, ensureMappinggLogin, mappinggAccount } from "@/lib/hr/auth";

export const dynamic = "force-dynamic";

// HR employees sign in through Mappingg. Employees that only exist in the HR
// database (e.g. added in the old standalone app) get a Mappingg login with the
// same password, checked at most every 10 minutes per server.
const g = globalThis as unknown as { __hrLoginSync?: number };
async function syncLogins() {
  if (g.__hrLoginSync && Date.now() - g.__hrLoginSync < 10 * 60_000) return;
  g.__hrLoginSync = Date.now();
  const rows = await prisma.user.findMany({ where: { role: "EMPLOYEE" }, select: { email: true, name: true, password: true } });
  for (const r of rows) {
    try {
      if (!(await mappinggAccount(r.email))) await ensureMappinggLogin({ email: r.email, name: r.name, passwordHash: r.password });
    } catch (e) {
      console.error("[hr] login sync failed for an employee", (e as Error).message);
    }
  }
}

export const GET = handler(async () => {
  await requireUser("ADMIN");
  await syncLogins().catch(() => {});
  const list = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    select: employeeSelect,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return ok(list);
});

export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const b = await req.json();
  const name = String(b.name || "").trim();
  const email = String(b.email || "").toLowerCase().trim();
  const password = String(b.password || "");
  if (!name) bad("Name is required");
  if (!/^\S+@\S+\.\S+$/.test(email)) bad("Valid email is required");

  // An existing Mappingg staff account keeps its own password; a new login needs one.
  const account = await mappinggAccount(email);
  const hasLogin = !!account && ["admin", "employee"].includes(String(account.role));
  if (!hasLogin && password.length < 8) bad("Password must be at least 8 characters (used to sign in to Mappingg)");
  if (password && password.length < 8) bad("Password must be at least 8 characters");

  let empCode = String(b.empCode || "").trim().toUpperCase();
  if (!empCode) {
    const count = await prisma.user.count({ where: { role: "EMPLOYEE" } });
    empCode = `EMP${String(count + 1).padStart(3, "0")}`;
    while (await prisma.user.findUnique({ where: { empCode } })) empCode = `EMP${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  const clash = await prisma.user.findFirst({ where: { OR: [{ email }, { empCode }] } });
  if (clash) bad(clash.email === email ? "This email is already used" : "This employee ID is already used");

  const loginError = await ensureMappinggLogin({ email, name, phone: b.phone, password: password || undefined });
  if (loginError) bad(loginError);

  const user = await prisma.user.create({
    data: {
      name, email, empCode,
      password: await bcrypt.hash(password || crypto.randomUUID(), 10),
      phone: b.phone || null,
      designation: b.designation || null,
      department: b.department || null,
      salaryType: b.salaryType === "HOURLY" ? "HOURLY" : "MONTHLY",
      salary: Number(b.salary) || 0,
      joinDate: b.joinDate ? new Date(`${b.joinDate}T00:00:00Z`) : new Date(),
    },
    select: employeeSelect,
  });
  return ok(user);
});
