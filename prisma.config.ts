// Prisma CLI config — DATA SAFETY LOCK.
//
// prisma/schema.prisma lists only some of the tables in the live database
// (subscriptions, API platform, WhatsApp, analytics… are created by the app
// itself). Any Prisma command that makes the database "match the schema"
// (db push / db update / db migrate / migrate / reset) would DROP every table
// that isn't in that file — all of that data would be gone.
//
// So those commands stop here. Make schema changes with:
//   npm run db:migrate -- migration/your-change.sql      (checked, rolled back if anything is lost)
// Read-only Prisma commands still work.
//
// To really run one (after `npm run export:pg`): PRISMA_ALLOW_SCHEMA_SYNC=1 npx prisma …

const args = process.argv.slice(2).map((a) => a.toLowerCase());
const has = (...words: string[]) => words.every((w) => args.includes(w));
const risky =
  has('db', 'push') || has('db', 'update') || has('db', 'migrate') || has('db', 'reset') || has('db', 'execute') ||
  has('migrate') || has('migration', 'apply') || has('migration', 'reset');

if (risky && process.env.PRISMA_ALLOW_SCHEMA_SYNC !== '1') {
  console.error(
    '\n⛔ [db-guard] BLOCKED: `prisma ' + args.join(' ') + '` can drop every table that is not in prisma/schema.prisma.\n' +
      '   Your existing data is safe — nothing was run.\n' +
      '   Use: npm run db:migrate -- <file.sql>   (safe, rolls back if any data would be lost)\n',
  );
  process.exit(1);
}

export default {};
