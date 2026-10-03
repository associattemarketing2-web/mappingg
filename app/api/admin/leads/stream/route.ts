import { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-Sent Events stream for the Leads/CRM panel. Rather than a WebSocket or
// Postgres LISTEN/NOTIFY (operational overhead this app doesn't need), the
// server polls a cheap "signature" of the contact_leads table every few seconds
// and pushes a `changed` event when it moves. The client then refetches the
// authoritative list — so there are never duplicate records or notifications,
// and EventSource's built-in auto-reconnect handles dropped connections.
const POLL_MS = 5000;
const HEARTBEAT_MS = 25000; // keep intermediaries from closing an idle stream

async function signature(): Promise<string> {
  const db = await getDb();
  const coll = db.collection('contact_leads');
  const count = await coll.countDocuments({});
  const latest = await coll.find({}, { projection: { created_at: 1, updated_at: 1 } })
    .sort({ updated_at: -1 }).limit(1).toArray();
  const row = latest[0] as { updated_at?: unknown; created_at?: unknown } | undefined;
  return `${count}:${String(row?.updated_at || row?.created_at || '')}`;
}

export async function GET(req: NextRequest) {
  if (!(await hasPermission('leads'))) {
    return new Response('Not authorized', { status: 401 });
  }

  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      let last = '';
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
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
    },
    cancel() {
      if (poll) clearInterval(poll);
      if (beat) clearInterval(beat);
    },
  });

  // Clear timers if the request is aborted (tab closed / navigated away).
  req.signal.addEventListener('abort', () => {
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
