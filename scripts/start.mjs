// `npm run start` (production): the Next.js server on $PORT, plus the WhatsApp
// gateway on 127.0.0.1:$WA_GATEWAY_PORT (default 8099) in the same deploy. Needs
// an always-on host (Render paid plan / VPS) — on a sleeping or serverless host
// the WhatsApp connections drop.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { gatewayMissing, loadEnv, root, startGateway } from './gateway-process.mjs';

const env = loadEnv();
const port = Number(env.WA_GATEWAY_PORT || 8099);
let stopGateway = () => undefined;
const nextEnv = { ...process.env };

const missing = gatewayMissing(env);
if (missing) {
  console.log(`[start] WhatsApp gateway not started: ${missing}`);
} else {
  stopGateway = startGateway({ port });
  nextEnv.WA_GATEWAY_URL = `http://127.0.0.1:${port}`; // the site calls the gateway on this server
}

const next = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '0.0.0.0', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: nextEnv,
});

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  stopGateway();
  next.kill(signal);
  setTimeout(() => process.exit(0), 8000).unref(); // the gateway closes its sockets and frees the lease
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
next.on('exit', (code) => { stop('SIGTERM'); process.exitCode = code ?? 0; });
