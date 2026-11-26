export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { dateKey, hm, minutesOfDay, weekday } from "@/lib/hr/time";
import { distanceMeters, reverseGeocode } from "@/lib/hr/geo";

export const POST = handler(async (req: Request) => {
  const s = await requireUser("EMPLOYEE");
  const b = await req.json();
  const settings = await getSettings();
  const today = dateKey();

  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: s.id, date: today } }, select: { id: true } });
  if (existing) bad("You have already checked in today");

  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) bad("Live location is required. Please allow location access.");
  if (settings.requireSelfie && !String(b.selfie || "").startsWith("data:image/")) bad("Please take a selfie to check in");
  if (b.selfie && String(b.selfie).length > 1_500_000) bad("Selfie image is too large");

  let distance: number | null = null;
  if (settings.officeLat != null && settings.officeLng != null) {
    distance = distanceMeters(lat, lng, settings.officeLat, settings.officeLng);
    if (settings.enforceGeofence && distance > settings.geofenceRadius)
      bad(`You are ${distance} m away from office. Check-in is allowed only within ${settings.geofenceRadius} m.`);
  }

  const holiday = await prisma.holiday.findUnique({ where: { date: today } });
  const workDay = settings.workingDays.split(",").map(Number).includes(weekday(today)) && !holiday;
  const late = workDay ? minutesOfDay() - hm(settings.officeStart) : 0;
  const isLate = late > settings.graceMinutes;

  const address = await reverseGeocode(lat, lng);
  const rec = await prisma.attendance.create({
    data: {
      userId: s.id,
      date: today,
      checkIn: new Date(),
      checkInSelfie: b.selfie || null,
      checkInLat: lat,
      checkInLng: lng,
      checkInAddress: address,
      checkInDistance: distance,
      isLate,
      lateMinutes: isLate ? late : 0,
      todayPlan: b.todayPlan ? String(b.todayPlan).slice(0, 2000) : null,
    },
    select: { id: true, checkIn: true, isLate: true, lateMinutes: true },
  });

  // Today's plan lines also become the employee's own daily tasks
  const lines = String(b.todayPlan || "").split("\n").map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
  if (lines.length)
    await prisma.task.createMany({
      data: lines.slice(0, 20).map((title) => ({ title: title.slice(0, 200), assignedToId: s.id, createdById: s.id, source: "SELF", date: today })),
    });

  return ok(rec);
});
