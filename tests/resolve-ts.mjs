// Lets `node --test` import the app's TypeScript modules the way Next.js does:
// extensionless relative imports ("./phone") and the "@/…" alias.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const EXTS = ['.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith('@/')) base = new URL(specifier.slice(2), ROOT);
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) base = new URL(specifier, context.parentURL);
  if (base && !/\.[cm]?[jt]sx?$/.test(base.pathname)) {
    for (const ext of EXTS) {
      const url = new URL(base.href + ext);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
  }
  if (base && specifier.startsWith('@/')) return next(base.href, context);
  // App modules use React's server-only cache(); see tests/shims/react-server.mjs.
  if (specifier === 'react' && context.parentURL && !context.parentURL.includes('/node_modules/') && !context.parentURL.includes('/tests/shims/')) {
    return next(new URL('tests/shims/react-server.mjs', ROOT).href, context);
  }
  // next@14 has no "exports" map, so Node's ESM resolver needs the file name ("next/server" → "next/server.js").
  if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
  return next(specifier, context);
}
