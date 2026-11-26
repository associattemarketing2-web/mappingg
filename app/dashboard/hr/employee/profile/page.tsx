"use client";
import { Loading, useApi } from "@/components/hr/ui";
import ChangePassword from "@/components/hr/ChangePassword";
import InstallButton from "@/components/hr/InstallButton";

type Me = { user: { name: string; empCode: string; email: string; phone: string | null; designation: string | null; department: string | null; joinDate: string } };

export default function Profile() {
  const { data } = useApi<Me>("/api/hr/me");
  if (!data) return <Loading />;
  const u = data.user;
  const rows: [string, string | null][] = [
    ["Employee ID", u.empCode],
    ["Email", u.email],
    ["Phone", u.phone],
    ["Designation", u.designation],
    ["Department", u.department],
    ["Joined", new Date(u.joinDate).toLocaleDateString("en-IN")],
  ];
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="card flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">{u.name[0]}</div>
        <div>
          <h1 className="text-xl font-bold">{u.name}</h1>
          <p className="text-sm text-slate-500">{u.designation || "Employee"}</p>
        </div>
      </div>
      <div className="card divide-y divide-slate-100 !py-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-2.5 text-sm">
            <span className="text-slate-500">{k}</span>
            <span className="font-medium">{v || "—"}</span>
          </div>
        ))}
      </div>
      <ChangePassword />
      <div className="card flex items-center justify-between">
        <span className="text-sm text-slate-600">Install this app on your phone for quick check-in</span>
        <InstallButton className="btn-primary btn-sm" />
      </div>
    </div>
  );
}
