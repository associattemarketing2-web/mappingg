"use client";
import { useState } from "react";
import { act, api, Badge, downloadCSV, Empty, Field, Loading, MapEmbed, MapLink, Modal, SelfieThumb, useApi } from "@/components/hr/ui";
import type { Employee } from "@/components/hr/EmployeeForm";
import { dateKey, fmtMinutes, fmtTime, hhmm } from "@/lib/hr/time";

type Att = {
  id: string; userId: string; date: string; checkIn: string; checkOut: string | null; isLate: boolean; lateMinutes: number; workedMinutes: number; autoClosed: boolean;
  checkInLat: number | null; checkInLng: number | null; checkInAddress: string | null; checkInDistance: number | null;
  checkOutLat: number | null; checkOutLng: number | null; checkOutAddress: string | null;
  todayPlan: string | null; workSummary: string | null; adminNote: string | null;
  user: { name: string; empCode: string; designation: string | null };
};

export default function AdminAttendance() {
  const [mode, setMode] = useState<"day" | "month">("day");
  const [date, setDate] = useState(dateKey());
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const [userId, setUserId] = useState("");
  const emps = useApi<Employee[]>("/api/hr/employees");
  const url = `/api/hr/attendance?${mode === "day" ? `date=${date}` : `month=${month}`}${userId ? `&userId=${userId}` : ""}`;
  const { data, loading, reload } = useApi<Att[]>(url);
  const [view, setView] = useState<Att | null>(null);
  const [edit, setEdit] = useState<Att | null>(null);
  const [adding, setAdding] = useState(false);

  const totalMin = (data || []).reduce((s, a) => s + a.workedMinutes, 0);

  function exportCSV() {
    downloadCSV(`attendance-${mode === "day" ? date : month}.csv`, [
      ["Date", "Emp ID", "Name", "Check in", "Check out", "Hours", "Late (min)", "Distance from office (m)", "Check-in address", "Today plan", "Work summary", "Admin note"],
      ...(data || []).map((a) => [a.date, a.user.empCode, a.user.name, fmtTime(a.checkIn), fmtTime(a.checkOut), (a.workedMinutes / 60).toFixed(2), a.lateMinutes, a.checkInDistance, a.checkInAddress, a.todayPlan, a.workSummary, a.adminNote]),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Attendance</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={exportCSV} disabled={!data?.length}>
            ⬇ Export CSV
          </button>
          <button className="btn-primary" onClick={() => setAdding(true)}>
            + Manual entry
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex rounded-xl border border-slate-200 p-1">
          {(["day", "month"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === m ? "bg-brand-600 text-white" : "text-slate-600"}`}>
              {m === "day" ? "Day" : "Month"}
            </button>
          ))}
        </div>
        {mode === "day" ? (
          <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        ) : (
          <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
        )}
        <select className="input !w-auto" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All employees</option>
          {emps.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.empCode})
            </option>
          ))}
        </select>
        <div className="ml-auto text-sm text-slate-500">
          {data?.length || 0} records · Total <b>{fmtMinutes(totalMin)}</b>
        </div>
      </div>

      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No attendance records.</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Selfie</th>
                <th>Check in</th>
                <th>Check out</th>
                <th>Hours</th>
                <th>Location</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="font-semibold">{a.user.name}</div>
                    <div className="text-xs text-slate-500">{a.user.empCode}</div>
                  </td>
                  <td className="whitespace-nowrap">{a.date}</td>
                  <td>
                    <div className="flex gap-1">
                      <SelfieThumb id={a.id} size={38} />
                      {a.checkOut && <SelfieThumb id={a.id} type="out" size={38} />}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    {fmtTime(a.checkIn)}
                    {a.isLate && (
                      <div>
                        <Badge v="LATE" label={`Late ${a.lateMinutes}m`} />
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {a.checkOut ? fmtTime(a.checkOut) : a.autoClosed ? <Badge v="PENDING" label="Forgot" /> : <Badge v="WORKING" label="Working" />}
                  </td>
                  <td className="whitespace-nowrap font-semibold">{fmtMinutes(a.workedMinutes)}</td>
                  <td className="max-w-[200px] text-xs">
                    <MapLink lat={a.checkInLat} lng={a.checkInLng} label={a.checkInDistance != null ? `${a.checkInDistance} m` : "Map"} />
                    <div className="line-clamp-2 text-slate-500">{a.checkInAddress}</div>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setView(a)}>
                      View
                    </button>{" "}
                    <button className="btn-ghost btn-sm" onClick={() => setEdit(a)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view && (
        <Modal open onClose={() => setView(null)} title={`${view.user.name} · ${view.date}`} wide>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["in", "out"] as const).map((t) => {
              const lat = t === "in" ? view.checkInLat : view.checkOutLat;
              const lng = t === "in" ? view.checkInLng : view.checkOutLng;
              const time = t === "in" ? view.checkIn : view.checkOut;
              if (!time) return <Empty key={t}>Not checked out yet</Empty>;
              return (
                <div key={t} className="space-y-2">
                  <div className="font-semibold">
                    Check {t} · {fmtTime(time)}
                  </div>
                  <SelfieThumb id={view.id} type={t} size={200} />
                  {lat != null && lng != null && <MapEmbed lat={lat} lng={lng} h={180} />}
                  <p className="text-xs text-slate-500">{t === "in" ? view.checkInAddress : view.checkOutAddress}</p>
                </div>
              );
            })}
          </div>
          {(view.todayPlan || view.workSummary) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {view.todayPlan && (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="label">Today&apos;s plan</div>
                  <p className="whitespace-pre-wrap">{view.todayPlan}</p>
                </div>
              )}
              {view.workSummary && (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="label">Work summary</div>
                  <p className="whitespace-pre-wrap">{view.workSummary}</p>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {edit && <EditModal a={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {adding && <AddModal emps={emps.data || []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function EditModal({ a, onClose, onSaved }: { a: Att; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ checkIn: hhmm(a.checkIn), checkOut: hhmm(a.checkOut), adminNote: a.adminNote || "" });
  async function save() {
    if (await act(() => api(`/api/hr/attendance/${a.id}`, { method: "PUT", body: f }), "Attendance updated")) onSaved();
  }
  async function del() {
    if (!confirm("Delete this attendance record?")) return;
    if (await act(() => api(`/api/hr/attendance/${a.id}`, { method: "DELETE" }), "Deleted")) onSaved();
  }
  return (
    <Modal open onClose={onClose} title={`Edit · ${a.user.name} · ${a.date}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Check in">
          <input type="time" className="input" value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} />
        </Field>
        <Field label="Check out">
          <input type="time" className="input" value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Admin note">
            <input className="input" value={f.adminNote} onChange={(e) => setF({ ...f, adminNote: e.target.value })} placeholder="Reason for correction" />
          </Field>
        </div>
        <div className="flex justify-between gap-2 sm:col-span-2">
          <button className="btn-ghost text-rose-600" onClick={del}>
            Delete
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ emps, onClose, onSaved }: { emps: Employee[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ userId: emps[0]?.id || "", date: dateKey(), checkIn: "09:30", checkOut: "18:30", adminNote: "" });
  async function save() {
    if (await act(() => api("/api/hr/attendance", { body: f }), "Attendance added")) onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Manual attendance entry">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Employee">
            <select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
              {emps.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.empCode})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Date">
          <input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Note">
          <input className="input" value={f.adminNote} onChange={(e) => setF({ ...f, adminNote: e.target.value })} placeholder="e.g. field visit" />
        </Field>
        <Field label="Check in">
          <input type="time" className="input" value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} />
        </Field>
        <Field label="Check out">
          <input type="time" className="input" value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} />
        </Field>
        <button className="btn-primary sm:col-span-2" onClick={save}>
          Add attendance
        </button>
      </div>
    </Modal>
  );
}
