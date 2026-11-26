"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import InstallButton from "./InstallButton";
import { api } from "./ui";

type Item = { href: string; label: string; icon: string };

export default function Shell({ items, role, children }: { items: Item[]; role: "ADMIN" | "EMPLOYEE"; children: React.ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<{ name: string; empCode: string; designation?: string } | null>(null);
  const [company, setCompany] = useState("EMS");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<{ user: { name: string; empCode: string; designation?: string }; settings: { companyName: string } }>("/api/hr/me")
      .then((d) => {
        setMe(d.user);
        setCompany(d.settings.companyName);
      })
      .catch(() => {});
  }, []);

  useEffect(() => setOpen(false), [path]);

  const active = (href: string) => (href === `/dashboard/hr/${role === "ADMIN" ? "admin" : "employee"}` ? path === href : path.startsWith(href));

  async function logout() {
    // Signs out of Mappingg (the HR module has no separate login).
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  const nav = (
    <nav className="space-y-1">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active(i.href) ? "bg-brand-600 text-white shadow" : "text-slate-600 hover:bg-slate-100"}`}
        >
          <span className="text-lg">{i.icon}</span>
          {i.label}
        </Link>
      ))}
    </nav>
  );

  const userBox = (
    <div className="space-y-2 border-t border-slate-200 pt-4">
      {me && (
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">{me.name[0]?.toUpperCase()}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{me.name}</div>
            <div className="truncate text-xs text-slate-500">{role === "ADMIN" ? "Super Admin" : `${me.empCode}${me.designation ? " · " + me.designation : ""}`}</div>
          </div>
        </div>
      )}
      {/* full page load: leaves the HR styles behind */}
      <a href="/dashboard/s-admin" className="btn-ghost w-full">
        ← Back to Mappingg
      </a>
      <InstallButton className="btn-ghost w-full" />
      <button onClick={logout} className="btn-ghost w-full text-rose-600">
        ⎋ Logout
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 print:!hidden shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4 lg:flex">
        <div>
          <div className="mb-6 flex items-center gap-2 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg text-white">⏱</div>
            <div>
              <div className="text-sm font-bold leading-tight">{company}</div>
              <div className="text-xs text-slate-500">{role === "ADMIN" ? "Admin Panel" : "Employee"}</div>
            </div>
          </div>
          {nav}
        </div>
        {userBox}
      </aside>

      {/* mobile top bar */}
      <header className="print:hidden sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">⏱</div>
          <span className="font-bold">{company}</span>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-2xl leading-none" aria-label="menu">
          ☰
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="flex h-full w-72 flex-col justify-between bg-white p-4" onClick={(e) => e.stopPropagation()}>
            {nav}
            {userBox}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 p-4 pb-24 sm:p-6 lg:pb-6 print:p-0">{children}</main>

      {/* mobile bottom nav for employees */}
      {role === "EMPLOYEE" && (
        <nav className="print:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {items.slice(0, 5).map((i) => (
            <Link key={i.href} href={i.href} className={`flex flex-col items-center py-2 text-[11px] font-medium ${active(i.href) ? "text-brand-600" : "text-slate-500"}`}>
              <span className="text-xl">{i.icon}</span>
              {i.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
