import { GridFSBucket } from 'mongodb';
import { query } from './pg';
import { getMongoDb, usingMongo } from './mongodb';

// Partner media files (submission + project images, brochures, RERA QR), keyed
// by "<bucket>/<path>". On MongoDB they live in a GridFS bucket (files can
// exceed the 16 MB document limit); on Postgres in the partners_media table.
// Written by app/api/partners/storage; read there and by app/api/brochure.

export const partnersGridfs = async () => new GridFSBucket(await getMongoDb(), { bucketName: 'partners_media' });

export async function loadPartnersFile(filename: string): Promise<{ content_type: string; data: Buffer } | null> {
  if (usingMongo()) {
    const bucket = await partnersGridfs();
    const [f] = await bucket.find({ filename }).sort({ uploadDate: -1 }).limit(1).toArray();
    if (!f) return null;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      bucket.openDownloadStream(f._id).on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve()).on('error', reject);
    });
    return { content_type: String(f.metadata?.contentType || ''), data: Buffer.concat(chunks) };
  }
  const res = await query<{ content_type: string; data: Buffer }>(
    `SELECT content_type, data FROM "partners_media" WHERE filename = $1 ORDER BY upload_date DESC LIMIT 1`,
    [filename],
  );
  return res.rows[0] || null;
}
