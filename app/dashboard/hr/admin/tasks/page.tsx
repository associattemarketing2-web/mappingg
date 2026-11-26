"use client";
import { useState } from "react";
import { act, api, Badge, Empty, Field, Loading, Modal, useApi } from "@/components/hr/ui";
import type { Employee } from "@/components/hr/EmployeeForm";

type Task = {
  id: string; title: string; description: string | null; status: string; priority: string; source: string; date: string; dueDate: string | null;
  employeeNote: string | null; completedAt: string | null; assignedTo: { name: string; empCode: string };
};

export default function AdminTasks() {
  const emps = useApi<Employee[]>("/api/hr/employees");
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const qs = new URLSearchParams({ ...(userId && { userId }), ...(status && { status }), ...(source && { source }) }).toString();
  const { data, loading, reload } = useApi<Task[]>(`/api/hr/tasks?${qs}`);
  const [assign, setAssign] = useState(false);

  async function setTaskStatus(t: Task, s: string) {
    await act(() => api(`/api/hr/tasks/${t.id}`, { method: "PUT", body: { status: s } }), "Updated");
    reload();
  }
  async function remove(t: Task) {
    if (!confirm("Delete this task?")) return;
    await act(() => api(`/api/hr/tasks/${t.id}`, { method: "DELETE" }), "Deleted");
    reload();
  }

  const counts = { open: (data || []).filter((t) => t.status !== "DONE").length, done: (data || []).filter((t) => t.status === "DONE").length };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Tasks</h1>
        <button className="btn-primary" onClick={() => setAssign(true)}>
          + Assign task
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-2">
        <select className="input !w-auto" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All employees</option>
          {emps.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="PENDING">Pending</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="DONE">Done</option>
        </select>
        <select className="input !w-auto" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Assigned + daily</option>
          <option value="ADMIN">Assigned by admin</option>
          <option value="SELF">Employee daily tasks</option>
        </select>
        <span className="ml-auto text-sm text-slate-500">
          {counts.open} open · {counts.done} done
        </span>
      </div>

      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No tasks found.</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Employee</th>
                <th>Priority</th>
                <th>Dates</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-sm">
                    <div className="font-semibold">{t.title}</div>
                    {t.description && <div className="line-clamp-2 text-xs text-slate-500">{t.description}</div>}
                    {t.employeeNote && <div className="mt-1 text-xs text-violet-700">💬 {t.employeeNote}</div>}
                    <Badge v={t.source} label={t.source === "ADMIN" ? "Assigned" : "Daily (self)"} />
                  </td>
                  <td className="whitespace-nowrap">
                    {t.assignedTo.name}
                    <div className="text-xs text-slate-500">{t.assignedTo.empCode}</div>
                  </td>
                  <td>
                    <Badge v={t.priority} />
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    Added {t.date}
                    {t.dueDate && <div className="text-rose-600">Due {t.dueDate}</div>}
                    {t.completedAt && <div className="text-emerald-600">Done {new Date(t.completedAt).toLocaleDateString("en-IN")}</div>}
                  </td>
                  <td>
                    <select className="input !w-auto !py-1 text-xs" value={t.status} onChange={(e) => setTaskStatus(t, e.target.value)}>
                      <option value="PENDING">Pending</option>
                      <option value="IN_PROGRESS">In progress</option>
                      <option value="DONE">Done</option>
                    </select>
                  </td>
                  <td>
                    <button className="btn-ghost btn-sm text-rose-600" onClick={() => remove(t)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assign && (
        <AssignModal
          emps={(emps.data || []).filter((e) => e.active)}
          onClose={() => setAssign(false)}
          onSaved={() => {
            setAssign(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AssignModal({ emps, onClose, onSaved }: { emps: Employee[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: "", description: "", priority: "MEDIUM", dueDate: "" });
  const [sel, setSel] = useState<string[]>([]);
  async function save() {
    if (await act(() => api("/api/hr/tasks", { body: { ...f, assignedTo: sel } }), `Task assigned to ${sel.length} employee(s)`)) onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Assign task">
      <div className="space-y-3">
        <Field label="Title *">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="input min-h-[80px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" className="input" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label !mb-0">Assign to *</span>
            <button type="button" className="text-xs font-semibold text-brand-600" onClick={() => setSel(sel.length === emps.length ? [] : emps.map((e) => e.id))}>
              {sel.length === emps.length ? "Clear" : "Select all"}
            </button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {emps.length === 0 && <p className="p-2 text-sm text-slate-500">No active employees.</p>}
            {emps.map((e) => (
              <label key={e.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={sel.includes(e.id)} onChange={(ev) => setSel(ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} />
                {e.name} <span className="text-xs text-slate-400">{e.empCode}</span>
              </label>
            ))}
          </div>
        </div>
        <button className="btn-primary w-full" onClick={save} disabled={!f.title.trim() || !sel.length}>
          Assign
        </button>
      </div>
    </Modal>
  );
}
