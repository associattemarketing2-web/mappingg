"use client";
import { useState } from "react";
import { act, api, Badge, Empty, Loading, useApi } from "@/components/hr/ui";

type Task = { id: string; title: string; description: string | null; status: string; priority: string; source: string; dueDate: string | null; date: string; employeeNote: string | null };

export default function EmployeeTasks() {
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const url = filter === "open" ? "/api/hr/tasks?open=1" : filter === "done" ? "/api/hr/tasks?status=DONE" : "/api/hr/tasks";
  const { data, loading, reload } = useApi<Task[]>(url);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (await act(() => api("/api/hr/tasks", { body: { title, priority } }), "Task added")) {
      setTitle("");
      reload();
    }
  }
  async function update(t: Task, body: Record<string, unknown>, msg = "Updated") {
    await act(() => api(`/api/hr/tasks/${t.id}`, { method: "PUT", body }), msg);
    reload();
  }
  async function remove(t: Task) {
    if (!confirm("Delete this task?")) return;
    await act(() => api(`/api/hr/tasks/${t.id}`, { method: "DELETE" }), "Deleted");
    reload();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="page-title">My Tasks</h1>

      <form onSubmit={add} className="card flex flex-col gap-2 sm:flex-row">
        <input className="input flex-1" placeholder="Add today's task…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="input sm:w-32" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <button className="btn-primary">+ Add</button>
      </form>

      <div className="flex gap-2">
        {(["open", "done", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={filter === f ? "btn-primary btn-sm" : "btn-ghost btn-sm"}>
            {f === "open" ? "Open" : f === "done" ? "Completed" : "All"}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No tasks here.</Empty>
      ) : (
        <div className="space-y-3">
          {data.map((t) => (
            <div key={t.id} className="card">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-emerald-600"
                  checked={t.status === "DONE"}
                  onChange={(e) => update(t, { status: e.target.checked ? "DONE" : "PENDING" }, e.target.checked ? "Completed 🎉" : "Reopened")}
                />
                <div className="min-w-0 flex-1">
                  <div className={`font-semibold ${t.status === "DONE" ? "text-slate-400 line-through" : ""}`}>{t.title}</div>
                  {t.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{t.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge v={t.source} label={t.source === "ADMIN" ? "Assigned by admin" : "Self"} />
                    <Badge v={t.priority} />
                    <Badge v={t.status} />
                    <span className="text-xs text-slate-400">Added {t.date}</span>
                    {t.dueDate && <span className="text-xs font-medium text-rose-600">Due {t.dueDate}</span>}
                  </div>
                  <input
                    className="input mt-2 !py-1.5 text-xs"
                    placeholder="Add a note / update for admin…"
                    defaultValue={t.employeeNote || ""}
                    onBlur={(e) => e.target.value !== (t.employeeNote || "") && update(t, { employeeNote: e.target.value }, "Note saved")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  {t.status === "PENDING" && (
                    <button className="btn-ghost btn-sm" onClick={() => update(t, { status: "IN_PROGRESS" })}>
                      Start
                    </button>
                  )}
                  {t.source === "SELF" && (
                    <button className="btn-ghost btn-sm text-rose-600" onClick={() => remove(t)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
