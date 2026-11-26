import { prisma, getSettings } from "./db";
import { datesBetween, weekday } from "./time";

export const LEAVE_TYPES = ["CASUAL", "SICK", "PAID", "UNPAID"] as const;

/** Count only working days (skip weekly offs & holidays) inside a leave range */
export function leaveDays(from: string, to: string, workDays: number[], holidays: Set<string>, year?: string) {
  return datesBetween(from, to).filter((d) => (!year || d.startsWith(year)) && workDays.includes(weekday(d)) && !holidays.has(d)).length;
}

/** Leave balance for one employee for a calendar year */
export async function leaveBalance(userId: string, year: string) {
  const [settings, leaves, holidays] = await Promise.all([
    getSettings(),
    prisma.leave.findMany({ where: { userId, status: { in: ["APPROVED", "PENDING"] }, fromDate: { lte: `${year}-12-31` }, toDate: { gte: `${year}-01-01` } } }),
    prisma.holiday.findMany({ where: { date: { startsWith: year } } }),
  ]);
  const workDays = settings.workingDays.split(",").map(Number);
  const hol = new Set(holidays.map((h) => h.date));
  const quota: Record<string, number | null> = {
    CASUAL: settings.casualLeavePerYear,
    SICK: settings.sickLeavePerYear,
    PAID: settings.paidLeavePerYear,
    UNPAID: null, // unlimited
  };
  return LEAVE_TYPES.map((type) => {
    const of = leaves.filter((l) => l.type === type);
    const used = of.filter((l) => l.status === "APPROVED").reduce((t, l) => t + leaveDays(l.fromDate, l.toDate, workDays, hol, year), 0);
    const pending = of.filter((l) => l.status === "PENDING").reduce((t, l) => t + leaveDays(l.fromDate, l.toDate, workDays, hol, year), 0);
    const q = quota[type];
    return { type, quota: q, used, pending, remaining: q == null ? null : Math.max(0, q - used - pending) };
  });
}
