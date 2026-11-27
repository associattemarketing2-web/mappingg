// `npm run dev`: the Next.js dev server, plus the WhatsApp gateway (gateway/)
// when .env points WA_GATEWAY_URL at this computer (http://localhost:<port>), so
// s-admin → WhatsApp Inbox works locally with no second terminal. The gateway
// takes over from any other running copy (WA_GATEWAY_TAKEOVER=1): only one may
// hold the WhatsApp logins, and the one on this computer is the one in use.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { gatewayMissing, loadEnv, root, startGateway } from './gateway-process.mjs';

const env = loadEnv();
let stopGateway = () => undefined;

const local = (() => {
  try {
    const u = new URL(env.WA_GATEWAY_URL || '');
    return ['localhost', '127.0.0.1'].includes(u.hostname) ? u : null;
  } catch { return null; }
})();

const missing = gatewayMissing(env);
if (local && missing) {
  console.log(`[dev] WhatsApp gateway not started: ${missing} in .env`);
} else if (local) {
  stopGateway = startGateway({ port: Number(local.port || 80), takeover: true });
}

const next = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  stopGateway();
  next.kill('SIGINT');
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
next.on('exit', (code) => { stop(); process.exitCode = code ?? 0; });
