"use client";
import { useApi } from "./ui";

type Bal = { year: string; balance: { type: string; quota: number | null; used: number; pending: number; remaining: number | null }[] };

/** Leave balance cards (full) or a one-line summary (compact) */
export default function LeaveBalance({ userId, compact }: { userId?: string; compact?: boolean }) {
  const { data } = useApi<Bal>(`/api/hr/leaves/balance${userId ? `?userId=${userId}` : ""}`);
  if (!data) return null;
  const list = data.balance.filter((b) => b.quota !== 0 || b.used > 0 || b.pending > 0);

  if (compact)
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
        {list.map((b) => (
          <span key={b.type}>
            {b.type.toLowerCase()}: <b className="text-slate-700">{b.remaining == null ? `${b.used} used` : `${b.remaining} left`}</b>
          </span>
        ))}
      </div>
    );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {list.map((b) => (
        <div key={b.type} className="card !p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{b.type.toLowerCase()} leave</div>
          <div className="mt-1 text-2xl font-bold text-brand-600">{b.remaining == null ? "∞" : b.remaining}</div>
          <div className="text-xs text-slate-500">
            {b.quota == null ? "no limit" : `left of ${b.quota}`} · {b.used} used{b.pending ? ` · ${b.pending} pending` : ""}
          </div>
        </div>
      ))}
      <p className="col-span-full -mt-1 text-xs text-slate-400">Balance for {data.year} (working days only).</p>
    </div>
  );
}
