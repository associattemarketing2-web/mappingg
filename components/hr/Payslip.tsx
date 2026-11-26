"use client";
import { Empty, Loading, money, useApi } from "./ui";
import { fmtMinutes } from "@/lib/hr/time";

type Row = {
  userId: string; name: string; empCode: string; email: string; designation: string | null; department: string | null; joinDate: string;
  salaryType: string; salary: number; workingDays: number; present: number; fullDays: number; halfDays: number; lateDays: number; paidLeave: number; unpaidLeave: number; absent: number;
  workedMinutes: number; overtimeMinutes: number; hourlyRate: number; payable: number; bonus: number; deductions: number; advance: number; netPay: number;
};
type Adj = { id: string; userId: string; type: string; amount: number; note: string | null };

/** Indian number system amount in words */
function inWords(n: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? " " + a[x % 10] : ""}`);
  const three = (x: number) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x));
  n = Math.round(n);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), rest = n % 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(" ");
}

export default function Payslip({ month, userId }: { month: string; userId?: string }) {
  const { data, loading, error } = useApi<{ companyName: string; mode: string; rows: Row[]; adjustments: Adj[] }>(
    `/api/hr/payroll?month=${month}${userId ? `&userId=${userId}` : ""}`,
  );
  if (loading && !data) return <Loading />;
  if (error || !data?.rows[0]) return <Empty>{error || "No salary data for this month."}</Empty>;
  const r = data.rows[0];
  const adj = data.adjustments.filter((x) => x.userId === r.userId);
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const earnings: [string, number][] = [
    [r.salaryType === "HOURLY" ? `Hourly pay (${(r.workedMinutes / 60).toFixed(1)} h × ₹${r.salary})` : `Salary for attendance (${data.mode === "DAYS" ? "by days" : "by hours"})`, r.payable],
    ...adj.filter((x) => x.type === "BONUS").map((x) => [`Bonus${x.note ? " – " + x.note : ""}`, x.amount] as [string, number]),
  ];
  const deductions: [string, number][] = adj
    .filter((x) => x.type !== "BONUS")
    .map((x) => [`${x.type === "ADVANCE" ? "Salary advance" : "Deduction"}${x.note ? " – " + x.note : ""}`, x.amount]);
  const totalEarn = earnings.reduce((t, e) => t + e[1], 0);
  const totalDed = deductions.reduce((t, e) => t + e[1], 0);

  const info: [string, string][] = [
    ["Employee", r.name],
    ["Employee ID", r.empCode],
    ["Designation", r.designation || "—"],
    ["Department", r.department || "—"],
    ["Joining date", new Date(r.joinDate).toLocaleDateString("en-IN")],
    [r.salaryType === "HOURLY" ? "Rate per hour" : "Monthly salary", money(r.salary)],
  ];
  const att: [string, string | number][] = [
    ["Working days", r.workingDays],
    ["Present", r.present],
    ["Half days", r.halfDays],
    ["Late", r.lateDays],
    ["Paid leave", r.paidLeave],
    ["Unpaid leave", r.unpaidLeave],
    ["Absent", r.absent],
    ["Hours worked", fmtMinutes(r.workedMinutes)],
    ["Overtime", fmtMinutes(r.overtimeMinutes)],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <button className="btn-primary" onClick={() => window.print()}>
          🖨 Print / Save PDF
        </button>
      </div>
      <div className="card space-y-5 !p-6 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{data.companyName}</h1>
            <p className="text-sm text-slate-500">Salary slip for {monthLabel}</p>
          </div>
          <div className="rounded-xl bg-brand-50 px-3 py-2 text-right">
            <div className="text-xs text-slate-500">Net pay</div>
            <div className="text-xl font-bold text-brand-700">{money(r.netPay)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {info.map(([k, v]) => (
            <div key={k}>
              <div className="text-xs text-slate-500">{k}</div>
              <div className="font-semibold">{v}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="label">Attendance summary</div>
          <div className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
            {att.map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="font-semibold">{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["Earnings", earnings, totalEarn],
              ["Deductions", deductions, totalDed],
            ] as const
          ).map(([title, list, total]) => (
            <div key={title} className="overflow-hidden rounded-xl border border-slate-200">
              <div className="bg-slate-50 px-3 py-2 text-sm font-semibold">{title}</div>
              <table className="w-full text-sm">
                <tbody>
                  {list.length === 0 && (
                    <tr>
                      <td className="px-3 py-2 text-slate-400">—</td>
                    </tr>
                  )}
                  {list.map(([k, v], i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2">{k}</td>
                      <td className="px-3 py-2 text-right">{money(v)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 font-bold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{money(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-emerald-50 p-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Net pay</span>
            <span className="text-2xl font-bold text-emerald-700">{money(r.netPay)}</span>
          </div>
          <div className="mt-1 text-sm text-emerald-800">Rupees {inWords(r.netPay)} Only</div>
        </div>

        <p className="text-center text-xs text-slate-400">This is a computer generated salary slip and does not need a signature.</p>
      </div>
    </div>
  );
}
