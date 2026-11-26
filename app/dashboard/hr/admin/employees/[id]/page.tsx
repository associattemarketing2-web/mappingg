"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Empty, Loading, MapLink, SelfieThumb, Stat, money, useApi } from "@/components/hr/ui";
import EmployeeForm, { type Employee } from "@/components/hr/EmployeeForm";
import { dateKey, fmtMinutes, fmtTime } from "@/lib/hr/time";

type Att = { id: string; date: string; checkIn: string; checkOut: string | null; isLate: boolean; lateMinutes: number; workedMinutes: number; autoClosed: boolean; checkInLat: number | null; checkInLng: number | null; checkInAddress: string | null; todayPlan: string | null; workSummary: string | null };
type Pay = { rows: { workedMinutes: number; present: number; lateDays: number; workingDays: number; absent: number; paidLeave: number; unpaidLeave: number; halfDays: number; payable: number; hourlyRate: number; overtimeMinutes: number; expectedMinutes: number }[] };
type Task = { id: string; title: string; status: string; priority: string; source: string; date: string; dueDate: string | null };

export default function EmployeeDetail({ params }: { params: { id: string } }) {
  const { id } = params;
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const emp = useApi<Employee>(`/api/hr/employees/${id}`);
  const att = useApi<Att[]>(`/api/hr/attendance?month=${month}&userId=${id}`);
  const pay = useApi<Pay>(`/api/hr/payroll?month=${month}&userId=${id}`);
  const tasks = useApi<Task[]>(`/api/hr/tasks?userId=${id}`);
  const [editing, setEditing] = useState(false);

  if (emp.loading && !emp.data) return <Loading />;
  if (!emp.data) return <Empty>Employee not found.</Empty>;
  const e = emp.data;
  const p = pay.data?.rows[0];

  return (
    <div className="space-y-5">
      <Link href="/dashboard/hr/admin/employees" className="text-sm font-semibold text-brand-600">
        ← All employees
      </Link>
      <div className="card flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">{e.name[0]}</div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">
            {e.name} <Badge v={e.active ? "ACTIVE" : "INACTIVE"} />
          </h1>
          <p className="text-sm text-slate-500">
            {e.empCode} · {e.email} {e.phone && `· ${e.phone}`}
          </p>
          <p className="text-sm text-slate-500">
            {e.designation || "—"} {e.department && `· ${e.department}`} · Joined {new Date(e.joinDate).toLocaleDateString("en-IN")} · {money(e.salary)}
            {e.salaryType === "HOURLY" ? "/hr" : "/month"}
          </p>
        </div>
        <div className="flex gap-2">
          <input type="month" className="input !w-auto" value={month} onChange={(ev) => setMonth(ev.target.value)} />
          <Link href={`/dashboard/hr/admin/payslip?userId=${id}&month=${month}`} className="btn-ghost">
            🧾 Payslip
          </Link>
          <button className="btn-primary" onClick={() => setEditing(true)}>
            Edit / Reset password
          </button>
        </div>
      </div>

      {p && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Hours" value={fmtMinutes(p.workedMinutes)} tone="blue" sub={`of ${fmtMinutes(p.expectedMinutes)}`} />
          <Stat label="Overtime" value={fmtMinutes(p.overtimeMinutes)} tone="sky" />
          <Stat label="Present" value={`${p.present}/${p.workingDays}`} tone="green" />
          <Stat label="Half days" value={p.halfDays} tone="amber" />
          <Stat label="Late" value={p.lateDays} tone="amber" />
          <Stat label="Leave" value={p.paidLeave + p.unpaidLeave} sub={`${p.unpaidLeave} unpaid`} tone="sky" />
          <Stat label="Absent" value={p.absent} tone="red" />
          <Stat label="Payable" value={money(p.payable)} tone="green" sub={`₹${p.hourlyRate}/hr`} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card overflow-x-auto !p-0 lg:col-span-2">
          <h2 className="p-4 font-bold">Attendance – {month}</h2>
          {!att.data?.length ? (
            <div className="p-4">
              <Empty>No attendance this month.</Empty>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Selfies</th>
                  <th>In / Out</th>
                  <th>Hours</th>
                  <th>Location</th>
                  <th>Plan / Summary</th>
                </tr>
              </thead>
              <tbody>
                {att.data.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">
                      {a.date}
                      <div className="mt-1 flex gap-1">
                        {a.isLate && <Badge v="LATE" label={`Late ${a.lateMinutes}m`} />}
                        {a.autoClosed && <Badge v="PENDING" label="No out" />}
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <SelfieThumb id={a.id} size={38} />
                        {a.checkOut && <SelfieThumb id={a.id} type="out" size={38} />}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {fmtTime(a.checkIn)}
                      <br />
                      {fmtTime(a.checkOut)}
                    </td>
                    <td className="whitespace-nowrap font-semibold">{fmtMinutes(a.workedMinutes)}</td>
                    <td className="max-w-[180px] text-xs">
                      <MapLink lat={a.checkInLat} lng={a.checkInLng} />
                      <div className="line-clamp-2 text-slate-500">{a.checkInAddress}</div>
                    </td>
                    <td className="max-w-[220px] whitespace-pre-wrap text-xs text-slate-600">
                      {a.todayPlan && <div>📝 {a.todayPlan}</div>}
                      {a.workSummary && <div className="mt-1">✅ {a.workSummary}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 font-bold">Tasks</h2>
          {!tasks.data?.length ? (
            <Empty>No tasks.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tasks.data.slice(0, 30).map((t) => (
                <li key={t.id} className="py-2">
                  <div className={`text-sm font-medium ${t.status === "DONE" ? "text-slate-400 line-through" : ""}`}>{t.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge v={t.status} />
                    <Badge v={t.source} label={t.source === "ADMIN" ? "Assigned" : "Self"} />
                    <span className="text-xs text-slate-400">{t.date}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <EmployeeForm
          emp={e}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            emp.reload();
            pay.reload();
          }}
        />
      )}
    </div>
  );
}
