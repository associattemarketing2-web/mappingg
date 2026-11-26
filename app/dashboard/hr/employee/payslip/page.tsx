"use client";
import { useState } from "react";
import Payslip from "@/components/hr/Payslip";
import { dateKey } from "@/lib/hr/time";

export default function MyPayslip() {
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="page-title">My Payslip</h1>
        <input type="month" className="input !w-auto" value={month} max={dateKey().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <Payslip month={month} />
    </div>
  );
}
