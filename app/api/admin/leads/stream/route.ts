import { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Serverless hosts (Vercel) stop a function after maxDuration seconds. The
// stream ends itself a little before that (STREAM_MS) so it closes cleanly
// instead of timing out; EventSource then reconnects on its own.
export const maxDuration = 300;
const STREAM_MS = 280_000;

// Server-Sent Events stream for the Leads/CRM panel. Rather than a WebSocket or
// Postgres LISTEN/NOTIFY (operational overhead this app doesn't need), the
// server polls a cheap "signature" of the lead tables every few seconds
// and pushes a `changed` event when it moves. The client then refetches the
// authoritative list — so there are never duplicate records or notifications,
// and EventSource's built-in auto-reconnect handles dropped connections.
const POLL_MS = 5000;
const HEARTBEAT_MS = 25000; // keep intermediaries from closing an idle stream

// Covers both lead sources: contact-form leads and map "Enquire" requests.
async function tableSignature(name: string): Promise<string> {
  const db = await getDb();
  const coll = db.collection(name);
  const count = await coll.countDocuments({});
  const latest = await coll.find({}, { projection: { created_at: 1, updated_at: 1 } })
    .sort({ updated_at: -1 }).limit(1).toArray();
  const row = latest[0] as { updated_at?: unknown; created_at?: unknown } | undefined;
  return `${count}:${String(row?.updated_at || row?.created_at || '')}`;
}

async function signature(): Promise<string> {
  const [contact, map] = await Promise.all([tableSignature('contact_leads'), tableSignature('leads')]);
  return `${contact}|${map}`;
}

export async function GET(req: NextRequest) {
  if (!(await hasPermission('leads'))) {
    return new Response('Not authorized', { status: 401 });
  }

  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let end: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
    if (end) clearTimeout(end);
  };

  const stream = new ReadableStream({
    async start(controller) {
      let last = '';
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ }
      };

      try { last = await signature(); } catch { /* first tick will retry */ }
      send('ready', { ts: Date.now() });

      poll = setInterval(async () => {
        try {
          const sig = await signature();
          if (sig !== last) { last = sig; send('changed', { ts: Date.now() }); }
        } catch { /* transient DB hiccup — keep the stream open, retry next tick */ }
      }, POLL_MS);

      beat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { /* closed */ }
      }, HEARTBEAT_MS);

      // End before the host's time limit; the browser reconnects by itself.
      end = setTimeout(() => {
        stop();
        try { controller.close(); } catch { /* already closed */ }
      }, STREAM_MS);
    },
    cancel() {
      stop();
    },
  });

  // Clear timers if the request is aborted (tab closed / navigated away).
  req.signal.addEventListener('abort', stop);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
