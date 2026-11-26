"use client";
import { useState } from "react";
import { act, api, Field } from "./ui";

export default function ChangePassword() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.next !== f.confirm) return act(async () => { throw new Error("New passwords do not match"); });
    if (await act(() => api("/api/hr/me", { body: { current: f.current, next: f.next } }), "Password changed")) setF({ current: "", next: "", confirm: "" });
  }
  return (
    <form onSubmit={save} className="card space-y-3">
      <h2 className="font-bold">Change password</h2>
      <Field label="Current password">
        <input type="password" className="input" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
      </Field>
      <Field label="New password">
        <input type="password" className="input" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
      </Field>
      <Field label="Confirm new password">
        <input type="password" className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
      </Field>
      <button className="btn-primary">Update password</button>
    </form>
  );
}
