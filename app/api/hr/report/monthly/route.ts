export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { workedMinutes } from "@/lib/hr/payroll";
import { dateKey, datesBetween, monthDates, weekday } from "@/lib/hr/time";

/**
 * Monthly attendance sheet (muster roll): one row per employee, one cell per day.
 * Codes: P present, HD half day, L leave, A absent, WO weekly off, H holiday, "" future / before joining
 */
export const GET = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const month = new URL(req.url).searchParams.get("month") || dateKey().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) bad("Invalid month");

  const [settings, users, attendance, leaves, holidays] = await Promise.all([
    getSettings(),
    prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true, empCode: true, joinDate: true }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { date: { startsWith: month } }, select: { userId: true, date: true, checkIn: true, checkOut: true, isLate: true } }),
    prisma.leave.findMany({ where: { status: "APPROVED", fromDate: { lte: `${month}-31` }, toDate: { gte: `${month}-01` } } }),
    prisma.holiday.findMany({ where: { date: { startsWith: month } } }),
  ]);

  const today = dateKey();
  const days = monthDates(month);
  const workDays = settings.workingDays.split(",").map(Number);
  const holidayMap = new Map(holidays.map((h) => [h.date, h.name]));
  const halfLimit = settings.halfDayHours * 60;

  const rows = users.map((u) => {
    const join = dateKey(u.joinDate);
    const att = new Map(attendance.filter((a) => a.userId === u.id).map((a) => [a.date, a]));
    const lv = new Map<string, string>();
    for (const l of leaves.filter((l) => l.userId === u.id)) for (const d of datesBetween(l.fromDate, l.toDate)) lv.set(d, l.type);
    const totals = { P: 0, HD: 0, L: 0, A: 0, late: 0, minutes: 0 };

    const cells = days.map((d) => {
      const a = att.get(d);
      if (a) {
        const m = workedMinutes(a, settings);
        totals.minutes += m;
        if (a.isLate) totals.late++;
        const code = m >= halfLimit || d === today ? "P" : "HD";
        totals[code]++;
        return { code, late: a.isLate, minutes: Math.round(m) };
      }
      if (d < join || d > today) return { code: "" };
      if (holidayMap.has(d)) return { code: "H", title: holidayMap.get(d) };
      if (!workDays.includes(weekday(d))) return { code: "WO" };
      if (lv.has(d)) {
        totals.L++;
        return { code: "L", title: lv.get(d) };
      }
      totals.A++;
      return { code: "A" };
    });
    return { userId: u.id, name: u.name, empCode: u.empCode, cells, totals: { ...totals, minutes: Math.round(totals.minutes) } };
  });

  return ok({ month, days: days.map((d) => ({ date: d, weekday: weekday(d) })), rows });
});
