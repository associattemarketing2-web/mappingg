// Shared helpers for the SEO audit scripts (scripts/seo-audit/*). No dependencies
// beyond node-html-parser (already a devDependency) and Node built-ins.

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const REPORT_ROOT = path.resolve('reports/seo-audit');

export function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
}

/**
 * Output folder for this run: reports/seo-audit/<date>[-<label>]. Pass --out to
 * reuse a folder (the projects/summary steps write next to the crawl).
 */
export async function outDir(defaultLabel) {
  const explicit = arg('out');
  if (explicit) {
    const dir = path.resolve(String(explicit));
    await mkdir(dir, { recursive: true });
    return dir;
  }
  // UTC date, so folder names sort the same on every machine.
  const date = new Date().toISOString().slice(0, 10);
  const label = arg('label') || defaultLabel;
  const dir = path.join(REPORT_ROOT, label ? `${date}-${label}` : date);
  await mkdir(dir, { recursive: true });
  return dir;
}

const LAST_RUN = path.join(REPORT_ROOT, '.last-run');

/** Remember the folder the crawl wrote to, so later steps write next to it. */
export async function markLastRun(dir) {
  await writeFile(LAST_RUN, dir, 'utf8');
}

/** The last crawl's folder (or the newest folder) — for steps that read the crawl output. */
export async function latestDir() {
  const last = await readFile(LAST_RUN, 'utf8').catch(() => '');
  if (last.trim()) return last.trim();
  const names = (await readdir(REPORT_ROOT, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return names.length ? path.join(REPORT_ROOT, names[names.length - 1]) : null;
}

const cell = (v) => {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function writeCsv(file, rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  // BOM so Excel opens UTF-8 (₹, —) correctly.
  await writeFile(file, '﻿' + body + '\n', 'utf8');
}

export async function writeJson(file, data) {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
