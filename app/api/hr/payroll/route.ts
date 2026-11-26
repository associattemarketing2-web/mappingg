export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { computePayroll } from "@/lib/hr/payroll";
import { dateKey } from "@/lib/hr/time";

/** GET ?month=YYYY-MM[&userId=] — admin: everyone, employee: self */
export const GET = handler(async (req: Request) => {
  const s = await requireUser();
  const q = new URL(req.url).searchParams;
  const month = q.get("month") || dateKey().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) bad("Invalid month");
  const userId = s.role === "EMPLOYEE" ? s.id : q.get("userId") || undefined;

  const [settings, users, attendance, leaves, holidays, adjustments] = await Promise.all([
    getSettings(),
    prisma.user.findMany({
      where: { role: "EMPLOYEE", ...(userId ? { id: userId } : { active: true }) },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({
      where: { date: { startsWith: month }, ...(userId ? { userId } : {}) },
      select: { userId: true, checkIn: true, checkOut: true, date: true, isLate: true },
    }),
    prisma.leave.findMany({
      where: { status: "APPROVED", ...(userId ? { userId } : {}), fromDate: { lte: `${month}-31` }, toDate: { gte: `${month}-01` } },
    }),
    prisma.holiday.findMany({ where: { date: { startsWith: month } } }),
    prisma.adjustment.findMany({ where: { month, ...(userId ? { userId } : {}) }, orderBy: { createdAt: "asc" } }),
  ]);

  const rows = users.map((u) =>
    computePayroll(
      u,
      month,
      attendance.filter((a) => a.userId === u.id),
      leaves.filter((l) => l.userId === u.id),
      holidays,
      settings,
      adjustments.filter((a) => a.userId === u.id),
    ),
  );
  return ok({ month, mode: settings.payrollMode, companyName: settings.companyName, rows, adjustments });
});
