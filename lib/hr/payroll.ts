import type { Adjustment, Attendance, Holiday, Leave, Settings, User } from "./types";
import { dateKey, datesBetween, hm, monthDates, weekday, zonedToDate } from "./time";

/** Worked minutes for a record. Forgotten check-outs on past days auto-close at office end time. */
export function workedMinutes(a: Pick<Attendance, "checkIn" | "checkOut" | "date">, s: Settings, now = new Date()) {
  if (a.checkOut) return Math.max(0, (a.checkOut.getTime() - a.checkIn.getTime()) / 60000);
  if (a.date === dateKey(now)) return Math.max(0, (now.getTime() - a.checkIn.getTime()) / 60000);
  const end = zonedToDate(a.date, s.officeEnd);
  return Math.max(0, (end.getTime() - a.checkIn.getTime()) / 60000);
}

export const shiftMinutes = (s: Settings) => Math.max(60, hm(s.officeEnd) - hm(s.officeStart));

export type PayrollRow = ReturnType<typeof computePayroll>;

/** Maharashtra Professional Tax on the month's gross: ₹200 (₹300 in February) above ₹10,000, ₹175 above ₹7,500. */
export function professionalTax(gross: number, month: string) {
  if (gross > 10_000) return month.endsWith("-02") ? 300 : 200;
  if (gross > 7_500) return 175;
  return 0;
}

export function computePayroll(
  user: Pick<User, "id" | "name" | "empCode" | "salary" | "salaryType" | "joinDate" | "designation" | "department" | "email"> & Partial<Pick<User, "bankName" | "bankAccount">>,
  month: string,
  attendance: Pick<Attendance, "checkIn" | "checkOut" | "date" | "isLate">[],
  leaves: Pick<Leave, "fromDate" | "toDate" | "type" | "status">[],
  holidays: Pick<Holiday, "date">[],
  s: Settings,
  adjustments: Pick<Adjustment, "type" | "amount">[] = [],
) {
  const today = dateKey();
  const workDays = s.workingDays.split(",").map(Number);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const join = dateKey(user.joinDate);

  const workingDates = monthDates(month).filter((d) => workDays.includes(weekday(d)) && !holidaySet.has(d));
  const eligible = workingDates.filter((d) => d >= join);
  const elapsed = eligible.filter((d) => d <= today);

  const leaveDates = new Map<string, string>();
  for (const l of leaves.filter((l) => l.status === "APPROVED"))
    for (const d of datesBetween(l.fromDate, l.toDate)) if (eligible.includes(d)) leaveDates.set(d, l.type);

  const shift = shiftMinutes(s);
  const halfLimit = s.halfDayHours * 60;
  let worked = 0, payMinutes = 0, overtime = 0, full = 0, half = 0, late = 0;
  const presentDates = new Set<string>();

  for (const a of attendance) {
    const m = workedMinutes(a, s);
    worked += m;
    payMinutes += Math.min(m, shift);
    overtime += Math.max(0, m - shift);
    presentDates.add(a.date);
    if (a.isLate) late++;
    if (m >= halfLimit) full++;
    else half++;
  }

  let paidLeave = 0, unpaidLeave = 0;
  for (const [d, type] of leaveDates) {
    if (presentDates.has(d)) continue;
    if (type === "UNPAID") unpaidLeave++;
    else paidLeave++;
  }
  const absent = elapsed.filter((d) => !presentDates.has(d) && !leaveDates.has(d)).length;

  let hourlyRate = 0, payable = 0, paidDays = full + half * 0.5 + paidLeave;
  const expectedMinutes = eligible.length * shift;
  if (user.salaryType === "HOURLY") {
    hourlyRate = user.salary;
    payable = (worked / 60) * hourlyRate;
  } else {
    const fullMonthMinutes = workingDates.length * shift || 1;
    hourlyRate = user.salary / (fullMonthMinutes / 60);
    if (s.payrollMode === "DAYS") {
      const perDay = user.salary / (workingDates.length || 1);
      payable = (full + half * 0.5 + paidLeave) * perDay;
    } else {
      payable = ((payMinutes + paidLeave * shift) / 60) * hourlyRate;
    }
    payable = Math.min(payable, user.salary);
    // Days the pay covers, at the full-month day rate (also right in hours mode).
    paidDays = workingDates.length ? payable / (user.salary / workingDates.length || 1) : 0;
  }
  paidDays = Math.min(eligible.length, Math.round(paidDays * 100) / 100);

  const bonus = adjustments.filter((a) => a.type === "BONUS").reduce((t, a) => t + a.amount, 0);
  const deductions = adjustments.filter((a) => a.type === "DEDUCTION").reduce((t, a) => t + a.amount, 0);
  const advance = adjustments.filter((a) => a.type === "ADVANCE").reduce((t, a) => t + a.amount, 0);
  const fuel = adjustments.filter((a) => a.type === "FUEL").reduce((t, a) => t + a.amount, 0);
  const pt = professionalTax(Math.round(payable + bonus), month);

  return {
    userId: user.id,
    email: user.email,
    department: user.department,
    joinDate: user.joinDate,
    name: user.name,
    empCode: user.empCode,
    designation: user.designation,
    bankName: user.bankName ?? null,
    bankAccount: user.bankAccount ?? null,
    salaryType: user.salaryType,
    salary: user.salary,
    workingDays: eligible.length,
    paidDays,
    lopDays: Math.max(0, Math.round((eligible.length - paidDays) * 100) / 100),
    elapsedDays: elapsed.length,
    present: presentDates.size,
    fullDays: full,
    halfDays: half,
    lateDays: late,
    paidLeave,
    unpaidLeave,
    absent,
    workedMinutes: Math.round(worked),
    overtimeMinutes: Math.round(overtime),
    expectedMinutes,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    payable: Math.round(payable),
    bonus: Math.round(bonus),
    deductions: Math.round(deductions),
    advance: Math.round(advance),
    fuel: Math.round(fuel),
    professionalTax: pt,
    netPay: Math.max(0, Math.round(payable + bonus - deductions - advance - fuel - pt)),
  };
}
