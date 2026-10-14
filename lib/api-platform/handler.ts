import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { usingMongo } from '../mongodb';
import { clientIp } from '../rate-limit';
import { API_VERSION, LIMITS, apiDisabled, type Scope } from './config';
import { bearerToken, clientFingerprint } from './keys';
import * as store from './store';
import type { ApiApp, AuthFailure, LogEvent, Sql } from './store';

// The request pipeline every /api/v1 route goes through:
//
//   kill switch → client block check → API key (Bearer) → key/app state + expiry
//   → scope → per-minute limit + daily quota (shared Postgres counters)
//   → concurrency cap → strict query validation → handler (with timeout)
//   → size check → consistent JSON + headers → request log (metadata only)
//
// Keys are never logged; the Authorization header is read once and dropped.
// A Developer API key authenticates ONLY these routes: admin and account APIs
// use the session cookie (lib/auth.ts) and never look at Authorization.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public headers: Record<string, string> = {}) {
    super(message);
  }
}

export interface Pagination { page: number; limit: number; total: number; hasMore: boolean }
export interface HandlerResult { data: unknown; pagination?: Pagination; records?: number }

export interface Ctx<Q> {
  req: NextRequest;
  query: Q;
  params: Record<string, string>;
  /** The calling application (null on public endpoints). */
  app: ApiApp | null;
  requestId: string;
}

interface Options<Q extends z.ZodTypeAny> {
  /** Route template for logs and docs, e.g. "/projects/{id}". */
  route: string;
  /** Required scope; `null` = any valid key; `'public'` = no key (health, openapi, sample). */
  scope: Scope | null | 'public';
  query?: Q;
  handler: (ctx: Ctx<z.infer<Q>>) => Promise<HandlerResult | Response>;
  /** Cache-Control for public endpoints. */
  publicCache?: string;
}

// Tests swap the database for an in-process Postgres; production uses lib/pg.
let sqlOverride: Sql | undefined;
export const __setSql = (sql: Sql | undefined) => { sqlOverride = sql; };
const db = () => sqlOverride;

// Fire-and-forget bookkeeping (logs, last-used) — tracked so tests can await it.
const pending = new Set<Promise<unknown>>();
function background(p: Promise<unknown>) {
  const t = p.catch((e) => console.warn('[api] bookkeeping failed:', (e as Error).message)).finally(() => pending.delete(t));
  pending.add(t);
}
export const __settle = async () => { while (pending.size) await Promise.all([...pending]); };

const inflight = new Map<string, number>();
let lastSweep = 0;

const FAILURE_MESSAGES: Record<AuthFailure, [number, string, string]> = {
  invalid_key: [401, 'invalid_api_key', 'The API key is not valid.'],
  revoked_key: [401, 'revoked_api_key', 'This API key has been revoked.'],
  expired_key: [401, 'expired_api_key', 'This API key has expired.'],
  app_disabled: [403, 'application_disabled', 'This application is disabled. Contact Mappingg support.'],
  app_revoked: [403, 'application_revoked', 'This application has been revoked.'],
  app_expired: [403, 'application_expired', 'This application’s access has expired.'],
};

function errorBody(e: ApiError, requestId: string) {
  return {
    success: false,
    error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}), requestId },
  };
}

const EVENT_FOR: Record<string, LogEvent> = {
  missing_api_key: 'auth_missing', invalid_api_key: 'auth_failed', revoked_api_key: 'auth_failed', expired_api_key: 'auth_failed',
  application_disabled: 'auth_failed', application_revoked: 'auth_failed', application_expired: 'auth_failed',
  insufficient_scope: 'forbidden', rate_limited: 'rate_limited', quota_exceeded: 'quota_exceeded', client_blocked: 'blocked',
};

/** Strict query parsing: unknown parameters and repeated parameters are rejected. */
function parseQuery<Q extends z.ZodTypeAny>(req: NextRequest, schema: Q | undefined): z.infer<Q> {
  const sp = req.nextUrl.searchParams;
  const raw: Record<string, string> = {};
  for (const k of new Set(sp.keys())) {
    if (sp.getAll(k).length > 1) throw new ApiError(400, 'invalid_parameter', `Query parameter "${k}" was given more than once.`);
    raw[k] = sp.get(k)!;
  }
  if (!schema) {
    if (Object.keys(raw).length) throw new ApiError(400, 'invalid_parameter', 'This endpoint takes no query parameters.', { unknown: Object.keys(raw) });
    return {} as z.infer<Q>;
  }
  const parsed = (schema as z.ZodTypeAny).safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_parameter', 'One or more query parameters are invalid.',
      parsed.error.issues.map((i) => ({ parameter: i.path.join('.') || (i as { keys?: string[] }).keys?.join(',') || '', message: i.message })));
  }
  return parsed.data;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ApiError(504, 'timeout', 'The request took too long. Try a smaller page or narrower filters.')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function apiRoute<Q extends z.ZodTypeAny = z.ZodTypeAny>(opts: Options<Q>) {
  return async function GET(req: NextRequest, ctx?: { params?: Record<string, string> }): Promise<Response> {
    const started = Date.now();
    const requestId = randomUUID();
    const client = clientFingerprint(clientIp(req));
    const headers: Record<string, string> = { 'X-Request-Id': requestId, 'X-Api-Version': API_VERSION };
    let app: ApiApp | null = null;
    let keyId: string | null = null;
    let failedAppId: string | null = null;
    let status = 200;
    let records = 0;
    let event: LogEvent = 'ok';
    let response: Response;
    let counted = false;
    const isPublic = opts.scope === 'public';
    const sql = db();

    try {
      if (apiDisabled() && opts.route !== '/health') throw new ApiError(503, 'api_disabled', 'The Mappingg Developer API is temporarily unavailable.');
      if (usingMongo() && !isPublic) throw new ApiError(503, 'api_unavailable', 'The Developer API is not available on this deployment.');

      if (isPublic) {
        // Unauthenticated endpoints: small per-client limit, shared counter.
        const key = `p:${client}:${Math.floor(started / 60_000)}`;
        // If the database is down, health must still answer, so a failed count allows the request.
        const n = usingMongo() ? 0 : await store.hit([{ key, ttlSec: 120 }], sql).then((c) => c[key]).catch(() => 0);
        if (n > LIMITS.publicPerMinute) throw new ApiError(429, 'rate_limited', 'Too many requests. Slow down and retry shortly.', undefined, { 'Retry-After': String(60 - Math.floor((started / 1000) % 60)) });
      } else {
        // A missing key needs no database round trip.
        const token = bearerToken(req.headers.get('authorization'));
        if (!token) {
          throw new ApiError(401, 'missing_api_key', 'Send your API key in the header "Authorization: Bearer <key>".', undefined, { 'WWW-Authenticate': 'Bearer realm="mappingg-api"' });
        }
        // Clients that keep failing authentication are blocked for a while.
        const failKey = `f:${client}:${Math.floor(started / 1000 / LIMITS.authFailureWindowSec)}`;
        if ((await store.peek(failKey, sql)) >= LIMITS.maxAuthFailures) {
          throw new ApiError(429, 'client_blocked', 'Too many failed authentication attempts. Try again later.', undefined, { 'Retry-After': String(LIMITS.authFailureWindowSec) });
        }
        const auth = await store.authenticate(token, sql);
        if (!auth.ok) {
          background(store.hit([{ key: failKey, ttlSec: LIMITS.authFailureWindowSec * 2 }], sql));
          keyId = auth.keyId || null;
          failedAppId = auth.appId || null;
          const [s, code, msg] = FAILURE_MESSAGES[auth.reason];
          throw new ApiError(s, code, msg, undefined, s === 401 ? { 'WWW-Authenticate': 'Bearer realm="mappingg-api", error="invalid_token"' } : {});
        }
        app = auth.app; keyId = auth.keyId;
        if (opts.scope && opts.scope !== 'public' && !app.scopes.includes(opts.scope)) {
          throw new ApiError(403, 'insufficient_scope', `This key is not allowed to use this endpoint (needs scope "${opts.scope}").`, { required_scope: opts.scope, granted_scopes: app.scopes });
        }

        // Shared per-minute and per-day counters.
        const minute = Math.floor(started / 60_000);
        const mKey = `m:${app.id}:${minute}`;
        const dKey = `d:${app.id}:${utcDay()}`;
        const counts = await store.hit([{ key: mKey, ttlSec: 120 }, { key: dKey, ttlSec: 2 * 86_400 }], sql);
        const resetMinute = (minute + 1) * 60;
        const dayEnd = new Date(utcDay() + 'T00:00:00Z').getTime() / 1000 + 86_400;
        Object.assign(headers, {
          'X-RateLimit-Limit': String(app.rate_per_minute),
          'X-RateLimit-Remaining': String(Math.max(0, app.rate_per_minute - counts[mKey])),
          'X-RateLimit-Reset': String(resetMinute),
          'X-Quota-Limit': String(app.daily_quota),
          'X-Quota-Remaining': String(Math.max(0, app.daily_quota - counts[dKey])),
          'X-Quota-Reset': String(dayEnd),
        });
        if (counts[dKey] > app.daily_quota) {
          throw new ApiError(429, 'quota_exceeded', 'Daily request quota exceeded. It resets at 00:00 UTC.', undefined, { 'Retry-After': String(Math.max(1, Math.ceil(dayEnd - started / 1000))) });
        }
        if (counts[mKey] > app.rate_per_minute) {
          throw new ApiError(429, 'rate_limited', 'Rate limit exceeded. Retry after the number of seconds in Retry-After.', undefined, { 'Retry-After': String(Math.max(1, Math.ceil(resetMinute - started / 1000))) });
        }
        const n = inflight.get(app.id) || 0;
        if (n >= LIMITS.maxConcurrentPerApp) {
          throw new ApiError(429, 'rate_limited', `Too many concurrent requests (max ${LIMITS.maxConcurrentPerApp}).`, undefined, { 'Retry-After': '1' });
        }
        inflight.set(app.id, n + 1);
        counted = true;
        background(store.touch(app.id, keyId, sql));
      }

      const query = parseQuery(req, opts.query);
      const out = await withTimeout(opts.handler({ req, query, params: ctx?.params || {}, app, requestId }), LIMITS.timeoutMs);
      if (out instanceof Response) {
        response = out;
        status = out.status;
      } else {
        records = out.records ?? (Array.isArray(out.data) ? out.data.length : out.data ? 1 : 0);
        const body = JSON.stringify({ success: true, data: out.data, ...(out.pagination ? { pagination: out.pagination } : {}), meta: { requestId, apiVersion: API_VERSION } });
        if (body.length > LIMITS.maxResponseBytes) throw new ApiError(500, 'response_too_large', 'The response is too large. Use a smaller page size.');
        response = new NextResponse(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        // Keyed responses may only be cached by the caller, never by a shared cache:
        // otherwise a CDN could serve one app's response (and bypass limits) to another.
        response.headers.set('Cache-Control', isPublic ? opts.publicCache || 'public, max-age=60' : 'private, max-age=30');
        if (!isPublic) response.headers.set('Vary', 'Authorization');
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(500, 'internal_error', 'Something went wrong on our side. Quote the request ID if you contact support.');
      if (!(e instanceof ApiError)) console.error(`[api] ${opts.route} ${requestId}:`, (e as Error)?.message || e); // message only, never the request
      status = err.status;
      event = EVENT_FOR[err.code] || (status >= 500 ? 'server_error' : 'client_error');
      response = NextResponse.json(errorBody(err, requestId), { status, headers: { ...err.headers, 'Cache-Control': 'no-store' } });
    } finally {
      if (counted && app) inflight.set(app.id, Math.max(0, (inflight.get(app.id) || 1) - 1));
    }

    for (const [k, v] of Object.entries(headers)) response!.headers.set(k, v);
    if (isPublic) response!.headers.set('Access-Control-Allow-Origin', '*');

    if (!usingMongo()) {
      background(store.logRequest({
        appId: app?.id ?? failedAppId, keyId, method: req.method, route: opts.route, status,
        durationMs: Date.now() - started, records, event, requestId, client,
      }, sql));
      if (started - lastSweep > 10 * 60_000) { lastSweep = started; background(store.sweep(sql)); }
    }
    return response!;
  };
}

// ---- shared query pieces --------------------------------------------------------

export const pageParams = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).optional(),
};

/** Pages an in-memory list, honouring the app's page-size cap and the deep-paging limit. */
export function paginate<T>(all: T[], page: number, limit: number | undefined, app: ApiApp | null, fallback = 20) {
  const cap = Math.min(app?.max_page_size ?? LIMITS.defaultMaxPageSize, LIMITS.maxPageSize);
  const size = Math.min(limit ?? Math.min(fallback, cap), cap);
  if (limit && limit > cap) throw new ApiError(400, 'invalid_parameter', `limit must be at most ${cap} for this application.`, [{ parameter: 'limit', message: `max ${cap}` }]);
  const offset = (page - 1) * size;
  if (offset >= LIMITS.maxOffset) throw new ApiError(400, 'invalid_parameter', `Paging is limited to the first ${LIMITS.maxOffset} records. Narrow your filters instead.`, [{ parameter: 'page', message: 'too deep' }]);
  const slice = all.slice(offset, offset + size);
  return { data: slice, pagination: { page, limit: size, total: all.length, hasMore: offset + slice.length < all.length } };
}

export const slugParam = (v: string | undefined) => {
  if (!v || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) || v.length > 120) throw new ApiError(400, 'invalid_parameter', 'Invalid identifier in the URL.');
  return v;
};

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found.`);
