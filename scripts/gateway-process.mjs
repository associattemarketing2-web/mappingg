// Runs the WhatsApp gateway (gateway/server.mjs) as a child process next to the
// website, restarting it if it stops. Used by `npm run dev` and `npm run start`.
// The gateway listens on 127.0.0.1:<WA_GATEWAY_PORT> — only the site on the same
// server talks to it, so it needs no public URL.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** .env values (if the file exists), overridden by the real environment. */
export function loadEnv() {
  let file = {};
  try {
    file = Object.fromEntries(readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  } catch { /* no .env on the server: the host's environment variables are used */ }
  return { ...file, ...process.env };
}

/** Why the gateway can't start with this env, or null when it can. */
export function gatewayMissing(env) {
  const missing = ['DATABASE_URL', 'WA_GATEWAY_SECRET', 'WA_GATEWAY_KEY'].filter((k) => !env[k]);
  return missing.length ? `set ${missing.join(', ')}` : null;
}

/** Starts the gateway; returns a stop() function. */
export function startGateway({ port, takeover = false }) {
  let stopping = false;
  let child = null;
  const run = () => {
    child = spawn(process.execPath, ['--env-file-if-exists=.env', '--dns-result-order=ipv4first', 'gateway/server.mjs'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, WA_GATEWAY_PORT: String(port), ...(takeover ? { WA_GATEWAY_TAKEOVER: '1' } : {}) },
    });
    child.on('exit', (code) => {
      if (stopping) return;
      console.log(`[gateway] stopped (code ${code}) — restarting in 5 s`);
      setTimeout(run, 5000);
    });
  };
  console.log(`[gateway] starting the WhatsApp gateway on 127.0.0.1:${port}`);
  run();
  return () => { stopping = true; child?.kill('SIGTERM'); };
}
