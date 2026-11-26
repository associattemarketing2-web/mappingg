"use client";
import { useState } from "react";
import { act, api, Field, Modal, Spinner } from "./ui";

export type Employee = {
  id: string; empCode: string; name: string; email: string; phone: string | null; designation: string | null; department: string | null;
  salaryType: "MONTHLY" | "HOURLY"; salary: number; joinDate: string; active: boolean;
  bankName?: string | null; bankAccount?: string | null;
};

export default function EmployeeForm({ emp, onClose, onSaved }: { emp: Employee | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: emp?.name || "",
    empCode: emp?.empCode || "",
    email: emp?.email || "",
    password: "",
    phone: emp?.phone || "",
    designation: emp?.designation || "",
    department: emp?.department || "",
    salaryType: emp?.salaryType || "MONTHLY",
    salary: emp ? String(emp.salary) : "",
    joinDate: (emp?.joinDate || new Date().toISOString()).slice(0, 10),
    bankName: emp?.bankName || "",
    bankAccount: emp?.bankAccount || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  function genPass() {
    const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#";
    setF({ ...f, password: Array.from({ length: 10 }, () => c[Math.floor(Math.random() * c.length)]).join("") });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { ...f, password: f.password || undefined };
    const ok = await act(
      () => (emp ? api(`/api/hr/employees/${emp.id}`, { method: "PUT", body }) : api("/api/hr/employees", { body })),
      emp ? "Employee updated" : "Employee created",
    );
    setBusy(false);
    if (ok) onSaved();
  }

  return (
    <Modal open onClose={onClose} title={emp ? `Edit ${emp.name}` : "Add new employee"} wide>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name *">
          <input className="input" value={f.name} onChange={set("name")} required />
        </Field>
        <Field label="Employee ID">
          <input className="input uppercase" value={f.empCode} onChange={set("empCode")} placeholder="Auto e.g. EMP001" />
        </Field>
        <Field label="Email (Mappingg login) *">
          <input type="email" className="input" value={f.email} onChange={set("email")} required />
        </Field>
        <Field label={emp ? "New password (leave blank to keep)" : "Password (Mappingg login)"}>
          <div className="flex gap-2">
            <input className="input" value={f.password} onChange={set("password")} minLength={8} placeholder={emp ? "min 8 characters" : "min 8 · blank if already a Mappingg employee"} />
            <button type="button" className="btn-ghost btn-sm whitespace-nowrap" onClick={genPass}>
              Generate
            </button>
          </div>
        </Field>
        <Field label="Phone">
          <input className="input" value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label="Joining date">
          <input type="date" className="input" value={f.joinDate} onChange={set("joinDate")} />
        </Field>
        <Field label="Designation">
          <input className="input" value={f.designation} onChange={set("designation")} placeholder="e.g. Sales Executive" />
        </Field>
        <Field label="Department">
          <input className="input" value={f.department} onChange={set("department")} placeholder="e.g. Sales" />
        </Field>
        <Field label="Salary type">
          <select className="input" value={f.salaryType} onChange={set("salaryType")}>
            <option value="MONTHLY">Monthly salary</option>
            <option value="HOURLY">Per hour</option>
          </select>
        </Field>
        <Field label={f.salaryType === "HOURLY" ? "Rate per hour (₹)" : "Monthly salary (₹)"}>
          <input type="number" min="0" className="input" value={f.salary} onChange={set("salary")} placeholder="0" />
        </Field>
        <Field label="Bank name (salary slip)">
          <input className="input" value={f.bankName} onChange={set("bankName")} placeholder="e.g. AU Small Finance Bank" />
        </Field>
        <Field label="Bank A/c No (salary slip)">
          <input className="input" inputMode="numeric" value={f.bankAccount} onChange={set("bankAccount")} />
        </Field>
        <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy && <Spinner />} {emp ? "Save changes" : "Create employee"}
          </button>
        </div>
        {!emp && <p className="text-xs text-slate-500 sm:col-span-2">Share the Email / Employee ID and password with the employee — they log in with either.</p>}
      </form>
    </Modal>
  );
}
