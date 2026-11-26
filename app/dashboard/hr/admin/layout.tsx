import { redirect } from "next/navigation";
import Shell from "@/components/hr/Shell";
import { getHrAccess } from "@/lib/hr/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const a = await getHrAccess();
  if (a.kind !== "ok") redirect(a.kind === "signed-out" ? "/?signin=1" : "/dashboard/hr");
  if (a.session.role !== "ADMIN") redirect("/dashboard/hr/employee");
  return (
    <Shell>
      {children}
    </Shell>
  );
}
