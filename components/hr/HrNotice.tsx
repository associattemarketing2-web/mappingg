/** Shown to a Mappingg employee who has no HR record yet, or whose HR access is disabled. */
export default function HrNotice({ kind }: { kind: 'no-profile' | 'disabled' }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-white">⏱</div>
        <h1 className="page-title">HR & Attendance</h1>
        <p className="text-sm text-slate-600">
          {kind === 'disabled'
            ? 'Your HR access is disabled. Please contact the admin.'
            : 'Your HR profile is not set up yet. Ask the admin to add you in HR → Employees with this same email.'}
        </p>
        <a href="/dashboard/s-admin" className="btn-ghost w-full">
          ← Back to Mappingg
        </a>
      </div>
    </div>
  );
}
