"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { act, api, Badge, Empty, Loading, money, useApi } from "@/components/hr/ui";
import EmployeeForm, { type Employee } from "@/components/hr/EmployeeForm";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Employees />
    </Suspense>
  );
}

function Employees() {
  const { data, loading, reload } = useApi<Employee[]>("/api/hr/employees");
  const params = useSearchParams();
  const [edit, setEdit] = useState<Employee | null | "new">(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (params.get("new")) setEdit("new");
  }, [params]);

  const list = (data || []).filter((e) => `${e.name} ${e.empCode} ${e.email} ${e.designation} ${e.department}`.toLowerCase().includes(q.toLowerCase()));

  async function toggle(e: Employee) {
    await act(() => api(`/api/hr/employees/${e.id}`, { method: "PUT", body: { active: !e.active } }), e.active ? "Employee disabled (no HR access)" : "Employee enabled");
    reload();
  }
  async function remove(e: Employee) {
    if (!confirm(`Delete ${e.name}? All attendance, tasks & leaves of this employee will be deleted permanently.`)) return;
    await act(() => api(`/api/hr/employees/${e.id}`, { method: "DELETE" }), "Employee deleted");
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Employees</h1>
        <div className="flex gap-2">
          <input className="input !w-56" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-primary whitespace-nowrap" onClick={() => setEdit("new")}>
            + Add Employee
          </button>
        </div>
      </div>

      {loading && !data ? (
        <Loading />
      ) : !list.length ? (
        <Empty>{data?.length ? "No match." : "No employees yet. Click “Add Employee” — they sign in to Mappingg with their email & password."}</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Login</th>
                <th>Role</th>
                <th>Salary</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className={e.active ? "" : "opacity-60"}>
                  <td>
                    <Link href={`/dashboard/hr/admin/employees/${e.id}`} className="font-semibold hover:text-brand-600">
                      {e.name}
                    </Link>
                    <div className="text-xs text-slate-500">{e.phone || ""}</div>
                  </td>
                  <td>
                    <div className="font-mono text-xs">{e.empCode}</div>
                    <div className="text-xs text-slate-500">{e.email}</div>
                  </td>
                  <td>
                    <div>{e.designation || "—"}</div>
                    <div className="text-xs text-slate-500">{e.department || ""}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    {money(e.salary)}
                    <span className="text-xs text-slate-500">{e.salaryType === "HOURLY" ? "/hr" : "/month"}</span>
                  </td>
                  <td>
                    <Badge v={e.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Link href={`/dashboard/hr/admin/employees/${e.id}`} className="btn-ghost btn-sm">
                      View
                    </Link>{" "}
                    <button className="btn-ghost btn-sm" onClick={() => setEdit(e)}>
                      Edit
                    </button>{" "}
                    <button className="btn-ghost btn-sm" onClick={() => toggle(e)}>
                      {e.active ? "Disable" : "Enable"}
                    </button>{" "}
                    <button className="btn-ghost btn-sm text-rose-600" onClick={() => remove(e)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <EmployeeForm
          emp={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
