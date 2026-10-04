// -----------------------------------------------------------------------------
// Project image migration: Base64-in-Postgres  ->  object storage / CDN.
//
// SAFE BY DESIGN:
//   * Never deletes the original base64 `image` — it stays as a fallback until
//     you remove it in a later, explicit step.
//   * Resumable: a pin whose image_meta.status === 'completed' is skipped.
//   * One pin at a time — base64 blobs are never all loaded into memory at once.
//   * Verifies each upload (HEAD) before marking the pin completed.
//   * On a per-pin error it records status 'failed' and CONTINUES.
//
// USAGE:
//   npm run migrate:project-images -- --dry-run     # decode/resize/report only
//   npm run migrate:project-images                  # real upload + DB write
//   npm run migrate:project-images -- --force       # re-migrate completed pins
//   npm run migrate:project-images -- --limit 10    # first N pins only
//
// Real mode REQUIRES object-storage env vars (see .env.example). If they are
// missing it STOPS before any change and prints exactly what to set.
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// --- args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity;
})();

// --- env (load .env.local without a dependency) ---
function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env.local optional in CI */ }
}
loadEnv();

const STORAGE = {
  provider: process.env.IMAGE_STORAGE_PROVIDER || '',
  bucket: process.env.IMAGE_STORAGE_BUCKET || '',
  region: process.env.IMAGE_STORAGE_REGION || '',
  endpoint: process.env.IMAGE_STORAGE_ENDPOINT || '',
  accessKey: process.env.IMAGE_STORAGE_ACCESS_KEY || '',
  secretKey: process.env.IMAGE_STORAGE_SECRET_KEY || '',
  cdnBase: (process.env.IMAGE_CDN_BASE_URL || '').replace(/\/$/, ''),
};

function storageConfigured() {
  if (STORAGE.provider === 's3') {
    return !!(STORAGE.bucket && STORAGE.accessKey && STORAGE.secretKey && STORAGE.cdnBase);
  }
  if (STORAGE.provider === 'vercel-blob') {
    return !!(process.env.BLOB_READ_WRITE_TOKEN && STORAGE.cdnBase);
  }
  return false;
}

function requireStorageOrStop() {
  if (storageConfigured()) return;
  console.error('\n⛔  Object storage is NOT configured — stopping before any change.\n');
  console.error('Set these in .env.local (see .env.example), then re-run:\n');
  console.error('  IMAGE_STORAGE_PROVIDER = "s3"   (AWS S3 / Cloudflare R2 / DO Spaces / MinIO)');
  console.error('  IMAGE_STORAGE_BUCKET');
  console.error('  IMAGE_STORAGE_REGION      (e.g. "auto" for R2, "ap-south-1" for S3)');
  console.error('  IMAGE_STORAGE_ENDPOINT    (S3-compatible endpoint)');
  console.error('  IMAGE_STORAGE_ACCESS_KEY');
  console.error('  IMAGE_STORAGE_SECRET_KEY');
  console.error('  IMAGE_CDN_BASE_URL        (public URL images serve from)\n');
  console.error('Or run a dry run first (no creds needed):  npm run migrate:project-images -- --dry-run\n');
  process.exit(2);
}

// --- storage client (lazy; only touched in real mode) ---
let s3 = null;
async function getS3() {
  if (s3) return s3;
  let mod;
  try {
    mod = require('@aws-sdk/client-s3');
  } catch {
    console.error('\n⛔  @aws-sdk/client-s3 is not installed. Install it:\n    npm i @aws-sdk/client-s3\n');
    process.exit(2);
  }
  const { S3Client } = mod;
  s3 = {
    client: new S3Client({
      region: STORAGE.region || 'auto',
      endpoint: STORAGE.endpoint || undefined,
      forcePathStyle: !!STORAGE.endpoint,
      credentials: { accessKeyId: STORAGE.accessKey, secretAccessKey: STORAGE.secretKey },
    }),
    ...mod,
  };
  return s3;
}

async function uploadWebp(key, bytes) {
  if (STORAGE.provider === 'vercel-blob') {
    const { put } = require('@vercel/blob');
    const res = await put(key, bytes, { access: 'public', contentType: 'image/webp', token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: false });
    return res.url;
  }
  const { client, PutObjectCommand } = await getS3();
  await client.send(new PutObjectCommand({
    Bucket: STORAGE.bucket,
    Key: key,
    Body: bytes,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${STORAGE.cdnBase}/${key}`;
}

async function verify(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch { return false; }
}

// --- image processing ---
async function optimize(buf) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const full = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const thumb = await sharp(buf).rotate().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  return { full, thumb, width: meta.width || null, height: meta.height || null };
}

function decodeDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  if (!mime.startsWith('image/')) return null;
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { mime, bytes };
}

// --- main ---
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

const report = { startedAt: new Date().toISOString(), dryRun: DRY_RUN, total: 0, migrated: 0, skipped: 0, failed: 0, noImage: 0, items: [] };

async function run() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set.'); process.exit(2); }
  if (!DRY_RUN) requireStorageOrStop();

  console.log(`\n🖼  Project image migration — ${DRY_RUN ? 'DRY RUN (no upload, no DB write)' : 'LIVE'}\n`);

  // Lightweight listing — never pulls the base64 blob here.
  const { rows } = await pool.query(`
    SELECT id,
           (left(doc->>'image', 5) = 'data:') AS has_b64,
           doc->'image_meta'->>'status'       AS status,
           doc->>'title'                       AS title,
           doc->>'location'                    AS location
    FROM pins
    ORDER BY NULLIF(doc->>'number','')::int NULLS LAST
  `);

  let processed = 0;
  for (const row of rows) {
    if (processed >= LIMIT) break;
    report.total++;

    if (!row.has_b64) { report.noImage++; continue; }
    if (row.status === 'completed' && !FORCE) { report.skipped++; continue; }

    processed++;
    const label = `#${report.total} ${row.title || row.id}`;
    try {
      // Pull ONE base64 image at a time.
      const one = await pool.query(`SELECT doc->>'image' AS image FROM pins WHERE id = $1`, [row.id]);
      const dataUrl = one.rows[0]?.image;
      const decoded = dataUrl && decodeDataUrl(dataUrl);
      if (!decoded) { report.noImage++; continue; }

      const { full, thumb, width, height } = await optimize(decoded.bytes);

      if (DRY_RUN) {
        console.log(`  ✓ ${label}: ${(decoded.bytes.length/1024).toFixed(0)}KB → full ${(full.length/1024).toFixed(0)}KB, thumb ${(thumb.length/1024).toFixed(0)}KB (${width}x${height})`);
        report.migrated++;
        report.items.push({ id: row.id, title: row.title, origKB: Math.round(decoded.bytes.length/1024), fullKB: Math.round(full.length/1024), thumbKB: Math.round(thumb.length/1024), width, height });
        continue;
      }

      const keyFull = `pins/${row.id}/image.webp`;
      const keyThumb = `pins/${row.id}/thumb.webp`;
      const imageUrl = await uploadWebp(keyFull, full);
      const thumbnailUrl = await uploadWebp(keyThumb, thumb);

      if (!(await verify(imageUrl))) throw new Error(`verify failed: ${imageUrl}`);

      const meta = {
        imageUrl, thumbnailUrl, storageKey: keyFull,
        width, height, mimeType: 'image/webp', fileSize: full.length,
        alt: row.title ? `${row.title}${row.location ? ` in ${row.location}` : ''}` : 'Project image',
        status: 'completed', migratedAt: new Date().toISOString(),
      };
      await pool.query(`UPDATE pins SET doc = jsonb_set(doc, '{image_meta}', $2::jsonb, true) WHERE id = $1`, [row.id, JSON.stringify(meta)]);
      console.log(`  ✓ ${label}: uploaded + recorded (${(full.length/1024).toFixed(0)}KB)`);
      report.migrated++;
      report.items.push({ id: row.id, title: row.title, imageUrl, fileSize: full.length, width, height });
    } catch (e) {
      report.failed++;
      report.items.push({ id: row.id, title: row.title, error: String(e && e.message || e) });
      console.error(`  ✗ ${label}: ${e && e.message || e}`);
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE pins SET doc = jsonb_set(doc, '{image_meta,status}', '"failed"'::jsonb, true) WHERE id = $1`,
          [row.id],
        ).catch(() => {});
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  const dir = join(__dirname, 'backup');
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const file = join(dir, `image-migration-${DRY_RUN ? 'dryrun-' : ''}${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));

  console.log(`\n── Summary ───────────────────────────`);
  console.log(`  total pins:     ${report.total}`);
  console.log(`  migrated:       ${report.migrated}`);
  console.log(`  skipped (done): ${report.skipped}`);
  console.log(`  no image:       ${report.noImage}`);
  console.log(`  failed:         ${report.failed}`);
  console.log(`  report:         ${file}\n`);

  await pool.end();
  process.exit(report.failed > 0 && !DRY_RUN ? 1 : 0);
}

run().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
