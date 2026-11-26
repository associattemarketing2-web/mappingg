"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// The HR pages are shown inside the s-admin "HR & Attendance" tab (iframe), which
// draws the header and the sub-tabs (components/hr/nav.ts). This shell only keeps
// the tab in step: it reports the current page, and opens the page a sub-tab asks
// for. Opened on its own, a page goes to that tab instead, so HR always lives
// inside the dashboard.
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    let inFrame = true;
    try { inFrame = window.self !== window.top; } catch { /* cross-origin parent — treat as framed */ }
    if (!inFrame) window.location.replace(`/dashboard/s-admin?tab=hr&hrp=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, []);

  useEffect(() => {
    const qs = search?.toString();
    window.parent?.postMessage({ type: "hr:nav", path: path + (qs ? `?${qs}` : "") }, window.location.origin);
  }, [path, search]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "hr:go" || typeof e.data.href !== "string") return;
      if (e.data.href.startsWith("/dashboard/hr")) router.push(e.data.href);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [router]);

  return <main className="hr-main min-w-0 px-1 pb-8 pt-1 print:p-0">{children}</main>;
}
