export const dynamic = "force-dynamic";
import { prisma } from "@/lib/hr/db";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";

/** Bonus / deduction / salary advance entries for a month (admin only) */
export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const b = await req.json();
  if (!b.userId) bad("Select employee");
  if (!/^\d{4}-\d{2}$/.test(b.month || "")) bad("Select month");
  if (!["BONUS", "DEDUCTION", "ADVANCE"].includes(b.type)) bad("Invalid type");
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) bad("Enter a valid amount");
  await prisma.adjustment.create({
    data: { userId: b.userId, month: b.month, type: b.type, amount, note: b.note ? String(b.note).slice(0, 300) : null },
  });
  return ok();
});

export const DELETE = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) bad("Missing id");
  await prisma.adjustment.delete({ where: { id } });
  return ok();
});
