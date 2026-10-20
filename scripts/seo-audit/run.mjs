// npm run seo:audit [-- --base=http://localhost:3000 --label=local --compare=reports/seo-audit/<baseline>]
//
// Runs the three audit steps in order, passing the same options to each:
//   1. crawl.mjs     live HTTP + HTML checks of every discoverable URL
//   2. projects.mts  read-only DB report: every project, keyword map, blog content
//   3. summary.mjs   SEO-AUDIT-SUMMARY.md (+ before/after table with --compare)

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const steps = [
  ['node', ['scripts/seo-audit/crawl.mjs', ...args]],
  ['node', ['--experimental-transform-types', '--no-warnings', '--import', './tests/register.mjs', 'scripts/seo-audit/projects.mts', ...args.filter((a) => !a.startsWith('--out'))]],
  ['node', ['scripts/seo-audit/summary.mjs', ...args.filter((a) => !a.startsWith('--out'))]],
];
for (const [cmd, argv] of steps) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[seo-audit] step failed: ${argv[argv.findIndex((a) => a.startsWith('scripts/'))]}`);
    process.exit(r.status || 1);
  }
}
