// HR / Employee-management data layer.
//
// The HR module keeps using its OWN Postgres database (the one the standalone
// employee-management-system app created with Prisma — env HR_DATABASE_URL), so
// none of Mappingg's tables are touched. Mappingg does not run a generated
// Prisma client, so this file provides a small Prisma-compatible client over a
// dedicated pg pool: only the query shapes the HR routes use are supported
// (where: equals / startsWith / lt / lte / gt / gte / in / not / OR / NOT,
// select, include of the one user relation, orderBy, take, create, createMany,
// update, delete, upsert, count).
import { randomUUID } from 'crypto';
import { Pool, types as pgTypes } from 'pg';
import type { Settings } from './types';

type Row = Record<string, any>;

declare global {
  // eslint-disable-next-line no-var
  var _hrPool: Pool | undefined;
}

// Prisma stores DateTime as `timestamp(3) without time zone` holding UTC. Read
// those values back as UTC (pg would otherwise treat them as server-local time).
const TIMESTAMP_OID = 1114;
const hrTypes = {
  getTypeParser(oid: number, format?: any) {
    if (oid === TIMESTAMP_OID) return (v: string) => (v == null ? null : new Date(v.replace(' ', 'T') + 'Z'));
    return (pgTypes.getTypeParser as any)(oid, format);
  },
};

function pool(): Pool {
  if (global._hrPool) return global._hrPool;
  const url = process.env.HR_DATABASE_URL;
  if (!url) throw new Error('HR_DATABASE_URL is not set (HR / attendance database).');
  let connectionString = url;
  try {
    const u = new URL(url);
    // Same explicit, verified TLS as lib/pg.ts (sslmode=require is an alias of verify-full in pg).
    if (/^(require|prefer|verify-ca)$/.test(u.searchParams.get('sslmode') || '')) {
      u.searchParams.set('sslmode', 'verify-full');
      connectionString = u.toString();
    }
  } catch { /* not a URL — use as is */ }
  global._hrPool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, types: hrTypes as any });
  global._hrPool.on('error', (e) => console.error('[hr-db] idle client error', e.message));
  return global._hrPool;
}

/** Dates are sent as UTC ISO strings: Postgres drops the "Z" for timestamp columns, keeping UTC. */
const param = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

async function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  const r = await pool().query(sql, params.map(param));
  return r.rows;
}

const q = (c: string) => `"${c.replace(/"/g, '')}"`;

/* ------------------------------------------------------------------ models */
type Relation = { name: string; model: string; fk: string };
type Model = {
  table: string;
  columns: string[];
  relations?: Relation[];
  uniques?: Record<string, string[]>;
  defaults?: () => Row;
};

const MODELS: Record<string, Model> = {
  user: {
    table: 'User',
    columns: ['id', 'empCode', 'name', 'email', 'password', 'role', 'phone', 'designation', 'department', 'salaryType', 'salary', 'joinDate', 'active', 'createdAt'],
    defaults: () => ({ id: cuid(), role: 'EMPLOYEE', salaryType: 'MONTHLY', salary: 0, joinDate: new Date(), active: true, createdAt: new Date() }),
  },
  settings: {
    table: 'Settings',
    columns: ['id', 'companyName', 'officeStart', 'officeEnd', 'graceMinutes', 'halfDayHours', 'workingDays', 'officeLat', 'officeLng', 'geofenceRadius', 'enforceGeofence', 'requireSelfie', 'payrollMode', 'casualLeavePerYear', 'sickLeavePerYear', 'paidLeavePerYear'],
    defaults: () => ({
      id: 1, companyName: 'My Company', officeStart: '09:30', officeEnd: '18:30', graceMinutes: 15, halfDayHours: 4,
      workingDays: '1,2,3,4,5,6', geofenceRadius: 200, enforceGeofence: false, requireSelfie: true, payrollMode: 'HOURS',
      casualLeavePerYear: 12, sickLeavePerYear: 6, paidLeavePerYear: 0,
    }),
  },
  attendance: {
    table: 'Attendance',
    columns: ['id', 'userId', 'date', 'checkIn', 'checkOut', 'checkInSelfie', 'checkOutSelfie', 'checkInLat', 'checkInLng', 'checkInAddress', 'checkInDistance', 'checkOutLat', 'checkOutLng', 'checkOutAddress', 'isLate', 'lateMinutes', 'todayPlan', 'workSummary', 'adminNote', 'createdAt'],
    relations: [{ name: 'user', model: 'user', fk: 'userId' }],
    uniques: { userId_date: ['userId', 'date'] },
    defaults: () => ({ id: cuid(), isLate: false, lateMinutes: 0, createdAt: new Date() }),
  },
  task: {
    table: 'Task',
    columns: ['id', 'title', 'description', 'priority', 'status', 'dueDate', 'date', 'source', 'employeeNote', 'assignedToId', 'createdById', 'completedAt', 'createdAt'],
    relations: [{ name: 'assignedTo', model: 'user', fk: 'assignedToId' }],
    defaults: () => ({ id: cuid(), priority: 'MEDIUM', status: 'PENDING', source: 'ADMIN', createdAt: new Date() }),
  },
  leave: {
    table: 'Leave',
    columns: ['id', 'userId', 'fromDate', 'toDate', 'type', 'reason', 'status', 'adminNote', 'createdAt'],
    relations: [{ name: 'user', model: 'user', fk: 'userId' }],
    defaults: () => ({ id: cuid(), type: 'CASUAL', status: 'PENDING', createdAt: new Date() }),
  },
  holiday: { table: 'Holiday', columns: ['id', 'date', 'name'], defaults: () => ({ id: cuid() }) },
  announcement: { table: 'Announcement', columns: ['id', 'title', 'body', 'createdAt'], defaults: () => ({ id: cuid(), createdAt: new Date() }) },
  adjustment: {
    table: 'Adjustment',
    columns: ['id', 'userId', 'month', 'type', 'amount', 'note', 'createdAt'],
    defaults: () => ({ id: cuid(), createdAt: new Date() }),
  },
};

/** Collision-safe id in the same spirit as Prisma's cuid() (any unique string works). */
function cuid() {
  return 'c' + Date.now().toString(36) + randomUUID().replace(/-/g, '').slice(0, 16);
}

/* ------------------------------------------------------------ SQL building */
class Sql {
  params: unknown[] = [];
  p(v: unknown) {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

function isPlainObject(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
}

function where(m: Model, w: Row | undefined, s: Sql): string {
  if (!w) return 'TRUE';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(w)) {
    if (v === undefined) continue;
    if (k === 'OR') { parts.push(`(${(v as Row[]).map((x) => where(m, x, s)).join(' OR ') || 'FALSE'})`); continue; }
    if (k === 'AND') { parts.push(`(${(v as Row[]).map((x) => where(m, x, s)).join(' AND ') || 'TRUE'})`); continue; }
    if (k === 'NOT') { parts.push(`NOT (${(Array.isArray(v) ? v : [v]).map((x: Row) => where(m, x, s)).join(' AND ')})`); continue; }
    if (m.uniques?.[k]) { parts.push(where(m, v as Row, s)); continue; }
    if (!m.columns.includes(k)) throw new Error(`hr-db: unknown column ${m.table}.${k}`);
    const col = q(k);
    if (!isPlainObject(v)) { parts.push(v === null ? `${col} IS NULL` : `${col} = ${s.p(v)}`); continue; }
    for (const [op, x] of Object.entries(v)) {
      if (x === undefined) continue;
      switch (op) {
        case 'equals': parts.push(x === null ? `${col} IS NULL` : `${col} = ${s.p(x)}`); break;
        case 'not': parts.push(x === null ? `${col} IS NOT NULL` : `${col} IS DISTINCT FROM ${s.p(x)}`); break;
        case 'in': parts.push(`${col}::text = ANY(${s.p((x as unknown[]).map(String))}::text[])`); break;
        case 'startsWith': parts.push(`${col} LIKE ${s.p(String(x).replace(/[\\%_]/g, '\\$&') + '%')}`); break;
        case 'lt': parts.push(`${col} < ${s.p(x)}`); break;
        case 'lte': parts.push(`${col} <= ${s.p(x)}`); break;
        case 'gt': parts.push(`${col} > ${s.p(x)}`); break;
        case 'gte': parts.push(`${col} >= ${s.p(x)}`); break;
        default: throw new Error(`hr-db: unsupported filter ${op}`);
      }
    }
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function orderBy(o: Row | Row[] | undefined): string {
  if (!o) return '';
  const list = (Array.isArray(o) ? o : [o]).flatMap((x) => Object.entries(x));
  return list.length ? ` ORDER BY ${list.map(([k, d]) => `${q(k)} ${d === 'desc' ? 'DESC' : 'ASC'}`).join(', ')}` : '';
}

type Shape = { select?: Row; include?: Row };

/** Columns to read, plus relation sub-shapes to load afterwards. */
function shape(m: Model, sh: Shape) {
  const rels: { rel: Relation; sel?: Row }[] = [];
  let cols: string[];
  if (sh.select) {
    cols = [];
    for (const [k, v] of Object.entries(sh.select)) {
      if (!v) continue;
      const rel = m.relations?.find((r) => r.name === k);
      if (rel) rels.push({ rel, sel: isPlainObject(v) ? v.select : undefined });
      else cols.push(k);
    }
  } else {
    cols = [...m.columns];
  }
  for (const [k, v] of Object.entries(sh.include || {})) {
    const rel = m.relations?.find((r) => r.name === k);
    if (rel && v) rels.push({ rel, sel: isPlainObject(v) ? v.select : undefined });
  }
  const fetchCols = new Set(cols);
  rels.forEach((r) => fetchCols.add(r.rel.fk));
  return { cols, fetchCols: [...fetchCols], rels };
}

async function attach(m: Model, rows: Row[], sh: Shape): Promise<Row[]> {
  const { cols, rels } = shape(m, sh);
  for (const { rel, sel } of rels) {
    const ids = [...new Set(rows.map((r) => r[rel.fk]).filter(Boolean))];
    const target = MODELS[rel.model];
    const relCols = sel ? Object.keys(sel).filter((k) => sel[k]) : target.columns;
    const found = ids.length
      ? await query(`SELECT ${[...new Set(['id', ...relCols])].map(q).join(', ')} FROM ${q(target.table)} WHERE "id" = ANY($1::text[])`, [ids])
      : [];
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const r of rows) {
      const f = byId.get(r[rel.fk]);
      r[rel.name] = f ? Object.fromEntries(relCols.map((c) => [c, f[c]])) : null;
    }
  }
  // drop fk columns that were only fetched for the join
  return rows.map((r) => {
    const out: Row = {};
    for (const c of cols) out[c] = r[c];
    for (const { rel } of rels) out[rel.name] = r[rel.name];
    return out;
  });
}

function cleanData(m: Model, data: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (!m.columns.includes(k)) throw new Error(`hr-db: unknown column ${m.table}.${k}`);
    out[k] = v;
  }
  return out;
}

/* --------------------------------------------------------------- delegates */
type Args = Shape & { where?: Row; orderBy?: Row | Row[]; take?: number; data?: Row; create?: Row; update?: Row };

function delegate(name: string) {
  const m = MODELS[name];
  const T = q(m.table);

  async function findMany(a: Args = {}): Promise<any[]> {
    const s = new Sql();
    const { fetchCols } = shape(m, a);
    const sql = `SELECT ${fetchCols.map(q).join(', ')} FROM ${T} WHERE ${where(m, a.where, s)}${orderBy(a.orderBy)}${a.take ? ` LIMIT ${Number(a.take)}` : ''}`;
    return attach(m, await query(sql, s.params), a);
  }
  async function findFirst(a: Args = {}): Promise<any | null> {
    return (await findMany({ ...a, take: 1 }))[0] ?? null;
  }
  async function insert(data: Row, a: Shape = {}): Promise<any> {
    const d = cleanData(m, { ...(m.defaults?.() || {}), ...data });
    const keys = Object.keys(d);
    const s = new Sql();
    const rows = await query(`INSERT INTO ${T} (${keys.map(q).join(', ')}) VALUES (${keys.map((k) => s.p(d[k])).join(', ')}) RETURNING *`, s.params);
    return (await attach(m, rows, a))[0];
  }
  async function update(a: Args): Promise<any> {
    const d = cleanData(m, a.data || {});
    const s = new Sql();
    const sets = Object.keys(d).map((k) => `${q(k)} = ${s.p(d[k])}`);
    const sql = sets.length
      ? `UPDATE ${T} SET ${sets.join(', ')} WHERE ${where(m, a.where, s)} RETURNING *`
      : `SELECT * FROM ${T} WHERE ${where(m, a.where, s)}`;
    const rows = await query(sql, s.params);
    if (!rows.length) throw new HttpLikeError(404, 'Record not found');
    return (await attach(m, rows.slice(0, 1), a))[0];
  }

  return {
    findMany,
    findFirst,
    findUnique: findFirst,
    async findUniqueOrThrow(a: Args) {
      const r = await findFirst(a);
      if (!r) throw new HttpLikeError(404, 'Record not found');
      return r;
    },
    async count(a: Args = {}): Promise<number> {
      const s = new Sql();
      const rows = await query(`SELECT COUNT(*)::int AS n FROM ${T} WHERE ${where(m, a.where, s)}`, s.params);
      return rows[0].n;
    },
    create: (a: Args) => insert(a.data || {}, a),
    async createMany(a: { data: Row[] }) {
      for (const d of a.data) await insert(d);
      return { count: a.data.length };
    },
    update,
    async upsert(a: Args) {
      const existing = await findFirst({ where: a.where });
      if (existing) return update({ where: { id: existing.id }, data: a.update, select: a.select, include: a.include });
      return insert(a.create || {}, a);
    },
    async delete(a: Args) {
      const s = new Sql();
      const rows = await query(`DELETE FROM ${T} WHERE ${where(m, a.where, s)} RETURNING "id"`, s.params);
      if (!rows.length) throw new HttpLikeError(404, 'Record not found');
      return rows[0];
    },
    /** Only the shape the dashboard uses: count per value of one column. */
    async groupBy(a: { by: string[]; where?: Row; _count: true }) {
      const col = a.by[0];
      if (!m.columns.includes(col)) throw new Error(`hr-db: unknown column ${col}`);
      const s = new Sql();
      const rows = await query(`SELECT ${q(col)} AS k, COUNT(*)::int AS n FROM ${T} WHERE ${where(m, a.where, s)} GROUP BY ${q(col)}`, s.params);
      return rows.map((r) => ({ [col]: r.k, _count: r.n }));
    },
  };
}

/** Thrown for "not found" so route handlers answer with a clean 404 message. */
export class HttpLikeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const prisma = {
  user: delegate('user'),
  settings: delegate('settings'),
  attendance: delegate('attendance'),
  task: delegate('task'),
  leave: delegate('leave'),
  holiday: delegate('holiday'),
  announcement: delegate('announcement'),
  adjustment: delegate('adjustment'),
};

export async function getSettings(): Promise<Settings> {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  return s ?? prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export const employeeSelect = {
  id: true, empCode: true, name: true, email: true, role: true, phone: true, designation: true,
  department: true, salaryType: true, salary: true, joinDate: true, active: true, createdAt: true,
} as const;
