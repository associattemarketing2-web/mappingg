import { redirect } from "next/navigation";
import Shell from "@/components/hr/Shell";
import { getHrAccess } from "@/lib/hr/auth";

export const dynamic = "force-dynamic";

const items = [
  { href: "/dashboard/hr/employee", label: "Home", icon: "🏠" },
  { href: "/dashboard/hr/employee/tasks", label: "Tasks", icon: "✅" },
  { href: "/dashboard/hr/employee/attendance", label: "History", icon: "🗓️" },
  { href: "/dashboard/hr/employee/leaves", label: "Leaves", icon: "🌴" },
  { href: "/dashboard/hr/employee/profile", label: "Profile", icon: "👤" },
];

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const a = await getHrAccess();
  if (a.kind !== "ok") redirect(a.kind === "signed-out" ? "/?signin=1" : "/dashboard/hr");
  if (a.session.role !== "EMPLOYEE") redirect("/dashboard/hr/admin");
  return (
    <Shell items={items} role="EMPLOYEE">
      {children}
    </Shell>
  );
}
