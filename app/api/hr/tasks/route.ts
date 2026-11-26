export const dynamic = "force-dynamic";
import { prisma } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { dateKey } from "@/lib/hr/time";

/** GET ?userId=&status=&date=&source= */
export const GET = handler(async (req: Request) => {
  const s = await requireUser();
  const q = new URL(req.url).searchParams;
  const where: Record<string, unknown> = {};
  if (s.role === "EMPLOYEE") where.assignedToId = s.id;
  else if (q.get("userId")) where.assignedToId = q.get("userId")!;
  if (q.get("status")) where.status = q.get("status")!;
  if (q.get("source")) where.source = q.get("source")!;
  if (q.get("date")) where.date = q.get("date")!;
  if (q.get("open") === "1") where.status = { not: "DONE" };
  const tasks = await prisma.task.findMany({
    where,
    include: { assignedTo: { select: { name: true, empCode: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
  return ok(tasks);
});

/** Admin assigns task to one or many employees; employee adds own daily task */
export const POST = handler(async (req: Request) => {
  const s = await requireUser();
  const b = await req.json();
  const title = String(b.title || "").trim();
  if (!title) bad("Task title is required");
  const base = {
    title: title.slice(0, 200),
    description: b.description ? String(b.description).slice(0, 3000) : null,
    priority: ["LOW", "MEDIUM", "HIGH"].includes(b.priority) ? b.priority : "MEDIUM",
    dueDate: b.dueDate || null,
    date: dateKey(),
    createdById: s.id,
  };
  if (s.role === "EMPLOYEE") {
    await prisma.task.create({ data: { ...base, assignedToId: s.id, source: "SELF" } });
  } else {
    const ids: string[] = Array.isArray(b.assignedTo) ? b.assignedTo : [b.assignedTo].filter(Boolean);
    if (!ids.length) bad("Select at least one employee");
    await prisma.task.createMany({ data: ids.map((assignedToId) => ({ ...base, assignedToId, source: "ADMIN" })) });
  }
  return ok();
});
