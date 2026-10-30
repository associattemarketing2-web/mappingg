// One-off (29 Oct 2026): add gallery photos to live Projects Intake records from each project's official website.
//
//   npx tsx --env-file=.env migration/gallery-from-official-sites-2026-10-29.mts <picks.json> <img-dir>            (dry run)
//   npx tsx --env-file=.env migration/gallery-from-official-sites-2026-10-29.mts <picks.json> <img-dir> --apply    (backup, upload, update)
//
// <picks.json>: [{ key, page, projects: [{ id }], files: ['01.jpg', …] }] — photos scraped from the developer's own
// project page (the "Developer project page" / website link already on the record) and checked by eye: renders,
// elevations, amenities and show flats only (no logos, floor plans, maps, people or other projects).
// <img-dir>/<key>/<file> are 1600 px JPEGs. Only records whose gallery is empty are touched; at most 10 photos.
// The photos go into both intake buckets (so the admin form shows them and a re-publish keeps them) and onto the
// live project's gallery_urls. Nothing else on the record changes.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/mongodb';
import { query } from '../lib/pg';

const APPLY = process.argv.includes('--apply');
const [PICKS, IMG_DIR] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!PICKS || !IMG_DIR) throw new Error('pass <picks.json> <img-dir>');

type Pick = { key: string; page: string; projects: { id?: string }[]; files: string[] };
const picks: Pick[] = JSON.parse(readFileSync(PICKS, 'utf8'));

const publicUrl = (p: string) => `/api/partners/storage?bucket=project-media&path=${encodeURIComponent(p)}&public=1`;

async function putFile(bucket: string, p: string, buf: Buffer) {
  const filename = `${bucket}/${p}`;
  await query(`DELETE FROM "partners_media" WHERE filename = $1`, [filename]);
  await query(`INSERT INTO "partners_media" (filename, content_type, metadata, data) VALUES ($1, $2, $3::jsonb, $4)`,
    [filename, 'image/jpeg', JSON.stringify({ bucket, path: p }), buf]);
}

const db = await getDb();
const projects = db.collection<any>('projects');
const subs = db.collection<any>('project_submissions');

const plans: { pick: Pick; project: any; sub: any; paths: string[] }[] = [];
for (const pick of picks) {
  const files = pick.files.slice(0, 10);
  if (!files.length) continue;
  for (const file of files) readFileSync(path.join(IMG_DIR, pick.key, file)); // all photos present
  for (const { id } of pick.projects) {
    if (!id) continue;
    const project = await projects.findOne({ id, is_live: true });
    if (!project) { console.log(`skip ${id}: no live project`); continue; }
    if ((project.gallery_urls || []).length) { console.log(`skip ${project.project_name}: already has a gallery`); continue; }
    const sub = await subs.findOne({ id: project.submission_id });
    if (!sub) { console.log(`skip ${project.project_name}: no submission`); continue; }
    if ((sub.gallery_paths || []).length) { console.log(`skip ${project.project_name}: intake form already has gallery photos`); continue; }
    const paths = files.map((f) => `${sub.id}/official-${pick.key.slice(0, 50)}-${f}`);
    plans.push({ pick, project, sub, paths });
  }
}

for (const { pick, project, paths } of plans) console.log(`${project.project_name} ← ${paths.length} photos from ${pick.page}`);
console.log(`\n${plans.length} projects, ${plans.reduce((a, p) => a + p.paths.length, 0)} photos`);
if (!APPLY) { console.log('Dry run. Pass --apply to write.'); process.exit(0); }

const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-official-gallery`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ projects: plans.map((p) => p.project), submissions: plans.map((p) => p.sub) }, null, 1));
console.log(`backup → ${path.relative(process.cwd(), dir)}/before.json`);

const nowTs = new Date().toISOString();
for (const { pick, project, sub, paths } of plans) {
  const files = pick.files.slice(0, 10);
  const published: Record<string, string> = { ...(sub.published_media || {}) };
  for (let i = 0; i < files.length; i++) {
    const buf = readFileSync(path.join(IMG_DIR, pick.key, files[i]));
    await putFile('submission-media', paths[i], buf);
    await putFile('project-media', paths[i], buf);
    published[paths[i]] = publicUrl(paths[i]);
  }
  await subs.updateOne({ id: sub.id }, { $set: { gallery_paths: paths, published_media: published, updated_at: nowTs } });
  await projects.updateOne({ id: project.id }, { $set: { gallery_urls: paths.map(publicUrl), updated_at: nowTs } });
  console.log(`${project.project_name}: ${paths.length} photos`);
}
process.exit(0);
