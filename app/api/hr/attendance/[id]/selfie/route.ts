export const dynamic = "force-dynamic";
import { prisma } from "@/lib/hr/db";
import { handler, requireUser, HttpError } from "@/lib/hr/auth";

type Ctx = { params: Promise<{ id: string }> };

/** Returns the selfie image. ?type=in|out */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  const out = new URL(req.url).searchParams.get("type") === "out";
  const rec = await prisma.attendance.findUnique({
    where: { id },
    select: { userId: true, checkInSelfie: !out, checkOutSelfie: out },
  });
  if (!rec || (s.role !== "ADMIN" && rec.userId !== s.id)) throw new HttpError(404, "Not found");
  const data = out ? rec.checkOutSelfie : rec.checkInSelfie;
  const m = data?.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) throw new HttpError(404, "No selfie");
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=86400" },
  });
});
