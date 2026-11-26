export const dynamic = "force-dynamic";
import { prisma } from "@/lib/hr/db";
import { handler, requireUser, ok, bad, HttpError } from "@/lib/hr/auth";

type Ctx = { params: Promise<{ id: string }> };

/** Admin approves / rejects */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  await requireUser("ADMIN");
  const { id } = await params;
  const b = await req.json();
  if (!["APPROVED", "REJECTED", "PENDING"].includes(b.status)) bad("Invalid status");
  await prisma.leave.update({ where: { id }, data: { status: b.status, adminNote: b.adminNote ?? undefined } });
  return ok();
});

/** Employee cancels own pending request; admin can delete any */
export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  const l = await prisma.leave.findUnique({ where: { id } });
  if (!l) throw new HttpError(404, "Not found");
  if (s.role !== "ADMIN" && (l.userId !== s.id || l.status !== "PENDING")) bad("Only pending requests can be cancelled");
  await prisma.leave.delete({ where: { id } });
  return ok();
});
