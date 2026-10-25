import pg from 'pg';
const url = new URL(process.env.DATABASE_URL); const mode = url.searchParams.get('sslmode'); url.searchParams.delete('sslmode');
const c = new pg.Client({ connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`select relname t, seq_scan+coalesce(idx_scan,0) reads from pg_stat_user_tables where relname in ('posts','pins','map_settings') order by 1`);
console.log(JSON.stringify(Object.fromEntries(r.rows.map((x) => [x.t, Number(x.reads)]))));
await c.end();
