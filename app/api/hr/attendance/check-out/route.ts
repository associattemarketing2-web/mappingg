export const dynamic = "force-dynamic";
import { prisma, getSettings } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { dateKey } from "@/lib/hr/time";
import { reverseGeocode } from "@/lib/hr/geo";

export const POST = handler(async (req: Request) => {
  const s = await requireUser("EMPLOYEE");
  const b = await req.json();
  const settings = await getSettings();

  const rec = await prisma.attendance.findUnique({ where: { userId_date: { userId: s.id, date: dateKey() } }, select: { id: true, checkOut: true } });
  if (!rec) bad("You have not checked in today");
  if (rec.checkOut) bad("You have already checked out today");

  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) bad("Live location is required. Please allow location access.");
  if (settings.requireSelfie && !String(b.selfie || "").startsWith("data:image/")) bad("Please take a selfie to check out");
  if (b.selfie && String(b.selfie).length > 1_500_000) bad("Selfie image is too large");

  const updated = await prisma.attendance.update({
    where: { id: rec.id },
    data: {
      checkOut: new Date(),
      checkOutSelfie: b.selfie || null,
      checkOutLat: lat,
      checkOutLng: lng,
      checkOutAddress: await reverseGeocode(lat, lng),
      workSummary: b.workSummary ? String(b.workSummary).slice(0, 3000) : null,
    },
    select: { id: true, checkIn: true, checkOut: true },
  });
  return ok(updated);
});
