"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Empty, Loading, MapLink, SelfieThumb, Stat, useApi } from "@/components/hr/ui";
import { fmtMinutes, fmtTime } from "@/lib/hr/time";

type Row = {
  id: string; name: string; empCode: string; designation: string | null; status: string;
  attendance: { id: string; checkIn: string; checkOut: string | null; isLate: boolean; lateMinutes: number; checkInAddress: string | null; checkInDistance: number | null; checkInLat: number | null; checkInLng: number | null; todayPlan: string | null; workedMinutes: number } | null;
};
type Dash = {
  today: string; holiday: string | null;
  settings: { officeStart: string; officeEnd: string; companyName: string };
  stats: { total: number; present: number; working: number; late: number; onLeave: number; absent: number; pendingLeaves: number; openTasks: number; doneToday: number };
  week: { date: string; count: number }[];
  list: Row[];
};

export default function AdminDashboard() {
  const { data, loading, reload } = useApi<Dash>("/api/hr/admin/dashboard");
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    const t = setInterval(reload, 60000); // auto refresh every minute
    return () => clearInterval(t);
  }, [reload]);

  if (loading && !data) return <Loading />;
  if (!data) return <Empty>Could not load dashboard.</Empty>;
  const { stats } = data;
  const max = Math.max(1, ...data.week.map((w) => w.count), stats.total);
  const list = data.list.filter((r) => filter === "ALL" || r.status === filter || (filter === "LATE" && r.attendance?.isLate));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {new Date(data.today + "T12:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Office {data.settings.officeStart}–{data.settings.officeEnd}
            {data.holiday && <span className="ml-2 font-semibold text-amber-600">🎉 Holiday: {data.holiday}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/hr/admin/employees?new=1" className="btn-primary">
            + Add Employee
          </Link>
          <Link href="/dashboard/hr/admin/tasks" className="btn-ghost">
            Assign Task
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Employees" value={stats.total} />
        <Stat label="Present" value={stats.present} tone="green" sub={`${stats.working} working now`} />
        <Stat label="Late" value={stats.late} tone="amber" />
        <Stat label="Absent" value={stats.absent} tone="red" />
        <Stat label="On leave" value={stats.onLeave} tone="sky" />
        <Stat label="Pending leaves" value={stats.pendingLeaves} tone="blue" sub={`${stats.openTasks} open tasks`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Today&apos;s attendance</h2>
            <div className="flex flex-wrap gap-1">
              {["ALL", "WORKING", "CHECKED_OUT", "LATE", "ABSENT", "ON_LEAVE"].map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={filter === f ? "btn-primary btn-sm" : "btn-ghost btn-sm"}>
                  {f.replace("_", " ").toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          {!list.length ? (
            <Empty>{data.list.length ? "Nobody in this filter." : "No employees yet. Add your first employee."}</Empty>
          ) : (
            <div className="divide-y divide-slate-100">
              {list.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-3">
                  {r.attendance ? (
                    <SelfieThumb id={r.attendance.id} />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 font-bold text-slate-400">{r.name[0]}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/hr/admin/employees/${r.id}`} className="font-semibold hover:text-brand-600">
                      {r.name}
                    </Link>{" "}
                    <span className="text-xs text-slate-400">{r.empCode}</span>
                    {r.attendance ? (
                      <div className="text-xs text-slate-500">
                        In {fmtTime(r.attendance.checkIn)} · Out {fmtTime(r.attendance.checkOut)} · <b>{fmtMinutes(r.attendance.workedMinutes)}</b>
                        {r.attendance.checkInDistance != null && ` · ${r.attendance.checkInDistance} m from office`}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">{r.designation || "—"}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge v={r.status} label={r.status === "WORKING" ? "● Working" : undefined} />
                    {r.attendance?.isLate && <Badge v="LATE" label={`Late ${r.attendance.lateMinutes}m`} />}
                    {r.attendance && <MapLink lat={r.attendance.checkInLat} lng={r.attendance.checkInLng} label="Location" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="card">
            <h2 className="mb-4 font-bold">Last 7 days</h2>
            <div className="flex h-36 items-end gap-2">
              {data.week.map((w) => (
                <div key={w.date} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-semibold text-slate-600">{w.count}</span>
                  <div className="w-full rounded-t-md bg-brand-500" style={{ height: `${(w.count / max) * 100}px`, minHeight: 4 }} />
                  <span className="text-[10px] text-slate-400">{new Date(w.date + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" })}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card space-y-2">
            <h2 className="font-bold">Quick actions</h2>
            <Link href="/dashboard/hr/admin/leaves" className="btn-ghost w-full justify-between">
              Leave requests <Badge v="PENDING" label={String(stats.pendingLeaves)} />
            </Link>
            <Link href="/dashboard/hr/admin/payroll" className="btn-ghost w-full justify-between">
              Salary &amp; hours report <span>→</span>
            </Link>
            <Link href="/dashboard/hr/admin/attendance" className="btn-ghost w-full justify-between">
              Attendance register <span>→</span>
            </Link>
            <Link href="/dashboard/hr/admin/settings" className="btn-ghost w-full justify-between">
              Office time &amp; location <span>→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
