import pg from 'pg';
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const r = await db.query(process.argv[2]);
console.log(JSON.stringify(r.rows, null, 0).replace(/\},\{/g, '},\n{'));
await db.end();
