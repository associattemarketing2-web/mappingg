"use client";
import { useState } from "react";
import { Badge, Empty, Loading, MapLink, SelfieThumb, Stat, useApi, money } from "@/components/hr/ui";
import { dateKey, fmtMinutes, fmtTime } from "@/lib/hr/time";

type Att = { id: string; date: string; checkIn: string; checkOut: string | null; isLate: boolean; lateMinutes: number; workedMinutes: number; autoClosed: boolean; checkInLat: number | null; checkInLng: number | null; checkInAddress: string | null; adminNote: string | null };
type Pay = { rows: { workedMinutes: number; present: number; lateDays: number; workingDays: number; absent: number; paidLeave: number; halfDays: number; payable: number; netPay: number; overtimeMinutes: number }[] };

export default function MyAttendance() {
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const att = useApi<Att[]>(`/api/hr/attendance?month=${month}`);
  const pay = useApi<Pay>(`/api/hr/payroll?month=${month}`);
  const p = pay.data?.rows[0];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">My Attendance</h1>
        <div className="flex gap-2">
          <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <a href="/dashboard/hr/employee/payslip" className="btn-primary whitespace-nowrap">
            🧾 Payslip
          </a>
        </div>
      </div>

      {p && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Hours worked" value={fmtMinutes(p.workedMinutes)} tone="blue" />
          <Stat label="Present" value={`${p.present}/${p.workingDays}`} tone="green" />
          <Stat label="Half days" value={p.halfDays} tone="amber" />
          <Stat label="Late" value={p.lateDays} tone="amber" />
          <Stat label="Absent" value={p.absent} tone="red" />
          <Stat label="Est. salary" value={money(p.netPay)} tone="green" sub={p.paidLeave ? `incl. ${p.paidLeave} paid leave` : undefined} />
        </div>
      )}

      {att.loading && !att.data ? (
        <Loading />
      ) : !att.data?.length ? (
        <Empty>No attendance for this month.</Empty>
      ) : (
        <div className="space-y-2">
          {att.data.map((a) => (
            <div key={a.id} className="card flex items-center gap-3 !p-3">
              <SelfieThumb id={a.id} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {new Date(a.date + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                  {a.isLate && <Badge v="LATE" label={`Late ${a.lateMinutes}m`} />}
                  {a.autoClosed && <Badge v="PENDING" label="No check-out" />}
                </div>
                <div className="text-sm text-slate-600">
                  {fmtTime(a.checkIn)} → {fmtTime(a.checkOut)} · <b>{fmtMinutes(a.workedMinutes)}</b>
                </div>
                {a.adminNote && <div className="text-xs text-slate-400">Note: {a.adminNote}</div>}
              </div>
              <MapLink lat={a.checkInLat} lng={a.checkInLng} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
