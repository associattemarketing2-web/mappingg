export const dynamic = "force-dynamic";
import { prisma } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";

export const GET = handler(async () => {
  await requireUser();
  return ok(await prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 30 }));
});

export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const b = await req.json();
  if (!String(b.title || "").trim() || !String(b.body || "").trim()) bad("Title and message are required");
  await prisma.announcement.create({ data: { title: String(b.title).slice(0, 200), body: String(b.body).slice(0, 3000) } });
  return ok();
});

export const DELETE = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) bad("Missing id");
  await prisma.announcement.delete({ where: { id } });
  return ok();
});
