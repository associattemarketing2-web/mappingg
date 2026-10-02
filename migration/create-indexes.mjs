// Create MongoDB indexes based on the app's actual query patterns.
//   MONGODB_URI="mongodb+srv://..." node migration/create-indexes.mjs
//
// Only indexes that back real queries are created (no speculative indexes).

import './dns-fix.mjs';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'mappingg';
if (!uri) { console.error('MONGODB_URI is required.'); process.exit(1); }

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // pins: listed ordered by `number`; looked up by id (already _id).
  await db.collection('pins').createIndex({ number: 1 });
  // Supports any future bounding-box (viewport) filtering of pins. NOTE: true
  // geospatial ($near / $geoWithin) would need a GeoJSON `location` field +
  // 2dsphere index; the pins store lat/lng as plain numbers, so this plain
  // compound index is the correct, non-destructive choice for the current shape.
  await db.collection('pins').createIndex({ lat: 1, lng: 1 });

  // leads: admin panel lists newest first; joined to a pin by pin_id.
  await db.collection('leads').createIndex({ created_at: -1 });
  await db.collection('leads').createIndex({ pin_id: 1 });

  // pins_history: listed newest first; restore looked up by history_id.
  await db.collection('pins_history').createIndex({ changed_at: -1 });
  await db.collection('pins_history').createIndex({ history_id: 1 }, { unique: true });

  // infra_types: deleted by `key`.
  await db.collection('infra_types').createIndex({ key: 1 });

  // users: login lookup by email (unique).
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  // --------------------------------------------------------------------------
  // Partners intake (bulk CSV upload → review queue → publish). These back the
  // real query paths in lib/partners-engine.ts so the admin panel stays fast as
  // submissions grow into the thousands.
  // --------------------------------------------------------------------------
  // builders: unique human code; listed/sorted by company_name.
  await db.collection('builders').createIndex({ code: 1 }, { unique: true });
  await db.collection('builders').createIndex({ company_name: 1 });

  // submission_links: opened by secret token; listed per builder; counted when active.
  await db.collection('submission_links').createIndex({ token: 1 }, { unique: true });
  await db.collection('submission_links').createIndex({ builder_id: 1 });
  await db.collection('submission_links').createIndex({ is_active: 1 });

  // project_submissions: queue filters by status + newest-first; joined by
  // builder_id/link_id; looked up by ref_code; bulk uploads grouped by batch.
  await db.collection('project_submissions').createIndex({ ref_code: 1 }, { unique: true });
  await db.collection('project_submissions').createIndex({ status: 1, updated_at: -1 });
  await db.collection('project_submissions').createIndex({ builder_id: 1 });
  await db.collection('project_submissions').createIndex({ link_id: 1 });
  await db.collection('project_submissions').createIndex({ import_batch_id: 1 });

  // submission_events: a submission's history, newest first.
  await db.collection('submission_events').createIndex({ submission_id: 1, created_at: -1 });

  // projects (published/live): unique slug; listed by is_live + newest first;
  // reverse-looked up from a submission.
  await db.collection('projects').createIndex({ slug: 1 }, { unique: true });
  await db.collection('projects').createIndex({ is_live: 1, published_at: -1 });
  await db.collection('projects').createIndex({ submission_id: 1 });

  console.log('Indexes created.');
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
