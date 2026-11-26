import { redirect } from "next/navigation";
import Shell from "@/components/hr/Shell";
import { getHrAccess } from "@/lib/hr/auth";

export const dynamic = "force-dynamic";

const items = [
  { href: "/dashboard/hr/admin", label: "Dashboard", icon: "📊" },
  { href: "/dashboard/hr/admin/employees", label: "Employees", icon: "👥" },
  { href: "/dashboard/hr/admin/attendance", label: "Attendance", icon: "🕘" },
  { href: "/dashboard/hr/admin/tasks", label: "Tasks", icon: "✅" },
  { href: "/dashboard/hr/admin/leaves", label: "Leaves", icon: "🌴" },
  { href: "/dashboard/hr/admin/report", label: "Monthly Sheet", icon: "📅" },
  { href: "/dashboard/hr/admin/payroll", label: "Salary & Hours", icon: "💰" },
  { href: "/dashboard/hr/admin/settings", label: "Settings", icon: "⚙️" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const a = await getHrAccess();
  if (a.kind !== "ok") redirect(a.kind === "signed-out" ? "/?signin=1" : "/dashboard/hr");
  if (a.session.role !== "ADMIN") redirect("/dashboard/hr/employee");
  return (
    <Shell items={items} role="ADMIN">
      {children}
    </Shell>
  );
}
