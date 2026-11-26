export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok } from "@/lib/hr/auth";
import { dateKey, datesBetween } from "@/lib/hr/time";
import { workedMinutes } from "@/lib/hr/payroll";

export const GET = handler(async () => {
  await requireUser("ADMIN");
  const today = dateKey();
  const weekAgo = dateKey(new Date(Date.now() - 6 * 864e5));
  const [settings, employees, todayAtt, leavesToday, pendingLeaves, openTasks, doneToday, week, holiday] = await Promise.all([
    getSettings(),
    prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true, empCode: true, designation: true }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({
      where: { date: today },
      select: { id: true, userId: true, date: true, checkIn: true, checkOut: true, isLate: true, lateMinutes: true, checkInAddress: true, checkInDistance: true, checkInLat: true, checkInLng: true, todayPlan: true },
    }),
    prisma.leave.findMany({ where: { status: "APPROVED", fromDate: { lte: today }, toDate: { gte: today } }, select: { userId: true, type: true } }),
    prisma.leave.count({ where: { status: "PENDING" } }),
    prisma.task.count({ where: { status: { not: "DONE" }, source: "ADMIN" } }),
    prisma.task.count({ where: { status: "DONE", completedAt: { gte: new Date(Date.now() - 864e5) } } }),
    prisma.attendance.groupBy({ by: ["date"], where: { date: { gte: weekAgo } }, _count: true }),
    prisma.holiday.findUnique({ where: { date: today } }),
  ]);

  const byUser = new Map(todayAtt.map((a) => [a.userId, a]));
  const onLeave = new Map(leavesToday.map((l) => [l.userId, l.type]));
  const list = employees.map((e) => {
    const a = byUser.get(e.id);
    const status = a ? (a.checkOut ? "CHECKED_OUT" : "WORKING") : onLeave.has(e.id) ? "ON_LEAVE" : "ABSENT";
    return { ...e, status, attendance: a ? { ...a, workedMinutes: Math.round(workedMinutes(a, settings)) } : null };
  });
  const weekMap = new Map(week.map((w) => [w.date, w._count]));

  return ok({
    today,
    holiday: holiday?.name ?? null,
    settings: { officeStart: settings.officeStart, officeEnd: settings.officeEnd, companyName: settings.companyName },
    stats: {
      total: employees.length,
      present: list.filter((l) => l.attendance).length,
      working: list.filter((l) => l.status === "WORKING").length,
      late: todayAtt.filter((a) => a.isLate).length,
      onLeave: list.filter((l) => l.status === "ON_LEAVE").length,
      absent: list.filter((l) => l.status === "ABSENT").length,
      pendingLeaves,
      openTasks,
      doneToday,
    },
    week: datesBetween(weekAgo, today).map((d) => ({ date: d, count: weekMap.get(d) ?? 0 })),
    list,
  });
});
