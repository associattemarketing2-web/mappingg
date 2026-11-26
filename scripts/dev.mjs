// `npm run dev`: the Next.js dev server, plus the WhatsApp gateway (wa-gateway/)
// when .env points WA_GATEWAY_URL at this computer (http://localhost:<port>), so
// s-admin → WhatsApp Inbox works locally with no second terminal. The gateway
// takes over from any other running copy (WA_GATEWAY_TAKEOVER=1): only one may
// hold the WhatsApp logins, and the one on this computer is the one in use.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const gwDir = path.join(root, 'wa-gateway');
const win = process.platform === 'win32';

function envFile() {
  try {
    return Object.fromEntries(readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  } catch { return {}; }
}

const env = { ...envFile(), ...process.env };
const children = [];
let stopping = false;

const local = (() => {
  try {
    const u = new URL(env.WA_GATEWAY_URL || '');
    return ['localhost', '127.0.0.1'].includes(u.hostname) ? u : null;
  } catch { return null; }
})();

if (local && env.WA_GATEWAY_SECRET && env.WA_GATEWAY_KEY) {
  if (!existsSync(path.join(gwDir, 'node_modules'))) {
    console.log('[dev] installing the WhatsApp gateway…');
    spawnSync(win ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: gwDir, stdio: 'inherit', shell: win });
  }
  const port = local.port || '80';
  const start = () => {
    const gw = spawn(process.execPath, ['--env-file=../.env', '--dns-result-order=ipv4first', 'src/server.js'], {
      cwd: gwDir, stdio: 'inherit', env: { ...process.env, WA_GATEWAY_PORT: port, WA_GATEWAY_TAKEOVER: '1' },
    });
    children.push(gw);
    gw.on('exit', (code) => {
      if (stopping) return;
      console.log(`[dev] WhatsApp gateway stopped (code ${code}) — restarting in 5 s`);
      setTimeout(start, 5000);
    });
  };
  console.log(`[dev] starting the WhatsApp gateway on :${port}`);
  start();
} else if (local) {
  console.log('[dev] WhatsApp gateway not started: set WA_GATEWAY_SECRET and WA_GATEWAY_KEY in .env');
}

const next = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
children.push(next);

const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGINT');
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
next.on('exit', (code) => { stop(); process.exitCode = code ?? 0; });
