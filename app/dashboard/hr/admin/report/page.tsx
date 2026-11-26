"use client";
import Link from "next/link";
import { useState } from "react";
import { downloadCSV, Empty, Loading, useApi } from "@/components/hr/ui";
import { dateKey, fmtMinutes } from "@/lib/hr/time";

type Cell = { code: string; late?: boolean; minutes?: number; title?: string };
type Data = {
  month: string;
  days: { date: string; weekday: number }[];
  rows: { userId: string; name: string; empCode: string; cells: Cell[]; totals: { P: number; HD: number; L: number; A: number; late: number; minutes: number } }[];
};

const STYLE: Record<string, string> = {
  P: "bg-emerald-100 text-emerald-700",
  HD: "bg-amber-100 text-amber-700",
  L: "bg-sky-100 text-sky-700",
  A: "bg-rose-100 text-rose-700",
  WO: "bg-slate-100 text-slate-400",
  H: "bg-violet-100 text-violet-700",
  "": "text-slate-300",
};
const WD = ["S", "M", "T", "W", "T", "F", "S"];

export default function MonthlySheet() {
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const { data, loading } = useApi<Data>(`/api/hr/report/monthly?month=${month}`);

  function exportCSV() {
    if (!data) return;
    downloadCSV(`attendance-sheet-${month}.csv`, [
      ["Emp ID", "Name", ...data.days.map((d) => d.date.slice(8)), "Present", "Half day", "Leave", "Absent", "Late", "Hours"],
      ...data.rows.map((r) => [
        r.empCode,
        r.name,
        ...r.cells.map((c) => c.code + (c.late ? "*" : "")),
        r.totals.P,
        r.totals.HD,
        r.totals.L,
        r.totals.A,
        r.totals.late,
        (r.totals.minutes / 60).toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Monthly Attendance Sheet</h1>
          <p className="text-sm text-slate-500">Muster roll for all employees. A dot means late.</p>
        </div>
        <div className="flex gap-2">
          <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn-primary" onClick={exportCSV} disabled={!data?.rows.length}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {[
          ["P", "Present"],
          ["HD", "Half day"],
          ["L", "Leave"],
          ["A", "Absent"],
          ["WO", "Weekly off"],
          ["H", "Holiday"],
        ].map(([c, l]) => (
          <span key={c} className={`badge ${STYLE[c]}`}>
            {c} = {l}
          </span>
        ))}
      </div>

      {loading && !data ? (
        <Loading />
      ) : !data?.rows.length ? (
        <Empty>No active employees.</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 min-w-[150px] border-b border-slate-200 bg-slate-50 px-3 py-2 text-left">Employee</th>
                {data.days.map((d) => (
                  <th key={d.date} className={`border-b border-slate-200 px-0.5 py-1 text-center font-medium ${d.weekday === 0 ? "text-rose-500" : "text-slate-500"}`}>
                    <div>{+d.date.slice(8)}</div>
                    <div className="text-[10px] font-normal">{WD[d.weekday]}</div>
                  </th>
                ))}
                {["P", "HD", "L", "A", "Late", "Hours"].map((h) => (
                  <th key={h} className="border-b border-l border-slate-200 px-2 py-2 text-center">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.userId} className="hover:bg-slate-50">
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5">
                    <Link href={`/dashboard/hr/admin/employees/${r.userId}`} className="font-semibold hover:text-brand-600">
                      {r.name}
                    </Link>
                    <div className="text-[10px] text-slate-400">{r.empCode}</div>
                  </td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="border-b border-slate-100 p-0.5 text-center">
                      <span
                        title={c.minutes != null ? `${fmtMinutes(c.minutes)}${c.late ? " · late" : ""}` : c.title}
                        className={`relative inline-flex h-6 w-7 items-center justify-center rounded text-[10px] font-bold ${STYLE[c.code] ?? ""}`}
                      >
                        {c.code || "·"}
                        {c.late && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-orange-500" />}
                      </span>
                    </td>
                  ))}
                  <td className="border-b border-l border-slate-100 px-2 text-center font-semibold text-emerald-700">{r.totals.P}</td>
                  <td className="border-b border-slate-100 px-2 text-center text-amber-700">{r.totals.HD}</td>
                  <td className="border-b border-slate-100 px-2 text-center text-sky-700">{r.totals.L}</td>
                  <td className="border-b border-slate-100 px-2 text-center text-rose-700">{r.totals.A}</td>
                  <td className="border-b border-slate-100 px-2 text-center text-orange-600">{r.totals.late}</td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-2 text-center font-semibold">{fmtMinutes(r.totals.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
