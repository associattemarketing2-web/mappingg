"use client";
import { useState } from "react";
import { act, api, Badge, Empty, Field, Loading, useApi } from "@/components/hr/ui";
import { dateKey } from "@/lib/hr/time";
import LeaveBalance from "@/components/hr/LeaveBalance";

type Leave = { id: string; fromDate: string; toDate: string; type: string; reason: string | null; status: string; adminNote: string | null; createdAt: string };
type Holiday = { id: string; date: string; name: string };

export default function MyLeaves() {
  const leaves = useApi<Leave[]>("/api/hr/leaves");
  const holidays = useApi<Holiday[]>("/api/hr/holidays");
  const [f, setF] = useState({ fromDate: dateKey(), toDate: dateKey(), type: "CASUAL", reason: "" });
  const [busy, setBusy] = useState(false);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (await act(() => api("/api/hr/leaves", { body: f }), "Leave request sent to admin")) {
      setF({ ...f, reason: "" });
      leaves.reload();
    }
    setBusy(false);
  }

  const upcoming = (holidays.data || []).filter((h) => h.date >= dateKey());

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="page-title">Leaves</h1>
      <LeaveBalance key={leaves.data?.length} />
      <form onSubmit={apply} className="card grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <input type="date" className="input" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} />
        </Field>
        <Field label="To">
          <input type="date" className="input" value={f.toDate} min={f.fromDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />
        </Field>
        <Field label="Type">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="CASUAL">Casual</option>
            <option value="SICK">Sick</option>
            <option value="PAID">Paid</option>
            <option value="UNPAID">Unpaid</option>
          </select>
        </Field>
        <Field label="Reason">
          <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Reason for leave" />
        </Field>
        <button className="btn-primary sm:col-span-2" disabled={busy}>
          Apply for leave
        </button>
      </form>

      <div className="card">
        <h2 className="mb-3 font-bold">My requests</h2>
        {leaves.loading && !leaves.data ? (
          <Loading />
        ) : !leaves.data?.length ? (
          <Empty>No leave requests yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {leaves.data.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <div className="font-medium">
                    {l.fromDate} {l.toDate !== l.fromDate && `→ ${l.toDate}`} · {l.type}
                  </div>
                  {l.reason && <div className="text-sm text-slate-500">{l.reason}</div>}
                  {l.adminNote && <div className="text-xs text-slate-400">Admin: {l.adminNote}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge v={l.status} />
                  {l.status === "PENDING" && (
                    <button
                      className="text-xs font-semibold text-rose-600"
                      onClick={async () => {
                        await act(() => api(`/api/hr/leaves/${l.id}`, { method: "DELETE" }), "Cancelled");
                        leaves.reload();
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {upcoming.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-bold">🎉 Upcoming holidays</h2>
          <ul className="space-y-1 text-sm">
            {upcoming.map((h) => (
              <li key={h.id} className="flex justify-between">
                <span>{h.name}</span>
                <span className="text-slate-500">{h.date}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
