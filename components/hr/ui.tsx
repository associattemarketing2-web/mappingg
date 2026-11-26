"use client";
import { useCallback, useEffect, useState } from "react";

/* ---------------- API helper ---------------- */
export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") {
    // signed out of Mappingg: go to the Mappingg sign-in
    window.location.href = "/?signin=1";
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, loading, error, reload, setData };
}

/* ---------------- Toasts ---------------- */
type T = { id: number; msg: string; type: "success" | "error" };
let push: ((t: T) => void) | null = null;
export const toast = {
  success: (msg: string) => push?.({ id: Date.now() + Math.random(), msg, type: "success" }),
  error: (msg: string) => push?.({ id: Date.now() + Math.random(), msg, type: "error" }),
};
export function ToastHost() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 3500);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.type === "success" ? "bg-emerald-600" : "bg-rose-600"}`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/** run an async action with toast feedback */
export async function act(fn: () => Promise<unknown>, success?: string) {
  try {
    await fn();
    if (success) toast.success(success);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

/* ---------------- Small components ---------------- */
export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-brand-600">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 text-2xl leading-none text-slate-400 hover:text-slate-700">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone = "slate", sub }: { label: string; value: React.ReactNode; tone?: string; sub?: string }) {
  const tones: Record<string, string> = {
    slate: "text-slate-900",
    green: "text-emerald-600",
    red: "text-rose-600",
    amber: "text-amber-600",
    blue: "text-brand-600",
    sky: "text-sky-600",
  };
  return (
    <div className="card !p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  WORKING: "bg-emerald-100 text-emerald-700",
  CHECKED_OUT: "bg-sky-100 text-sky-700",
  ABSENT: "bg-rose-100 text-rose-700",
  ON_LEAVE: "bg-amber-100 text-amber-700",
  LATE: "bg-orange-100 text-orange-700",
  PENDING: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  DONE: "bg-emerald-100 text-emerald-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-rose-100 text-rose-700",
  HIGH: "bg-rose-100 text-rose-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  INACTIVE: "bg-slate-200 text-slate-600",
  SELF: "bg-violet-100 text-violet-700",
  ADMIN: "bg-brand-100 text-brand-700",
};
export function Badge({ v, label }: { v: string; label?: string }) {
  return <span className={`badge ${badgeColors[v] || "bg-slate-100 text-slate-700"}`}>{label || v.replace("_", " ")}</span>;
}

export function MapLink({ lat, lng, label = "Map" }: { lat?: number | null; lng?: number | null; label?: string }) {
  if (lat == null || lng == null) return <span className="text-slate-400">—</span>;
  return (
    <a className="font-medium text-brand-600 hover:underline" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">
      📍 {label}
    </a>
  );
}

export function MapEmbed({ lat, lng, h = 220 }: { lat: number; lng: number; h?: number }) {
  return (
    <iframe
      title="map"
      className="w-full rounded-xl border border-slate-200"
      style={{ height: h }}
      loading="lazy"
      src={`https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`}
    />
  );
}

export function SelfieThumb({ id, type = "in", size = 44 }: { id: string; type?: "in" | "out"; size?: number }) {
  const [err, setErr] = useState(false);
  const [big, setBig] = useState(false);
  const src = `/api/hr/attendance/${id}/selfie?type=${type}`;
  if (err) return <div style={{ width: size, height: size }} className="flex items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">No pic</div>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="selfie" onError={() => setErr(true)} onClick={() => setBig(true)} style={{ width: size, height: size }} className="cursor-zoom-in rounded-lg object-cover ring-1 ring-slate-200" />
      {big && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setBig(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="selfie" className="max-h-[85vh] max-w-full rounded-2xl" />
        </div>
      )}
    </>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function money(n: number) {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}

export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}
