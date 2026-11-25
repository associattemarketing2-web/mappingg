import { randomUUID } from 'node:crypto';
import { getDb, usingMongo } from './mongodb';
import { query } from './pg';
import { chats, waDigits } from './wa-store';
import { fallbackPayload, payloadSummary, whatsappProvider, whatsappSend, type WaPayload } from './whatsapp';

// Send & schedule (s-admin → WhatsApp). One schedule = a list of numbers + one
// or more messages, each with its own timing:
//   now                      → goes out at once (the panel drives it and shows progress)
//   at   [t1, t2, …]         → the same message at each chosen date-time
//   repeat start/every/count → e.g. every 1 hour, 5 times, from 10:00
// Every (message × time) is a "run". Due runs are sent by processDue(), called
// from: the panel (send-now progress + every refresh), the WhatsApp webhook
// (every incoming message / delivery update), and /api/whatsapp/cron (an
// external every-minute pinger, for exact timing when nobody is around).
// Sending is resumable: each run keeps a cursor, so a big list is finished over
// several calls; a lock stops two calls sending the same run twice.

export type Timing =
  | { mode: 'now' }
  | { mode: 'at'; times: string[] }
  | { mode: 'repeat'; start: string; every: number; unit: 'minutes' | 'hours' | 'days'; count: number };

export interface WaRun {
  id: string; at: string; msg: number;
  status: 'pending' | 'running' | 'done' | 'cancelled';
  cursor: number; sent: number; failed: number; skipped: number;
  started_at?: string; done_at?: string; last_error?: string;
}

export interface WaSchedule {
  id: string; title: string;
  messages: { payload: WaPayload; timing: Timing }[];
  recipients: { phone: string; name: string }[];
  runs: WaRun[];
  status: 'active' | 'done' | 'cancelled';
  lock: string; lock_until: string;
  created_by?: string; created_at: string; updated_at: string;
}

export const MAX_RUNS = 200;
export const MAX_RECIPIENTS = 20_000;
const BATCH = 25;
const PARALLEL = 5;
const LOCK_MS = 90_000;
const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

/** The date-times a timing stands for (ISO, ascending). Throws a readable error for bad input. */
export function expandTiming(t: Timing, now = Date.now()): string[] {
  const iso = (v: string) => { const ms = Date.parse(v); if (!Number.isFinite(ms)) throw new Error(`Invalid date/time: ${v}`); return ms; };
  if (t.mode === 'now') return [new Date(now).toISOString()];
  if (t.mode === 'at') {
    const list = [...new Set(t.times.map(iso))].sort((a, b) => a - b);
    if (!list.length) throw new Error('Pick at least one date & time');
    if (list[0] < now - 5 * 60_000) throw new Error('One of the chosen times is already in the past');
    if (list.length > MAX_RUNS) throw new Error(`At most ${MAX_RUNS} times`);
    return list.map((ms) => new Date(ms).toISOString());
  }
  const start = iso(t.start);
  if (start < now - 5 * 60_000) throw new Error('The start time is already in the past');
  const step = t.every * UNIT_MS[t.unit];
  if (!Number.isFinite(step) || step < 5 * 60_000) throw new Error('Repeat at most every 5 minutes');
  if (!Number.isInteger(t.count) || t.count < 1 || t.count > MAX_RUNS) throw new Error(`Repeat between 1 and ${MAX_RUNS} times`);
  return Array.from({ length: t.count }, (_, i) => new Date(start + i * step).toISOString());
}

/** All runs of a schedule, in time order. */
export function buildRuns(messages: WaSchedule['messages'], now = Date.now()): WaRun[] {
  const runs = messages.flatMap((m, msg) => expandTiming(m.timing, now).map((at) => ({
    id: randomUUID().slice(0, 12), at, msg, status: 'pending' as const, cursor: 0, sent: 0, failed: 0, skipped: 0,
  })));
  if (runs.length > MAX_RUNS) throw new Error(`Too many sends (${runs.length}); at most ${MAX_RUNS} per schedule`);
  // Same moment: keep the order the messages were written in.
  return runs.sort((a, b) => a.at.localeCompare(b.at) || a.msg - b.msg);
}

let ready: Promise<void> | null = null;
export async function schedules() {
  if (!usingMongo()) {
    ready ??= query(`CREATE TABLE IF NOT EXISTS "wa_schedules" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);`)
      .then(() => undefined).catch((e) => { ready = null; throw e; });
    await ready;
  }
  return (await getDb()).collection<WaSchedule & { _id: string }>('wa_schedules');
}

export async function createSchedule(input: { title: string; messages: WaSchedule['messages']; recipients: { phone: string; name?: string }[]; by?: string }): Promise<WaSchedule> {
  const seen = new Set<string>();
  const recipients = input.recipients
    .map((r) => ({ phone: waDigits(r.phone), name: String(r.name || '').trim().slice(0, 80) }))
    .filter((r) => r.phone.length >= 11 && !seen.has(r.phone) && seen.add(r.phone));
  if (!recipients.length) throw new Error('Add at least one valid number');
  if (recipients.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS.toLocaleString('en-IN')} numbers per schedule`);
  if (!input.messages.length) throw new Error('Add a message');
  const now = new Date().toISOString();
  const s: WaSchedule = {
    id: randomUUID(), title: input.title.trim().slice(0, 120) || payloadSummary(input.messages[0].payload).slice(0, 80),
    messages: input.messages, recipients, runs: buildRuns(input.messages), status: 'active',
    lock: '', lock_until: '', created_by: input.by, created_at: now, updated_at: now,
  };
  await (await schedules()).insertOne({ _id: s.id, ...s });
  return s;
}

/** Cancels a whole schedule, or one run of it. Runs already sent stay sent. */
export async function cancelSchedule(id: string, runId?: string): Promise<boolean> {
  const col = await schedules();
  const s = await col.findOne({ _id: id });
  if (!s) return false;
  const runs = s.runs.map((r) => ((!runId || r.id === runId) && (r.status === 'pending' || r.status === 'running') ? { ...r, status: 'cancelled' as const } : r));
  const open = runs.some((r) => r.status === 'pending' || r.status === 'running');
  await col.updateOne({ _id: id }, { $set: { runs, status: open ? s.status : (runs.some((r) => r.status === 'done') ? 'done' : 'cancelled'), updated_at: new Date().toISOString() } });
  return true;
}

export type SendOutcome = { phone: string; ok: boolean; error?: string };
const isDue = (r: WaRun, now: number) => (r.status === 'pending' || r.status === 'running') && Date.parse(r.at) <= now;

/**
 * Sends whatever is due, within `budgetMs`. `onlyId` limits it to one schedule (send-now progress in the panel).
 * Resolves the per-number outcomes of what it sent (for the panel), never throws.
 */
export async function processDue(opts: { budgetMs?: number; onlyId?: string } = {}): Promise<{ results: SendOutcome[]; pending: boolean }> {
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  const results: SendOutcome[] = [];
  let pending = false;
  try {
    const col = await schedules();
    const list = opts.onlyId ? [await col.findOne({ _id: opts.onlyId })].filter(Boolean) as WaSchedule[] : await col.find({ status: 'active' }).toArray();
    const due = list.filter((s) => s.status === 'active' && s.runs.some((r) => isDue(r, Date.now())))
      .sort((a, b) => (a.runs.find((r) => isDue(r, Date.now()))?.at || '').localeCompare(b.runs.find((r) => isDue(r, Date.now()))?.at || ''));
    for (const s of due) {
      if (Date.now() > deadline - 5_000) { pending = true; break; }
      // Lock: only one caller sends a schedule at a time (compare-and-set on the lock token).
      if (s.lock_until && Date.parse(s.lock_until) > Date.now()) { pending = true; continue; }
      const token = randomUUID();
      const claimed = await col.updateOne({ _id: s.id, lock: s.lock }, { $set: { lock: token, lock_until: new Date(Date.now() + LOCK_MS).toISOString() } });
      if (!claimed.matchedCount) { pending = true; continue; }
      try {
        pending = (await sendSchedule(s.id, deadline, results)) || pending;
      } finally {
        await col.updateOne({ _id: s.id, lock: token }, { $set: { lock: '', lock_until: '' } });
      }
    }
  } catch (e) {
    console.error('[wa-schedule] processDue failed', (e as Error).message);
  }
  return { results, pending };
}

/** Sends the due runs of one (locked) schedule until the deadline. True when something due is left. */
async function sendSchedule(id: string, deadline: number, results: SendOutcome[]): Promise<boolean> {
  const col = await schedules();
  const fresh = async () => (await col.findOne({ _id: id })) as WaSchedule | null;
  let s = await fresh();
  if (!s) return false;
  const recipients = s.recipients;
  const runIds = s.runs.filter((r) => isDue(r, Date.now())).map((r) => r.id);

  for (const runId of runIds) {
    for (;;) {
      s = await fresh();
      const run = s?.runs.find((r) => r.id === runId);
      if (!s || !run || run.status === 'cancelled' || run.status === 'done') break;
      if (Date.now() > deadline - 8_000) return true;
      const payload = s.messages[run.msg]?.payload;
      const batch = recipients.slice(run.cursor, run.cursor + BATCH);
      const outcomes: SendOutcome[] = [];
      let skipped = 0;
      if (payload && batch.length) {
        // A typed message / file only reaches people who wrote in the last 24 hours (WhatsApp rule);
        // whatapi.in would answer "queued" and WhatsApp drops it silently. Those numbers get the message's
        // fallback template instead, or are skipped when it has none.
        let queue: { phone: string; name: string; p: WaPayload }[] = batch.map((r) => ({ ...r, p: payload }));
        if (payload.kind !== 'template' && whatsappProvider() === 'meta') {
          const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
          const open = new Set((await (await chats()).find({ _id: { $in: batch.map((r) => r.phone) } }, { projection: { last_in_at: 1 } }).toArray())
            .filter((c) => c.last_in_at && c.last_in_at >= since).map((c) => String(c._id)));
          const fb = fallbackPayload(payload);
          queue = batch.flatMap((r) => (open.has(r.phone) ? [{ ...r, p: payload }] : fb ? [{ ...r, p: fb }] : []));
          for (const r of batch) if (!open.has(r.phone) && !fb) outcomes.push({ phone: r.phone, ok: false, error: 'Skipped: no message from this number in the last 24 hours — WhatsApp only allows templates then. Pick a template under "Not messaged in 24 h".' });
          skipped = batch.length - queue.length;
        }
        const work = [...queue];
        await Promise.all(Array.from({ length: PARALLEL }, async () => {
          for (let r = work.shift(); r; r = work.shift()) {
            const res = await whatsappSend(r.phone, r.name || undefined, r.p, { author: 'staff', by: s!.created_by, campaign: run.id });
            outcomes.push({ phone: r.phone, ok: res.ok, ...(res.ok ? {} : { error: res.error || 'Not sent' }) });
          }
        }));
      }
      results.push(...outcomes);
      // Save only this run's progress onto the latest copy (a cancel may have happened meanwhile).
      const latest = await fresh();
      if (!latest) return false;
      const sent = outcomes.filter((o) => o.ok).length;
      const failed = outcomes.length - sent - skipped;
      const now = new Date().toISOString();
      const runs = latest.runs.map((r) => {
        if (r.id !== runId) return r;
        const cursor = r.cursor + batch.length;
        const finished = cursor >= recipients.length || !payload;
        return {
          ...r, cursor, sent: r.sent + sent, failed: r.failed + failed, skipped: r.skipped + skipped,
          status: r.status === 'cancelled' ? r.status : finished ? 'done' as const : 'running' as const,
          started_at: r.started_at || now, ...(finished ? { done_at: now } : {}),
          ...(failed ? { last_error: outcomes.find((o) => !o.ok && !o.error?.startsWith('Skipped'))?.error?.slice(0, 300) } : {}),
        };
      });
      const open = runs.some((r) => r.status === 'pending' || r.status === 'running');
      await col.updateOne({ _id: id }, { $set: { runs, status: open ? latest.status : 'done', updated_at: now } });
      // Every number of a full batch failed with the same provider error (e.g. account blocked): stop this run.
      const errs = new Set(outcomes.filter((o) => !o.ok && !o.error?.startsWith('Skipped')).map((o) => o.error));
      if (sent === 0 && failed === batch.length && batch.length > 1 && errs.size === 1) {
        await cancelSchedule(id, runId);
        break;
      }
    }
  }
  s = await fresh();
  return Boolean(s?.runs.some((r) => isDue(r, Date.now())));
}

/** List row for the panel (no recipient list). */
export function scheduleRow(s: WaSchedule) {
  return {
    id: s.id, title: s.title, status: s.status, created_by: s.created_by || '', created_at: s.created_at, numbers: s.recipients.length,
    messages: s.messages.map((m) => ({ kind: m.payload.kind, summary: payloadSummary(m.payload).slice(0, 200), timing: m.timing })),
    runs: s.runs.map((r) => ({ ...r, total: s.recipients.length, summary: payloadSummary(s.messages[r.msg]?.payload || { kind: 'text' }).slice(0, 120) })),
    next_at: s.runs.find((r) => r.status === 'pending' || r.status === 'running')?.at || null,
  };
}
