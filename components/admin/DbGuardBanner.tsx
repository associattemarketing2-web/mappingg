'use client';

import { useEffect, useState } from 'react';

type Alert = { id: string; at: string; source: string; kind: string; detail: string };

const TITLES: Record<string, string> = {
  blocked: 'A risky database change was BLOCKED (nothing was changed)',
  allowed: 'A risky database change was run with DB_ALLOW_DESTRUCTIVE=1',
  'check-failed': 'Data check failed: tables, columns or rows are missing',
  'migration-rolled-back': 'A schema change was ROLLED BACK because it would have lost data',
  'missing-table': 'A table the site uses is missing, so its data is not showing',
};

// Red banner at the top of s-admin when the database guard has something to report.
export default function DbGuardBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/admin/db-guard', { credentials: 'same-origin' })
      .then((r) => r.json()).then((j) => { if (alive) setAlerts(Array.isArray(j?.data) ? j.data : []); })
      .catch(() => undefined);
    void load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!alerts.length) return null;
  const dismiss = () => {
    void fetch('/api/admin/db-guard', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: 1 }) });
    setAlerts([]);
  };

  return (
    <div role="alert" style={{ background: '#b91c1c', color: '#fff', padding: '10px 16px', fontSize: 14, lineHeight: 1.45, position: 'relative', zIndex: 50 }}>
      <strong>⛔ Database alert:</strong> {TITLES[alerts[0].kind] || alerts[0].kind}
      {alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ''}{' '}
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ color: '#fff', textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>
        {open ? 'Hide details' : 'Details'}
      </button>{' · '}
      <button type="button" onClick={dismiss} style={{ color: '#fff', textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>
        Mark as seen
      </button>
      {open && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {alerts.map((a) => (
            <li key={a.id} style={{ marginBottom: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <b>{new Date(a.at).toLocaleString()}</b> · {TITLES[a.kind] || a.kind} ({a.source})<br />{a.detail}
            </li>
          ))}
          <li style={{ listStyle: 'none', marginTop: 6 }}>Run <code>npm run db:check</code> for the full report. Restore from a backup in migration/backup/pg-export-* if data is really gone.</li>
        </ul>
      )}
    </div>
  );
}
