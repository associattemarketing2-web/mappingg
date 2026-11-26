"use client";
import { useEffect, useState } from "react";
import { act, api, Empty, Field, Loading, MapEmbed, Spinner, toast, useApi } from "@/components/hr/ui";
import ChangePassword from "@/components/hr/ChangePassword";

type Settings = {
  companyName: string; officeStart: string; officeEnd: string; graceMinutes: number; halfDayHours: number; workingDays: string;
  officeLat: number | null; officeLng: number | null; geofenceRadius: number; enforceGeofence: boolean; requireSelfie: boolean; payrollMode: string;
  casualLeavePerYear: number; sickLeavePerYear: number; paidLeavePerYear: number;
};
type Holiday = { id: string; date: string; name: string };
type Ann = { id: string; title: string; body: string; createdAt: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SettingsPage() {
  const { data, loading } = useApi<Settings>("/api/hr/settings");
  const [f, setF] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    if (data) setF(data);
  }, [data]);

  if (loading || !f) return <Loading />;
  const days = f.workingDays.split(",").filter(Boolean).map(Number);

  async function save() {
    setBusy(true);
    await act(() => api("/api/hr/settings", { method: "PUT", body: f }), "Settings saved");
    setBusy(false);
  }

  function captureLocation() {
    if (!navigator.geolocation) return toast.error("Location not supported");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setF((x) => x && { ...x, officeLat: +p.coords.latitude.toFixed(6), officeLng: +p.coords.longitude.toFixed(6) });
        setLocating(false);
        toast.success(`Location captured (±${Math.round(p.coords.accuracy)} m). Click Save.`);
      },
      () => {
        setLocating(false);
        toast.error("Could not get location. Allow location permission.");
      },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="page-title">Settings</h1>

      <div className="card space-y-4">
        <h2 className="font-bold">🏢 Company &amp; office timing</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Field label="Company name">
              <input className="input" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
            </Field>
          </div>
          <Field label="Office start time">
            <input type="time" className="input" value={f.officeStart} onChange={(e) => setF({ ...f, officeStart: e.target.value })} />
          </Field>
          <Field label="Office end time">
            <input type="time" className="input" value={f.officeEnd} onChange={(e) => setF({ ...f, officeEnd: e.target.value })} />
          </Field>
          <Field label="Late grace (minutes)">
            <input type="number" min="0" className="input" value={f.graceMinutes} onChange={(e) => setF({ ...f, graceMinutes: +e.target.value })} />
          </Field>
          <Field label="Half day if worked less than (hours)">
            <input type="number" min="0" step="0.5" className="input" value={f.halfDayHours} onChange={(e) => setF({ ...f, halfDayHours: +e.target.value })} />
          </Field>
          <Field label="Salary calculation">
            <select className="input" value={f.payrollMode} onChange={(e) => setF({ ...f, payrollMode: e.target.value })}>
              <option value="HOURS">By hours worked</option>
              <option value="DAYS">By present days</option>
            </select>
          </Field>
          <Field label="Selfie on check-in/out">
            <select className="input" value={f.requireSelfie ? "1" : "0"} onChange={(e) => setF({ ...f, requireSelfie: e.target.value === "1" })}>
              <option value="1">Required</option>
              <option value="0">Optional</option>
            </select>
          </Field>
        </div>
        <div>
          <span className="label">Working days</span>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => setF({ ...f, workingDays: (days.includes(i) ? days.filter((x) => x !== i) : [...days, i]).sort().join(",") })}
                className={days.includes(i) ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-bold">🌴 Leave limits per year</h2>
        <p className="text-sm text-slate-500">Employees cannot request more than this (counted in working days). Unpaid leave has no limit.</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Casual leave">
            <input type="number" min="0" className="input" value={f.casualLeavePerYear} onChange={(e) => setF({ ...f, casualLeavePerYear: +e.target.value })} />
          </Field>
          <Field label="Sick leave">
            <input type="number" min="0" className="input" value={f.sickLeavePerYear} onChange={(e) => setF({ ...f, sickLeavePerYear: +e.target.value })} />
          </Field>
          <Field label="Paid leave">
            <input type="number" min="0" className="input" value={f.paidLeavePerYear} onChange={(e) => setF({ ...f, paidLeavePerYear: +e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-bold">📍 Office location &amp; geofence</h2>
        <p className="text-sm text-slate-500">Stand in the office and click “Use my current location”, or paste latitude/longitude from Google Maps.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Latitude">
            <input className="input" value={f.officeLat ?? ""} onChange={(e) => setF({ ...f, officeLat: e.target.value === "" ? null : (e.target.value as unknown as number) })} />
          </Field>
          <Field label="Longitude">
            <input className="input" value={f.officeLng ?? ""} onChange={(e) => setF({ ...f, officeLng: e.target.value === "" ? null : (e.target.value as unknown as number) })} />
          </Field>
          <Field label="Allowed radius (metres)">
            <input type="number" min="20" className="input" value={f.geofenceRadius} onChange={(e) => setF({ ...f, geofenceRadius: +e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={captureLocation} disabled={locating}>
            {locating && <Spinner />} 🎯 Use my current location
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.enforceGeofence} onChange={(e) => setF({ ...f, enforceGeofence: e.target.checked })} />
            Allow check-in <b>only inside office radius</b>
          </label>
        </div>
        {f.officeLat != null && f.officeLng != null && String(f.officeLat) !== "" && <MapEmbed lat={Number(f.officeLat)} lng={Number(f.officeLng)} />}
      </div>

      <div className="sticky bottom-20 z-10 flex justify-end lg:bottom-4">
        <button className="btn-primary px-8 shadow-lg" onClick={save} disabled={busy}>
          {busy && <Spinner />} Save settings
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Holidays />
        <Announcements />
      </div>
      <ChangePassword />
    </div>
  );
}

function Holidays() {
  const { data, reload } = useApi<Holiday[]>("/api/hr/holidays");
  const [f, setF] = useState({ date: "", name: "" });
  async function add() {
    if (await act(() => api("/api/hr/holidays", { body: f }), "Holiday added")) {
      setF({ date: "", name: "" });
      reload();
    }
  }
  return (
    <div className="card space-y-3">
      <h2 className="font-bold">🎉 Holidays</h2>
      <div className="flex gap-2">
        <input type="date" className="input !w-40" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <input className="input" placeholder="Holiday name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <button className="btn-primary" onClick={add}>
          Add
        </button>
      </div>
      {!data?.length ? (
        <Empty>No holidays added.</Empty>
      ) : (
        <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
          {data.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                <b>{h.date}</b> · {h.name}
              </span>
              <button
                className="text-xs font-semibold text-rose-600"
                onClick={async () => {
                  await act(() => api(`/api/hr/holidays?id=${h.id}`, { method: "DELETE" }), "Removed");
                  reload();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Announcements() {
  const { data, reload } = useApi<Ann[]>("/api/hr/announcements");
  const [f, setF] = useState({ title: "", body: "" });
  async function add() {
    if (await act(() => api("/api/hr/announcements", { body: f }), "Announcement posted")) {
      setF({ title: "", body: "" });
      reload();
    }
  }
  return (
    <div className="card space-y-3">
      <h2 className="font-bold">📢 Announcements</h2>
      <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea className="input min-h-[70px]" placeholder="Message for all employees" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <button className="btn-primary w-full" onClick={add}>
        Post announcement
      </button>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
        {data?.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-2 py-2 text-sm">
            <div>
              <b>{a.title}</b>
              <p className="text-slate-500">{a.body}</p>
            </div>
            <button
              className="text-xs font-semibold text-rose-600"
              onClick={async () => {
                await act(() => api(`/api/hr/announcements?id=${a.id}`, { method: "DELETE" }), "Deleted");
                reload();
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
