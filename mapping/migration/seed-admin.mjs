// Create (or update) an admin user in the `users` collection so the team editor
// can sign in. Passwords are bcrypt-hashed — never stored in plain text.
//
//   MONGODB_URI="mongodb+srv://..." \
//   ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a-strong-password" \
//   node migration/seed-admin.mjs
//
// The Supabase auth users could NOT be exported (GoTrue password hashes are not
// readable via the API), so admin accounts are re-created here explicitly.

import './dns-fix.mjs';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'mappingg';
const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || '';

if (!uri) { console.error('MONGODB_URI is required.'); process.exit(1); }
if (!email || !password) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required.');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });

  const password_hash = await bcrypt.hash(password, 12);
  const existing = await users.findOne({ email });

  if (existing) {
    await users.updateOne({ email }, { $set: { password_hash, role: 'admin' } });
    console.log(`Updated password for existing admin: ${email}`);
  } else {
    const id = randomUUID();
    await users.insertOne({ _id: id, id, email, password_hash, role: 'admin', created_at: new Date().toISOString() });
    console.log(`Created admin user: ${email}`);
  }

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
