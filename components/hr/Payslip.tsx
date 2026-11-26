"use client";
/* eslint-disable @next/next/no-img-element */
import { Empty, Loading, useApi } from "./ui";

// Salary slip in the company's own format (the Excel slip HR used before):
// letterhead, employee + bank details, Earnings / Deductions side by side, net
// pay and amount in words. Printed with "Print / Save PDF" on A4 landscape.

export type SlipRow = {
  userId: string;
  name: string;
  empCode: string;
  designation: string | null;
  department: string | null;
  joinDate: string;
  bankName: string | null;
  bankAccount: string | null;
  salaryType: string;
  salary: number;
  workingDays: number;
  paidDays: number;
  lopDays: number;
  payable: number;
  bonus: number;
  deductions: number;
  advance: number;
  fuel: number;
  professionalTax: number;
  netPay: number;
};

const LETTERHEAD = {
  company: "ASSOCIATTE PROPTECH PVT LTD",
  contact: "(E) info@Associatte.com , (M) +91 88 8118 8181",
  address: "303, Naren Pearl, Magarpatta Road, Hadapsar, Pune - 411036",
};

/** Salary split of the month's earned pay; Special allowance takes the rounding remainder. */
const BREAKUP: [string, number][] = [
  ["Basic Salary", 0.5],
  ["House Rent Allowances", 0.2],
  ["Conveyance Allowances", 0.1],
  ["Medical Allowances", 0.1],
];

/** Indian number system amount in words */
function inWords(n: number): string {
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? " " + a[x % 10] : ""}`);
  const three = (x: number) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x));
  n = Math.round(n);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7),
    lakh = Math.floor((n % 1e7) / 1e5),
    thousand = Math.floor((n % 1e5) / 1e3),
    rest = n % 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(" ");
}

const inr2 = (n: number) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inr0 = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** 1 → "01 ST", 22 → "22 ND", 30 → "30 TH" */
function dayOrd(d: number) {
  const suffix = d % 10 === 1 && d !== 11 ? "ST" : d % 10 === 2 && d !== 12 ? "ND" : d % 10 === 3 && d !== 13 ? "RD" : "TH";
  return `${String(d).padStart(2, "0")} ${suffix}`;
}

/** Part of the logo image (public/img/Associattelogo.png, 2000×2000) cropped to [x0, y0, x1, y1]. */
function LogoCrop({ box, height }: { box: [number, number, number, number]; height: number }) {
  const [x0, y0, x1, y1] = box;
  const k = height / (y1 - y0);
  return (
    <div style={{ position: "relative", overflow: "hidden", width: (x1 - x0) * k, height }}>
      <img src="/img/Associattelogo.png" alt="" style={{ position: "absolute", maxWidth: "none", width: 2000 * k, left: -x0 * k, top: -y0 * k }} />
    </div>
  );
}

const B = "1.5px solid #000";
const THICK = "3px solid #000";
const serif = { fontFamily: '"Times New Roman", Times, serif' };
const sans = { fontFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif' };
const cell: React.CSSProperties = { border: B, padding: "2px 5px", lineHeight: 1.35, verticalAlign: "middle" };

export default function Payslip({ month, userId }: { month: string; userId?: string }) {
  const { data, loading, error } = useApi<{ rows: SlipRow[] }>(`/api/hr/payroll?month=${month}${userId ? `&userId=${userId}` : ""}`);
  if (loading && !data) return <Loading />;
  if (error || !data?.rows[0]) return <Empty>{error || "No salary data for this month."}</Empty>;
  return (
    <div className="mx-auto max-w-[980px]">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <button className="btn-primary" onClick={() => window.print()}>
          🖨 Print / Save PDF
        </button>
      </div>
      <SlipView r={data.rows[0]} month={month} />
    </div>
  );
}

/** The slip itself, from one payroll row. */
export function SlipView({ r, month }: { r: SlipRow; month: string }) {
  const [y, m] = month.split("-").map(Number);
  const mon = MONTHS[m - 1];
  const lastDay = new Date(y, m, 0).getDate();

  // Earnings: the month's earned pay split by BREAKUP, Special = remainder.
  const parts = BREAKUP.map(([k, pct]) => [k, round2(r.payable * pct)] as [string, number]);
  parts.push(["Special Allowances", round2(r.payable - parts.reduce((t, p) => t + p[1], 0))]);
  const gross = round2(r.payable + r.bonus);
  const ded: [string, number, boolean?][] = [
    ["EPF", 0],
    ["Health Insurance/ESI", 0],
    ["Professional Tax", r.professionalTax],
    ["Advance", r.advance, true],
    ["Fuel Pending", r.fuel, true],
  ];
  const totalDed = r.professionalTax + r.advance + r.fuel + r.deductions;
  const extra = r.bonus > 0 || r.deductions > 0;

  const info: [string, React.ReactNode, string, React.ReactNode][] = [
    ["Employee Name", <b key="n">{r.name.toUpperCase()}</b>, "Total Working Days", r.workingDays.toFixed(2)],
    ["Designation", (r.designation || "—").toUpperCase(), "LOP Days", r.lopDays.toFixed(2)],
    ["Department,", (r.department || "—").toUpperCase(), "Paid Days", r.paidDays.toFixed(2)],
    [
      "Date of Joining",
      new Date(r.joinDate).toLocaleDateString("en-GB").replace(/\//g, "-"),
      "Bank Name",
      <span key="b" style={serif}>
        {r.bankName || "—"}
      </span>,
    ],
    [
      "Gross Salary",
      <span key="g" style={serif}>
        {r.salaryType === "HOURLY" ? `${inr2(r.salary)} / hour` : inr2(r.salary)}
      </span>,
      "Bank A/c No",
      <span key="a" style={serif}>
        {r.bankAccount || "—"}
      </span>,
    ],
  ];

  return (
    <div className="overflow-x-auto bg-white print:overflow-visible">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } }`}</style>
      <table
        style={{
          ...serif,
          width: "100%",
          minWidth: 820,
          borderCollapse: "collapse",
          border: THICK,
          color: "#000",
          fontSize: 19,
          tableLayout: "fixed",
          background: "#fff",
        }}
      >
        <colgroup>
          <col style={{ width: "24.3%" }} />
          <col style={{ width: "23.5%" }} />
          <col style={{ width: "22.1%" }} />
          <col style={{ width: "30.1%" }} />
        </colgroup>
        <tbody>
          {/* Letterhead */}
          <tr>
            <td colSpan={4} style={{ borderBottom: THICK, padding: 0, height: 128, position: "relative" }}>
              <div style={{ ...sans, position: "absolute", left: 3, top: 4, fontSize: 15 }}>{LETTERHEAD.company}</div>
              <div style={{ position: "absolute", left: 52, top: 8 }}>
                <LogoCrop box={[463, 170, 1560, 1503]} height={116} />
              </div>
              <div style={{ textAlign: "center", paddingTop: 30, paddingLeft: 60 }}>
                <div style={{ fontSize: 16 }}>{LETTERHEAD.contact}</div>
                <div style={{ fontSize: 21, marginTop: 4 }}>{LETTERHEAD.address}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                  SALARY SLIP FOR {mon}-{y}
                </div>
              </div>
            </td>
          </tr>
          {/* Pay period */}
          <tr>
            <td colSpan={4} style={{ ...cell, position: "relative", fontSize: 20, textAlign: "center", height: 30 }}>
              <div style={{ position: "absolute", left: 14, top: 2 }}>
                <LogoCrop box={[41, 1548, 1979, 1845]} height={26} />
              </div>
              {dayOrd(1)} {mon} {y} TO {dayOrd(lastDay)} {mon} {y}
            </td>
          </tr>
          {/* Employee + bank details */}
          {info.map(([k1, v1, k2, v2]) => (
            <tr key={k1}>
              <td style={cell}>{k1}</td>
              <td style={{ ...cell, ...sans, fontSize: 17 }}>{v1}</td>
              <td style={cell}>{k2}</td>
              <td style={{ ...cell, ...sans, fontSize: 17 }}>{v2}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4} style={{ ...cell, height: 30 }} />
          </tr>
          {/* Earnings | Deductions */}
          <tr>
            <td colSpan={2} style={{ ...cell, textAlign: "center", fontWeight: 700 }}>
              Earnings
            </td>
            <td colSpan={2} style={{ ...cell, textAlign: "center", fontWeight: 700 }}>
              Deductions
            </td>
          </tr>
          {parts.map(([k, v], i) => (
            <tr key={k}>
              <td style={cell}>{k}</td>
              <td style={{ ...cell, textAlign: "right" }}>{inr2(v)}</td>
              <td style={{ ...cell, ...(ded[i][2] ? { ...sans, fontSize: 17 } : {}) }}>{ded[i][0]}</td>
              <td style={{ ...cell, textAlign: "right" }}>{inr0(ded[i][1])}</td>
            </tr>
          ))}
          {extra && (
            <tr>
              <td style={cell}>{r.bonus > 0 ? "Bonus / Incentive" : ""}</td>
              <td style={{ ...cell, textAlign: "right" }}>{r.bonus > 0 ? inr2(r.bonus) : ""}</td>
              <td style={{ ...cell, ...sans, fontSize: 17 }}>{r.deductions > 0 ? "Other Deductions" : ""}</td>
              <td style={{ ...cell, textAlign: "right" }}>{r.deductions > 0 ? inr0(r.deductions) : ""}</td>
            </tr>
          )}
          <tr>
            <td style={cell}>Gross Salary</td>
            <td style={{ ...cell, textAlign: "right" }}>{inr2(gross)}</td>
            <td style={cell}>Total Deductions</td>
            <td style={{ ...cell, textAlign: "right" }}>{inr0(totalDed)}</td>
          </tr>
          <tr>
            <td colSpan={3} style={{ ...cell, borderBottom: THICK, textAlign: "center", fontWeight: 700 }}>
              NET PAY
            </td>
            <td style={{ ...cell, borderBottom: THICK, textAlign: "right", fontWeight: 700 }}>₹ {r.netPay.toLocaleString("en-IN")}</td>
          </tr>
          {/* Amount in words */}
          <tr>
            <td colSpan={4} style={{ borderBottom: THICK, padding: "16px 0 16px 32px", fontWeight: 700, fontSize: 20 }}>
              <span style={{ display: "inline-block", width: 237 }}>Amount in word:-</span>
              Rupees {inWords(r.netPay)} Only
            </td>
          </tr>
          <tr>
            <td colSpan={4} style={{ ...sans, height: 82, textAlign: "center", color: "#e00000", fontSize: 17 }}>
              *This is a computer generated document, so does not require signatures.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
