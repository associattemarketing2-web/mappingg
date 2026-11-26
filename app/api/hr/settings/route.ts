export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";

export const GET = handler(async () => {
  await requireUser();
  return ok(await getSettings());
});

export const PUT = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const b = await req.json();
  const time = /^\d{2}:\d{2}$/;
  if (b.officeStart && !time.test(b.officeStart)) bad("Office start time is invalid");
  if (b.officeEnd && !time.test(b.officeEnd)) bad("Office end time is invalid");
  if (b.officeStart && b.officeEnd && b.officeStart >= b.officeEnd) bad("Office end time must be after start time");
  const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
  await getSettings();
  const s = await prisma.settings.update({
    where: { id: 1 },
    data: {
      companyName: b.companyName ?? undefined,
      officeStart: b.officeStart ?? undefined,
      officeEnd: b.officeEnd ?? undefined,
      graceMinutes: b.graceMinutes !== undefined ? Number(b.graceMinutes) || 0 : undefined,
      halfDayHours: b.halfDayHours !== undefined ? Number(b.halfDayHours) || 0 : undefined,
      workingDays: b.workingDays ?? undefined,
      officeLat: b.officeLat !== undefined ? num(b.officeLat) : undefined,
      officeLng: b.officeLng !== undefined ? num(b.officeLng) : undefined,
      geofenceRadius: b.geofenceRadius !== undefined ? Number(b.geofenceRadius) || 200 : undefined,
      enforceGeofence: b.enforceGeofence ?? undefined,
      requireSelfie: b.requireSelfie ?? undefined,
      payrollMode: b.payrollMode ?? undefined,
      casualLeavePerYear: b.casualLeavePerYear !== undefined ? Math.max(0, Number(b.casualLeavePerYear) || 0) : undefined,
      sickLeavePerYear: b.sickLeavePerYear !== undefined ? Math.max(0, Number(b.sickLeavePerYear) || 0) : undefined,
      paidLeavePerYear: b.paidLeavePerYear !== undefined ? Math.max(0, Number(b.paidLeavePerYear) || 0) : undefined,
    },
  });
  return ok(s);
});
