"use client";
import { useState } from "react";
import { act, api, Badge, Empty, Loading, useApi } from "@/components/hr/ui";
import { datesBetween } from "@/lib/hr/time";
import LeaveBalance from "@/components/hr/LeaveBalance";

type Leave = { id: string; userId: string; fromDate: string; toDate: string; type: string; reason: string | null; status: string; adminNote: string | null; createdAt: string; user: { name: string; empCode: string } };

export default function AdminLeaves() {
  const [status, setStatus] = useState("PENDING");
  const { data, loading, reload } = useApi<Leave[]>(`/api/hr/leaves${status ? `?status=${status}` : ""}`);

  async function decide(l: Leave, s: string) {
    const note = s === "REJECTED" ? prompt("Reason for rejection (optional)") ?? undefined : undefined;
    await act(() => api(`/api/hr/leaves/${l.id}`, { method: "PUT", body: { status: s, adminNote: note } }), s === "APPROVED" ? "Leave approved" : s === "REJECTED" ? "Leave rejected" : "Updated");
    reload();
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Leave requests</h1>
      <div className="flex flex-wrap gap-2">
        {["PENDING", "APPROVED", "REJECTED", ""].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={status === s ? "btn-primary btn-sm" : "btn-ghost btn-sm"}>
            {s ? s.toLowerCase() : "all"}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No leave requests.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((l) => (
            <div key={l.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{l.user.name}</div>
                  <div className="text-xs text-slate-500">{l.user.empCode}</div>
                </div>
                <Badge v={l.status} />
              </div>
              <div className="text-sm">
                <b>{l.type}</b> · {l.fromDate}
                {l.toDate !== l.fromDate && ` → ${l.toDate}`} ({datesBetween(l.fromDate, l.toDate).length} day{datesBetween(l.fromDate, l.toDate).length > 1 ? "s" : ""})
              </div>
              {l.status === "PENDING" && <LeaveBalance userId={l.userId} compact />}
              {l.reason && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">{l.reason}</p>}
              {l.adminNote && <p className="text-xs text-slate-500">Note: {l.adminNote}</p>}
              <div className="flex gap-2 pt-1">
                {l.status !== "APPROVED" && (
                  <button className="btn-success btn-sm" onClick={() => decide(l, "APPROVED")}>
                    ✓ Approve
                  </button>
                )}
                {l.status !== "REJECTED" && (
                  <button className="btn-danger btn-sm" onClick={() => decide(l, "REJECTED")}>
                    ✕ Reject
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
