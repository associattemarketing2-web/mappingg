export const dynamic = "force-dynamic";
import { prisma } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";

export const GET = handler(async () => {
  await requireUser();
  return ok(await prisma.holiday.findMany({ orderBy: { date: "asc" } }));
});

export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const b = await req.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") || !String(b.name || "").trim()) bad("Date and name are required");
  await prisma.holiday.upsert({ where: { date: b.date }, update: { name: b.name }, create: { date: b.date, name: b.name } });
  return ok();
});

export const DELETE = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) bad("Missing id");
  await prisma.holiday.delete({ where: { id } });
  return ok();
});
