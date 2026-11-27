"use client";
import { useEffect, useState } from "react";
import { act, api, Badge, Empty, Loading, MapEmbed, Modal, Spinner, Stat, toast, useApi } from "@/components/hr/ui";
import { SelfieCamera, useLiveLocation } from "@/components/hr/Capture";
import { fmtMinutes, fmtTime, dateKey } from "@/lib/hr/time";
import { greetingFor, indiaHour } from "@/lib/greeting";
import { distanceMeters } from "@/lib/hr/geo";

type Settings = {
  companyName: string; officeStart: string; officeEnd: string; requireSelfie: boolean; enforceGeofence: boolean;
  officeLat: number | null; officeLng: number | null; geofenceRadius: number;
};
type Me = { user: { name: string; empCode: string }; settings: Settings };
type Att = { id: string; checkIn: string; checkOut: string | null; isLate: boolean; lateMinutes: number; checkInAddress: string | null; todayPlan: string | null; workSummary: string | null; workedMinutes: number };
type Task = { id: string; title: string; description: string | null; status: string; priority: string; source: string; dueDate: string | null };
type Ann = { id: string; title: string; body: string; createdAt: string };
type Pay = { rows: { workedMinutes: number; present: number; lateDays: number; workingDays: number; absent: number }[] };

function to12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export default function EmployeeHome() {
  const me = useApi<Me>("/api/hr/me");
  const att = useApi<Att[]>("/api/hr/attendance");
  const tasks = useApi<Task[]>("/api/hr/tasks?open=1");
  const ann = useApi<Ann[]>("/api/hr/announcements");
  const pay = useApi<Pay>(`/api/hr/payroll?month=${dateKey().slice(0, 7)}`);
  const [now, setNow] = useState(new Date());
  const [mode, setMode] = useState<"in" | "out" | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (me.loading && !me.data) return <Loading />;
  const s = me.data?.settings;
  const today = att.data?.[0];
  const liveMinutes = today ? ((today.checkOut ? new Date(today.checkOut) : now).getTime() - new Date(today.checkIn).getTime()) / 60000 : 0;
  const month = pay.data?.rows[0];
  const greet = greetingFor(indiaHour(now)); // India time, updates with the clock below

  async function setStatus(t: Task, status: string) {
    await act(() => api(`/api/hr/tasks/${t.id}`, { method: "PUT", body: { status } }), status === "DONE" ? "Task completed 🎉" : "Updated");
    tasks.reload();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-sm text-slate-500">{greet},</p>
        <h1 className="page-title">{me.data?.user.name} 👋</h1>
      </div>

      {/* Attendance card */}
      <div className="card overflow-hidden !p-0">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-4xl font-bold tabular-nums">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}</div>
              <div className="text-sm text-brand-100">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
            </div>
            {s && (
              <div className="rounded-xl bg-white/15 px-3 py-2 text-right text-xs">
                <div className="text-brand-100">Office time</div>
                <div className="font-semibold">
                  {to12(s.officeStart)} – {to12(s.officeEnd)}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="p-5">
          {att.loading && !att.data ? (
            <Loading />
          ) : !today ? (
            <div className="text-center">
              <p className="mb-4 text-slate-600">You have not checked in yet today.</p>
              <button className="btn-success w-full !py-4 text-base" onClick={() => setMode("in")}>
                📸 Check In (Selfie + Location)
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Check in</div>
                  <div className="font-bold">{fmtTime(today.checkIn)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Check out</div>
                  <div className="font-bold">{fmtTime(today.checkOut)}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3">
                  <div className="text-xs text-emerald-700">Worked</div>
                  <div className="font-bold tabular-nums text-emerald-700">{fmtMinutes(liveMinutes)}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {today.checkOut ? <Badge v="CHECKED_OUT" label="Day completed" /> : <Badge v="WORKING" label="● Working now" />}
                {today.isLate && <Badge v="LATE" label={`Late by ${today.lateMinutes} min`} />}
              </div>
              {today.checkInAddress && <p className="text-xs text-slate-500">📍 {today.checkInAddress}</p>}
              {!today.checkOut && (
                <button className="btn-danger w-full !py-4 text-base" onClick={() => setMode("out")}>
                  🏁 Check Out
                </button>
              )}
              {today.workSummary && (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="mb-1 text-xs font-semibold text-slate-500">Work summary</div>
                  <p className="whitespace-pre-wrap">{today.workSummary}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Month stats */}
      {month && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Hours this month" value={fmtMinutes(month.workedMinutes)} tone="blue" />
          <Stat label="Present days" value={`${month.present}/${month.workingDays}`} tone="green" />
          <Stat label="Late days" value={month.lateDays} tone="amber" />
          <Stat label="Absent" value={month.absent} tone="red" />
        </div>
      )}

      {/* Tasks */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">My open tasks</h2>
          <a href="/dashboard/hr/employee/tasks" className="text-sm font-semibold text-brand-600">
            View all →
          </a>
        </div>
        {!tasks.data?.length ? (
          <Empty>No pending tasks. Add your daily tasks from the Tasks tab.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.data.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-emerald-600" onChange={() => setStatus(t, "DONE")} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge v={t.source} label={t.source === "ADMIN" ? "Assigned" : "Self"} />
                    <Badge v={t.priority} />
                    <Badge v={t.status} />
                    {t.dueDate && <span className="text-xs text-slate-500">Due {t.dueDate}</span>}
                  </div>
                </div>
                {t.status === "PENDING" && (
                  <button className="btn-ghost btn-sm" onClick={() => setStatus(t, "IN_PROGRESS")}>
                    Start
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Announcements */}
      {!!ann.data?.length && (
        <div className="card">
          <h2 className="mb-3 font-bold">📢 Announcements</h2>
          <div className="space-y-3">
            {ann.data.slice(0, 5).map((a) => (
              <div key={a.id} className="rounded-xl bg-amber-50 p-3">
                <div className="font-semibold">{a.title}</div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{a.body}</p>
                <div className="mt-1 text-xs text-slate-400">{new Date(a.createdAt).toLocaleDateString("en-IN")}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode && s && (
        <PunchModal
          mode={mode}
          settings={s}
          openTasks={tasks.data || []}
          onClose={() => setMode(null)}
          onDone={() => {
            setMode(null);
            att.reload();
            tasks.reload();
            pay.reload();
          }}
        />
      )}
    </div>
  );
}

function PunchModal({ mode, settings, openTasks, onClose, onDone }: { mode: "in" | "out"; settings: Settings; openTasks: Task[]; onClose: () => void; onDone: () => void }) {
  const [selfie, setSelfie] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { loc, error, retry } = useLiveLocation(true);

  const dist = loc && settings.officeLat != null && settings.officeLng != null ? distanceMeters(loc.lat, loc.lng, settings.officeLat, settings.officeLng) : null;
  const outside = dist != null && dist > settings.geofenceRadius;
  const blocked = mode === "in" && settings.enforceGeofence && outside;

  async function submit() {
    if (settings.requireSelfie && !selfie) return toast.error("Please click a selfie first");
    if (!loc) return toast.error("Waiting for your live location…");
    setBusy(true);
    const ok = await act(async () => {
      if (mode === "out" && done.length) await Promise.all(done.map((id) => api(`/api/hr/tasks/${id}`, { method: "PUT", body: { status: "DONE" } })));
      await api(`/api/hr/attendance/check-${mode}`, {
        body: { selfie, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, [mode === "in" ? "todayPlan" : "workSummary"]: text },
      });
    }, mode === "in" ? "Checked in successfully ✅" : "Checked out. Have a good evening! 👋");
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <Modal open onClose={onClose} title={mode === "in" ? "Check In" : "Check Out"}>
      <div className="space-y-4">
        <div>
          <div className="label">1. Selfie {settings.requireSelfie ? "(required)" : "(optional)"}</div>
          <SelfieCamera value={selfie} onChange={setSelfie} />
        </div>

        <div>
          <div className="label">2. Live location</div>
          {error ? (
            <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              {error}{" "}
              <button className="font-semibold underline" onClick={retry}>
                Retry
              </button>
            </div>
          ) : !loc ? (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <Spinner /> Fetching your live location…
            </div>
          ) : (
            <div className="space-y-2">
              <MapEmbed lat={loc.lat} lng={loc.lng} h={170} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>
                  {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} (±{loc.accuracy} m)
                </span>
                {dist != null && <Badge v={outside ? "ABSENT" : "DONE"} label={outside ? `${dist} m from office` : `In office range (${dist} m)`} />}
              </div>
              {blocked && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">You must be within {settings.geofenceRadius} m of the office to check in.</div>}
            </div>
          )}
        </div>

        {mode === "out" && openTasks.length > 0 && (
          <div>
            <div className="label">Mark tasks completed today</div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {openTasks.map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-600"
                    checked={done.includes(t.id)}
                    onChange={(e) => setDone(e.target.checked ? [...done, t.id] : done.filter((x) => x !== t.id))}
                  />
                  {t.title}
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="label">{mode === "in" ? "3. Today's tasks / plan (one per line)" : "3. What did you complete today?"}</div>
          <textarea
            className="input min-h-[90px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === "in" ? "Call 10 leads\nPrepare site visit report\nUpdate CRM" : "Short summary of today's work"}
          />
          {mode === "in" && <p className="mt-1 text-xs text-slate-400">Each line is saved as a daily task you can tick off later.</p>}
        </div>

        <button className={`${mode === "in" ? "btn-success" : "btn-danger"} w-full !py-3.5`} onClick={submit} disabled={busy || !loc || blocked || (settings.requireSelfie && !selfie)}>
          {busy && <Spinner />} {mode === "in" ? "Confirm Check In" : "Confirm Check Out"}
        </button>
      </div>
    </Modal>
  );
}
