export const dynamic = "force-dynamic";
import { prisma } from "@/lib/hr/db";
import { handler, requireUser, ok, HttpError } from "@/lib/hr/auth";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string, userId: string, role: string) {
  const t = await prisma.task.findUnique({ where: { id } });
  if (!t || (role !== "ADMIN" && t.assignedToId !== userId)) throw new HttpError(404, "Task not found");
  return t;
}

export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  const t = await load(id, s.id, s.role);
  const b = await req.json();
  const data: Record<string, unknown> = {};
  if (["PENDING", "IN_PROGRESS", "DONE"].includes(b.status)) {
    data.status = b.status;
    data.completedAt = b.status === "DONE" ? new Date() : null;
  }
  if (b.employeeNote !== undefined) data.employeeNote = b.employeeNote || null;
  // admin can edit everything; employee can edit details only of own SELF tasks
  if (s.role === "ADMIN" || t.source === "SELF") {
    if (b.title) data.title = String(b.title).slice(0, 200);
    if (b.description !== undefined) data.description = b.description || null;
    if (b.priority) data.priority = b.priority;
    if (b.dueDate !== undefined) data.dueDate = b.dueDate || null;
  }
  await prisma.task.update({ where: { id }, data });
  return ok();
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  const t = await load(id, s.id, s.role);
  if (s.role !== "ADMIN" && t.source !== "SELF") throw new HttpError(403, "Only admin can delete assigned tasks");
  await prisma.task.delete({ where: { id } });
  return ok();
});
