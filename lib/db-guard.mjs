// Database guard: stops SQL that can delete or hide existing data.
//
// Used by every database connection in this repo: the website (lib/pg.ts), the
// WhatsApp gateway (gateway/db.mjs) and the maintenance tool
// (migration/db-guard.mjs). Adding things is always allowed (CREATE TABLE /
// INDEX, ADD COLUMN, INSERT, UPDATE … WHERE, DELETE … WHERE). What is blocked:
//
//   DROP TABLE / SCHEMA / DATABASE / VIEW / TYPE / SEQUENCE, anything … CASCADE
//   TRUNCATE
//   ALTER TABLE … DROP COLUMN, … ALTER COLUMN … TYPE, … RENAME, … SET SCHEMA
//   DELETE FROM t                (no WHERE, or WHERE TRUE: the whole table)
//   UPDATE t SET …               (no WHERE: overwrites every row)
//
// A rename counts too: the app reads tables and columns by name, so a renamed
// one looks exactly like lost data ("my old data doesn't show").
//
// To run one of these on purpose (after a backup: `npm run export:pg`), set
// DB_ALLOW_DESTRUCTIVE=1 for that one command, or use
// `npm run db:migrate -- file.sql --allow-destructive`.

/** Remove comments, string literals and $$-quoted bodies so only the SQL keywords remain. */
function stripSql(sql) {
  return String(sql)
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' $$ ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, (m) => m.replace(/;/g, ' ')) // quoted identifiers keep their name
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const RULES = [
  [/^DROP\s+(TABLE|SCHEMA|DATABASE|VIEW|MATERIALIZED\s+VIEW|TYPE|DOMAIN|SEQUENCE|OWNED|EXTENSION)\b/, 'drops a table / schema / database'],
  [/^DROP\b.*\bCASCADE\b/, 'DROP … CASCADE also removes everything that depends on it'],
  [/^TRUNCATE\b/, 'TRUNCATE empties a whole table'],
  [/^ALTER\s+TABLE\b.*\bDROP\s+(COLUMN\b|(?!CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)[A-Z_"])/, 'drops a column (its data is lost)'],
  [/^ALTER\s+TABLE\b.*\b(ALTER\s+(COLUMN\s+)?\S+\s+(SET\s+DATA\s+)?TYPE)\b/, 'changes a column type (data can be lost or rewritten)'],
  [/^ALTER\s+(TABLE|SCHEMA|DATABASE|VIEW)\b.*\bRENAME\b/, 'renames a table / column (the app stops finding the data)'],
  [/^ALTER\s+TABLE\b.*\bSET\s+SCHEMA\b/, 'moves a table to another schema (the app stops finding it)'],
  [/^DELETE\s+FROM\s+(?!.*\bWHERE\b)/, 'DELETE without WHERE removes every row'],
  [/^DELETE\s+FROM\b.*\bWHERE\s+(TRUE|1\s*=\s*1)\s*$/, 'DELETE … WHERE TRUE removes every row'],
  [/^UPDATE\s+(?!.*\bWHERE\b)/, 'UPDATE without WHERE overwrites every row'],
];

/**
 * Why this SQL would put existing data at risk, or null when it is safe.
 * @param {string} sql
 * @returns {string | null}
 */
export function riskOf(sql) {
  for (const raw of stripSql(sql).split(';')) {
    const st = raw.replace(/\s+/g, ' ').trim().toUpperCase();
    if (!st) continue;
    for (const [re, why] of RULES) if (re.test(st)) return `${why}: ${raw.replace(/\s+/g, ' ').trim().slice(0, 160)}`;
  }
  return null;
}

/** True when destructive SQL was allowed on purpose for this process. */
export const destructiveAllowed = () => process.env.DB_ALLOW_DESTRUCTIVE === '1';

export class DbGuardError extends Error {
  constructor(reason) {
    super(`[db-guard] BLOCKED — this would put existing data at risk (${reason}). Nothing was changed. ` +
      'Take a backup (npm run export:pg) and run it with DB_ALLOW_DESTRUCTIVE=1 if you really mean it.');
    this.name = 'DbGuardError';
    this.code = 'DB_GUARD';
    this.reason = reason;
  }
}

/**
 * Throws DbGuardError for risky SQL (unless allowed). Calls onBlock(reason) first so the caller can log it.
 * @param {string} sql
 * @param {(reason: string, allowed: boolean) => void} [onRisk]
 */
export function assertSafeSql(sql, onRisk) {
  const reason = riskOf(sql);
  if (!reason) return;
  const allowed = destructiveAllowed();
  try { onRisk?.(reason, allowed); } catch { /* logging must not change the outcome */ }
  if (allowed) {
    console.warn(`[db-guard] ALLOWED by DB_ALLOW_DESTRUCTIVE=1: ${reason}`);
    return;
  }
  console.error(`\n[db-guard] ⛔ BLOCKED: ${reason}\n`);
  throw new DbGuardError(reason);
}

/** Additive table where blocked / allowed risky statements and failed checks are recorded (shown in s-admin). */
export const GUARD_LOG_SQL = `CREATE TABLE IF NOT EXISTS db_guard_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  seen boolean NOT NULL DEFAULT false
)`;
