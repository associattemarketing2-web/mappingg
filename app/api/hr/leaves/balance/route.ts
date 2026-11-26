export const dynamic = "force-dynamic";
import { handler, requireUser, ok, bad } from "@/lib/hr/auth";
import { leaveBalance } from "@/lib/hr/leaves";
import { dateKey } from "@/lib/hr/time";

/** GET ?userId=&year= — employee: own balance */
export const GET = handler(async (req: Request) => {
  const s = await requireUser();
  const q = new URL(req.url).searchParams;
  const userId = s.role === "EMPLOYEE" ? s.id : q.get("userId");
  if (!userId) bad("Missing employee");
  const year = q.get("year") || dateKey().slice(0, 4);
  return ok({ year, balance: await leaveBalance(userId, year) });
});
