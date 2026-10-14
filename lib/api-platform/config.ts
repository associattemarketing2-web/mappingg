// Public Developer API (/api/v1) — shared constants.
//
// Everything here is configuration, not secrets. Per-application limits are
// stored on the application record (api_apps) and edited in the super-admin
// "Developer API" tab; these are the defaults new applications start with and
// the hard ceilings the admin UI and the server both enforce.

export const API_VERSION = 'v1';
export const API_BASE_PATH = '/api/v1';

/** Least-privilege, read-only scopes. New applications get none by default. */
export const SCOPES = {
  'projects:read': 'Projects: list and read public project details',
  'developers:read': 'Developers: list developers (builders) and their public projects',
  'localities:read': 'Localities: list localities and their public projects',
  'map:read': 'Map: project pins inside a bounding box, with clustering',
  'infrastructure:read': 'Infrastructure: public map markers (metro, hospitals, schools …)',
  'blogs:read': 'Blogs: published articles only',
  // The only write scope. Never granted by default; an admin must tick it per application.
  'enquiries:submit': 'Enquiries: send property enquiries from your own website into the Mappingg CRM (server-to-server only)',
} as const;
export type Scope = keyof typeof SCOPES;
export const SCOPE_LIST = Object.keys(SCOPES) as Scope[];
export const isScope = (s: unknown): s is Scope => typeof s === 'string' && s in SCOPES;

export const APP_STATUSES = ['active', 'disabled', 'revoked'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

/** Defaults for a new application, and the hard limits the server enforces. */
export const LIMITS = {
  defaultRatePerMinute: 60,
  defaultDailyQuota: 5000,
  defaultMaxPageSize: 50,
  maxRatePerMinute: 600,
  maxDailyQuota: 200_000,
  /** Absolute page-size ceiling, whatever an application is configured with. */
  maxPageSize: 100,
  /** Deepest record reachable by paging (page * limit) — a brake on bulk extraction. */
  maxOffset: 5000,
  /** In-flight requests per application on one server instance. */
  maxConcurrentPerApp: 5,
  /** Failed authentications per client in a 10-minute window before it is blocked. */
  maxAuthFailures: 30,
  authFailureWindowSec: 600,
  /** Unauthenticated endpoints (health, openapi, sample) per client per minute. */
  publicPerMinute: 30,
  /** A request that runs longer than this returns 504. */
  timeoutMs: 10_000,
  /** Responses larger than this are refused (500) instead of sent. */
  maxResponseBytes: 2_000_000,
  /** Request logs older than this are deleted. */
  logRetentionDays: 30,
  /** Grace period an old key keeps working after a rotation, unless 0 is chosen. */
  defaultRotationGraceHours: 24,
  maxRotationGraceHours: 24 * 30,
  // POST /enquiries — separate from the read limits, configurable per application.
  defaultEnquiryPerMinute: 10,
  defaultEnquiryDailyQuota: 200,
  maxEnquiryPerMinute: 120,
  maxEnquiryDailyQuota: 5000,
  /** Largest accepted enquiry body. */
  maxEnquiryBytes: 16_384,
  /** Same phone + same project from one application within this window updates the existing lead. */
  enquiryDuplicateWindowHours: 24,
  /** Rejected (invalid) enquiry submissions per application per hour before enquiries pause for that hour. */
  maxInvalidEnquiriesPerHour: 50,
  /** A consent timestamp older than this, or in the future, is rejected. */
  maxConsentAgeHours: 24,
} as const;

/** Kill switch: DEVELOPER_API_DISABLED=1 turns every /api/v1 data endpoint off (503). */
export const apiDisabled = () => /^(1|true|yes)$/i.test(process.env.DEVELOPER_API_DISABLED || '');
