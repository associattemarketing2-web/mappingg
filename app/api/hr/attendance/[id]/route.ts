export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { hm, zonedToDate } from "@/lib/hr/time";

type Ctx = { params: Promise<{ id: string }> };

/** Admin: correct check-in / check-out time or add a note */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  await requireUser("ADMIN");
  const { id } = await params;
  const b = await req.json();
  const rec = await prisma.attendance.findUnique({ where: { id }, select: { date: true } });
  if (!rec) bad("Record not found");
  const data: Record<string, unknown> = {};
  if (b.checkIn) {
    if (!/^\d{2}:\d{2}$/.test(b.checkIn)) bad("Invalid check-in time");
    const settings = await getSettings();
    const late = hm(b.checkIn) - hm(settings.officeStart);
    data.checkIn = zonedToDate(rec.date, b.checkIn);
    data.isLate = late > settings.graceMinutes;
    data.lateMinutes = late > settings.graceMinutes ? late : 0;
  }
  if (b.checkOut !== undefined) {
    if (b.checkOut && !/^\d{2}:\d{2}$/.test(b.checkOut)) bad("Invalid check-out time");
    data.checkOut = b.checkOut ? zonedToDate(rec.date, b.checkOut) : null;
  }
  if (b.checkIn && b.checkOut && b.checkOut <= b.checkIn) bad("Check-out must be after check-in");
  if (b.adminNote !== undefined) data.adminNote = b.adminNote || null;
  await prisma.attendance.update({ where: { id }, data });
  return ok();
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser("ADMIN");
  const { id } = await params;
  await prisma.attendance.delete({ where: { id } });
  return ok();
});
