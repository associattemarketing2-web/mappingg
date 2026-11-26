export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { dateKey, zonedToDate } from "@/lib/hr/time";
import { workedMinutes } from "@/lib/hr/payroll";

const listSelect = {
  id: true, userId: true, date: true, checkIn: true, checkOut: true,
  checkInLat: true, checkInLng: true, checkInAddress: true, checkInDistance: true,
  checkOutLat: true, checkOutLng: true, checkOutAddress: true,
  isLate: true, lateMinutes: true, todayPlan: true, workSummary: true, adminNote: true,
  user: { select: { name: true, empCode: true, designation: true } },
} as const;

/** GET ?date=YYYY-MM-DD | ?month=YYYY-MM & userId (admin) */
export const GET = handler(async (req: Request) => {
  const s = await requireUser();
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const month = url.searchParams.get("month");
  const where: Record<string, unknown> = {};
  if (s.role === "EMPLOYEE") where.userId = s.id;
  else if (url.searchParams.get("userId")) where.userId = url.searchParams.get("userId")!;
  if (date) where.date = date;
  else if (month) where.date = { startsWith: month };
  else where.date = dateKey();

  const [rows, settings] = await Promise.all([
    prisma.attendance.findMany({ where, select: listSelect, orderBy: [{ date: "desc" }, { checkIn: "asc" }], take: 2000 }),
    getSettings(),
  ]);
  return ok(rows.map((r) => ({ ...r, workedMinutes: Math.round(workedMinutes(r, settings)), autoClosed: !r.checkOut && r.date < dateKey() })));
});

/** Admin: add a manual attendance entry */
export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const b = await req.json();
  if (!b.userId || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) bad("Employee and date are required");
  if (!/^\d{2}:\d{2}$/.test(b.checkIn || "")) bad("Check-in time is required");
  const exists = await prisma.attendance.findUnique({ where: { userId_date: { userId: b.userId, date: b.date } } });
  if (exists) bad("Attendance already exists for this date. Edit it instead.");
  const settings = await getSettings();
  const [h, m] = b.checkIn.split(":").map(Number);
  const [sh, sm] = settings.officeStart.split(":").map(Number);
  const late = h * 60 + m - (sh * 60 + sm);
  const rec = await prisma.attendance.create({
    data: {
      userId: b.userId,
      date: b.date,
      checkIn: zonedToDate(b.date, b.checkIn),
      checkOut: b.checkOut ? zonedToDate(b.date, b.checkOut) : null,
      isLate: late > settings.graceMinutes,
      lateMinutes: late > settings.graceMinutes ? late : 0,
      adminNote: b.adminNote || "Added manually by admin",
    },
  });
  return ok({ id: rec.id });
});
