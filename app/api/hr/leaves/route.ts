export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { leaveBalance, leaveDays } from "@/lib/hr/leaves";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";

export const GET = handler(async (req: Request) => {
  const s = await requireUser();
  const q = new URL(req.url).searchParams;
  const where: Record<string, unknown> = {};
  if (s.role === "EMPLOYEE") where.userId = s.id;
  else if (q.get("userId")) where.userId = q.get("userId")!;
  if (q.get("status")) where.status = q.get("status")!;
  const rows = await prisma.leave.findMany({
    where,
    include: { user: { select: { name: true, empCode: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return ok(rows);
});

export const POST = handler(async (req: Request) => {
  const s = await requireUser("EMPLOYEE");
  const b = await req.json();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(b.fromDate || "") || !re.test(b.toDate || "")) bad("Select from and to dates");
  if (b.toDate < b.fromDate) bad("To date must be after from date");
  const type = ["CASUAL", "SICK", "PAID", "UNPAID"].includes(b.type) ? b.type : "CASUAL";

  const overlap = await prisma.leave.findFirst({
    where: { userId: s.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: b.toDate }, toDate: { gte: b.fromDate } },
  });
  if (overlap) bad(`You already have ${overlap.status === "APPROVED" ? "an approved" : "a pending"} leave from ${overlap.fromDate} to ${overlap.toDate}`);

  // quota check (per calendar year, working days only)
  const settings = await getSettings();
  const workDays = settings.workingDays.split(",").map(Number);
  const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date));
  const requested = leaveDays(b.fromDate, b.toDate, workDays, holidays);
  if (requested === 0) bad("Selected dates are holidays / weekly offs. No leave needed.");
  if (type !== "UNPAID") {
    for (const year of new Set([b.fromDate.slice(0, 4), b.toDate.slice(0, 4)])) {
      const bal = (await leaveBalance(s.id, year)).find((x) => x.type === type)!;
      const need = leaveDays(b.fromDate, b.toDate, workDays, holidays, year);
      if (bal.remaining != null && need > bal.remaining)
        bad(`Only ${bal.remaining} ${type.toLowerCase()} leave day(s) left in ${year}. Apply the extra days as Unpaid leave.`);
    }
  }

  await prisma.leave.create({
    data: {
      userId: s.id,
      fromDate: b.fromDate,
      toDate: b.toDate,
      type,
      reason: b.reason ? String(b.reason).slice(0, 1000) : null,
    },
  });
  return ok();
});
