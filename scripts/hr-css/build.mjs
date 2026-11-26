// Compiles the HR module's Tailwind stylesheet → app/dashboard/hr/hr.css.
// Uses the Tailwind CLI via npx (no Tailwind dependency in Mappingg itself):
//   node scripts/hr-css/build.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const out = path.join(root, 'app', 'dashboard', 'hr', 'hr.css');
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', 'tailwindcss@3.4.17', '-c', path.join(here, 'tailwind.config.cjs'), '-i', path.join(here, 'input.css'), '-o', out, '--minify'],
  { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' },
);
console.log('HR stylesheet written to', path.relative(root, out));
