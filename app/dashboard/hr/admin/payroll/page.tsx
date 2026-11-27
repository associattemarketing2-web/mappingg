"use client";
import Link from "next/link";
import { useState } from "react";
import { act, api, downloadCSV, Empty, Field, Loading, Modal, money, Stat, useApi } from "@/components/hr/ui";
import { dateKey, fmtMinutes } from "@/lib/hr/time";

type Row = {
  userId: string; name: string; empCode: string; designation: string | null; salaryType: string; salary: number;
  workingDays: number; elapsedDays: number; present: number; fullDays: number; halfDays: number; lateDays: number; paidLeave: number; unpaidLeave: number; absent: number;
  workedMinutes: number; overtimeMinutes: number; expectedMinutes: number; hourlyRate: number; payable: number;
  bonus: number; deductions: number; advance: number; fuel: number; professionalTax: number; netPay: number;
};
type Adj = { id: string; userId: string; type: string; amount: number; note: string | null };

export default function Payroll() {
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const { data, loading, reload } = useApi<{ month: string; mode: string; rows: Row[]; adjustments: Adj[] }>(`/api/hr/payroll?month=${month}`);
  const [adjFor, setAdjFor] = useState<Row | null>(null);
  const rows = data?.rows || [];
  const total = rows.reduce((s, r) => s + r.netPay, 0);
  const totalMin = rows.reduce((s, r) => s + r.workedMinutes, 0);

  function exportCSV() {
    downloadCSV(`salary-${month}.csv`, [
      ["Emp ID", "Name", "Designation", "Salary type", "Salary / rate", "Working days", "Present", "Full days", "Half days", "Late", "Paid leave", "Unpaid leave", "Absent", "Hours worked", "Overtime hours", "Rate per hour", "Attendance pay", "Bonus", "Deductions", "Advance", "Fuel pending", "Professional tax", "Net pay"],
      ...rows.map((r) => [r.empCode, r.name, r.designation, r.salaryType, r.salary, r.workingDays, r.present, r.fullDays, r.halfDays, r.lateDays, r.paidLeave, r.unpaidLeave, r.absent, (r.workedMinutes / 60).toFixed(2), (r.overtimeMinutes / 60).toFixed(2), r.hourlyRate, r.payable, r.bonus, r.deductions, r.advance, r.fuel, r.professionalTax, r.netPay]),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Salary &amp; Hours</h1>
          <p className="text-sm text-slate-500">
            Calculation mode: <b>{data?.mode === "DAYS" ? "By present days" : "By hours worked"}</b> (change in Settings)
          </p>
        </div>
        <div className="flex gap-2">
          <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn-primary" onClick={exportCSV} disabled={!rows.length}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Employees" value={rows.length} />
        <Stat label="Total hours" value={fmtMinutes(totalMin)} tone="blue" />
        <Stat label="Total net pay" value={money(total)} tone="green" />
        <Stat label="Working days" value={rows[0]?.workingDays ?? "—"} sub="excl. weekly off & holidays" />
      </div>

      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>No active employees.</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Salary</th>
                <th>Present</th>
                <th>Half / Late</th>
                <th>Leave</th>
                <th>Absent</th>
                <th>Hours worked</th>
                <th>Attendance pay</th>
                <th>+ Bonus / − Ded.</th>
                <th className="text-right">Net pay</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>
                    <Link href={`/dashboard/hr/admin/employees/${r.userId}`} className="font-semibold hover:text-brand-600">
                      {r.name}
                    </Link>
                    <div className="text-xs text-slate-500">{r.empCode}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    {money(r.salary)}
                    <span className="text-xs text-slate-500">{r.salaryType === "HOURLY" ? "/hr" : "/mo"}</span>
                    <div className="text-xs text-slate-400">₹{r.hourlyRate}/hr</div>
                  </td>
                  <td>
                    {r.present}/{r.workingDays}
                  </td>
                  <td>
                    {r.halfDays} / {r.lateDays}
                  </td>
                  <td>
                    {r.paidLeave}
                    {r.unpaidLeave > 0 && <span className="text-xs text-rose-600"> +{r.unpaidLeave} unpaid</span>}
                  </td>
                  <td className="text-rose-600">{r.absent}</td>
                  <td className="whitespace-nowrap">
                    <b>{fmtMinutes(r.workedMinutes)}</b>
                    {r.overtimeMinutes > 0 && <span className="text-xs text-sky-600"> (+{fmtMinutes(r.overtimeMinutes)} OT)</span>}
                    <div className="h-1.5 w-24 overflow-hidden rounded bg-slate-100">
                      <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, (r.workedMinutes / (r.expectedMinutes || 1)) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{money(r.payable)}</td>
                  <td className="whitespace-nowrap text-xs">
                    {r.bonus > 0 && <div className="text-emerald-600">+{money(r.bonus)}</div>}
                    {r.deductions + r.advance + r.fuel > 0 && <div className="text-rose-600">−{money(r.deductions + r.advance + r.fuel)}</div>}
                    {r.professionalTax > 0 && <div className="text-rose-600">−{money(r.professionalTax)} PT</div>}
                    {r.bonus === 0 && r.deductions + r.advance + r.fuel + r.professionalTax === 0 && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="whitespace-nowrap text-right text-base font-bold text-emerald-700">{money(r.netPay)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setAdjFor(r)}>
                      ± Adjust
                    </button>{" "}
                    <Link href={`/dashboard/hr/admin/payslip?userId=${r.userId}&month=${month}`} className="btn-ghost btn-sm">
                      🧾 Slip
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card text-sm text-slate-600">
        <b>How salary is calculated</b>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Working days = days of the month on your working weekdays, minus holidays (counted from joining date).</li>
          <li>Rate per hour = monthly salary ÷ (working days × office hours per day).</li>
          <li>
            <b>By hours:</b> attendance pay = (hours worked, max office hours per day + paid leave hours) × rate per hour. Overtime is shown separately.
          </li>
          <li>
            <b>By days:</b> attendance pay = (full days + ½ × half days + paid leave days) × (salary ÷ working days).
          </li>
          <li>Hourly employees: attendance pay = total hours × hourly rate.</li>
          <li>Net pay = attendance pay + bonus − deductions − salary advance − fuel pending − professional tax.</li>
          <li>Professional tax (Maharashtra): ₹200 a month (₹300 in February) when the month&apos;s gross is above ₹10,000, ₹175 above ₹7,500.</li>
          <li>Forgotten check-outs are auto-closed at office end time.</li>
        </ul>
      </div>

      {adjFor && (
        <AdjustModal
          row={adjFor}
          month={month}
          list={(data?.adjustments || []).filter((a) => a.userId === adjFor.userId)}
          onClose={() => setAdjFor(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function AdjustModal({ row, month, list, onClose, onChanged }: { row: Row; month: string; list: Adj[]; onClose: () => void; onChanged: () => void }) {
  const [f, setF] = useState({ type: "BONUS", amount: "", note: "" });
  async function add() {
    if (await act(() => api("/api/hr/adjustments", { body: { ...f, userId: row.userId, month } }), "Saved")) {
      setF({ ...f, amount: "", note: "" });
      onChanged();
    }
  }
  async function del(id: string) {
    await act(() => api(`/api/hr/adjustments?id=${id}`, { method: "DELETE" }), "Removed");
    onChanged();
  }
  return (
    <Modal open onClose={onClose} title={`Adjustments · ${row.name} · ${month}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="BONUS">+ Bonus / incentive</option>
              <option value="DEDUCTION">− Deduction / penalty</option>
              <option value="ADVANCE">− Salary advance</option>
              <option value="FUEL">− Fuel pending</option>
            </select>
          </Field>
          <Field label="Amount (₹)">
            <input type="number" min="1" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <div className="col-span-2">
            <Field label="Note">
              <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Diwali bonus, late penalty, advance on 5th" />
            </Field>
          </div>
        </div>
        <button className="btn-primary w-full" onClick={add} disabled={!f.amount}>
          Add
        </button>
        {list.length === 0 ? (
          <Empty>No adjustments this month.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {list.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  <b className={a.type === "BONUS" ? "text-emerald-600" : "text-rose-600"}>
                    {a.type === "BONUS" ? "+" : "−"}
                    {money(a.amount)}
                  </b>{" "}
                  {a.type === "FUEL" ? "fuel pending" : a.type.toLowerCase()} {a.note && <span className="text-slate-500">· {a.note}</span>}
                </span>
                <button className="text-xs font-semibold text-rose-600" onClick={() => del(a.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
